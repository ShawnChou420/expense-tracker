import { computed, ref } from 'vue'
import { showToast } from 'vant'
import {
  LOADING_KEYS,
  PAY_STATUS,
  SCHEDULE_STATUS,
  createEmptyWorkProfile,
  getEffectiveRates,
  getSetupCompleteness,
  inferLegacyWorkProfile,
  normalizeWorkProfile,
} from '../domain/workProfile.js'
import { getStoredRateOverrides } from '../domain/payslip/rates.js'
import { getLatestPayslip } from '../domain/payslip/summary.js'
import { payslipImportRepository, workProfileRepository } from '../repositories/workSetupRepositories.js'

/**
 * 工作設定的狀態與流程：
 * - profile：薪資設定狀態、已確認的費率、班別、每週排班、Smoko
 * - 未完成設定時擋下「填滿本月／本週／新增班表」，記住使用者原本要做的事（pendingAction），
 *   設定完成後讓使用者一鍵回到原本的操作
 * - 會員的設定與薪資單保存在資料庫，訪客只存在記憶體
 */
export function useWorkSetup({ baseRate, ppeAllowance, withholdingTaxRate, confirmedLoadingRates }) {
  const profile = ref(createEmptyWorkProfile())
  const payslips = ref([])
  const setup = computed(() => getSetupCompleteness(profile.value, { baseRate: baseRate.value }))
  const effective = computed(() =>
    getEffectiveRates({ baseRate: baseRate.value, ...confirmedLoadingRates.value }, profile.value),
  )
  const latestPayslip = computed(() => getLatestPayslip(payslips.value))
  // 雇主財年累計（YTD）取自最新一張薪資單，用來校準首頁的年度稅務進度
  const employerYtd = computed(() => {
    const latest = latestPayslip.value
    if (!latest || latest.ytd?.grossCents == null) return null
    return { grossCents: latest.ytd.grossCents, taxCents: latest.ytd.taxCents ?? null, payDate: latest.payDate }
  })

  // --- 設定閘門與精靈 ---
  const gate = ref({ show: false, needs: 'pay' })
  const wizard = ref({ show: false, step: 1 })
  /** @type {import('vue').Ref<null | { type: 'FILL_MONTH' | 'FILL_WEEK' | 'ADD_SHIFT', label: string, payload?: any }>} */
  const pendingAction = ref(null)

  /**
   * @param {{ type: 'FILL_MONTH' | 'FILL_WEEK' | 'ADD_SHIFT', label: string, payload?: any }} action
   * @param {'all' | 'pay'} needs 自動排班需要費率＋班別；手動新增單日只需要費率
   * @returns {boolean} true＝設定完整可以直接執行
   */
  function requireSetup(action, needs = 'all') {
    const ready = needs === 'pay' ? setup.value.payReady : setup.value.ready
    if (ready) return true
    pendingAction.value = action
    gate.value = { show: true, needs: setup.value.payReady ? 'schedule' : 'pay' }
    return false
  }

  function openWizard(step = setup.value.payReady ? 2 : 1) {
    gate.value = { ...gate.value, show: false }
    wizard.value = { show: true, step }
  }

  async function saveProfile(next) {
    profile.value = normalizeWorkProfile(next)
    try {
      await workProfileRepository.save(profile.value)
    } catch (error) {
      showToast(`工作設定未儲存：${error.message}`)
    }
    return profile.value
  }

  /** 套用使用者手動確認的費率（設定精靈 Step 1） */
  async function applyManualPay({ baseRate: base, ppeAllowance: ppe, withholdingTaxRate: tax, confirmed, allowProvisional }) {
    baseRate.value = base
    ppeAllowance.value = ppe
    withholdingTaxRate.value = tax
    confirmedLoadingRates.value = { ...confirmed }
    await saveProfile({
      ...profile.value,
      payStatus: PAY_STATUS.MANUAL_CONFIRMED,
      confirmedRateKeys: ['baseRate', 'ppeAllowance', 'withholdingTaxRate', ...Object.keys(confirmed)],
      allowProvisionalRates: allowProvisional,
      taxRateSource: { type: 'MANUAL', payDate: null },
    })
  }

  /** 薪資單確認後：更新費率與狀態，保存薪資單（會員可同時記錄入帳） */
  async function applyPayslip({ rates, payslip, recordDeposit }) {
    const { baseRate: base, ppeAllowance: ppe, withholdingTaxRate: tax, ...loadings } = rates
    let saved = null
    try {
      saved = await payslipImportRepository.create(payslip, { recordDeposit })
      payslips.value = [saved, ...payslips.value.filter((item) => item.id !== saved.id)]
    } catch (error) {
      showToast(error.message || '薪資單未儲存')
      return false
    }
    if (base !== undefined) baseRate.value = base
    if (ppe !== undefined) ppeAllowance.value = ppe
    if (tax !== undefined) withholdingTaxRate.value = tax
    const loadingEntries = Object.entries(loadings).filter(([key]) => LOADING_KEYS.includes(key))
    confirmedLoadingRates.value = { ...confirmedLoadingRates.value, ...Object.fromEntries(loadingEntries) }
    const confirmedKeys = new Set([...profile.value.confirmedRateKeys, ...Object.keys(rates)])
    await saveProfile({
      ...profile.value,
      payStatus: PAY_STATUS.PAYSLIP_CONFIRMED,
      confirmedRateKeys: [...confirmedKeys],
      taxRateSource:
        tax !== undefined ? { type: 'PAYSLIP_PERIOD', payDate: payslip.payDate } : profile.value.taxRateSource,
    })
    return true
  }

  async function saveSchedule(draft) {
    await saveProfile({ ...draft, scheduleStatus: SCHEDULE_STATUS.CONFIGURED })
  }

  async function removePayslip(id) {
    await payslipImportRepository.remove(id)
    payslips.value = payslips.value.filter((item) => item.id !== id)
  }

  /**
   * 會員登入後還原設定。沒有工作設定的舊會員依既有費率推斷，避免被當成新使用者或改變原本的預估。
   * @param {Record<string, unknown>} storedRates GET /salary-rates
   */
  async function loadMember(storedRates) {
    const [saved, list] = await Promise.all([
      workProfileRepository.load(),
      payslipImportRepository.list().catch(() => []),
    ])
    payslips.value = list || []
    if (saved) {
      profile.value = normalizeWorkProfile(saved)
      const confirmedLoadings = {}
      for (const key of profile.value.confirmedRateKeys) {
        if (LOADING_KEYS.includes(key) && storedRates?.[key] != null) {
          confirmedLoadings[key] = Number(storedRates[key])
        }
      }
      confirmedLoadingRates.value = confirmedLoadings
      return
    }
    const legacy = inferLegacyWorkProfile(storedRates)
    const overrides = getStoredRateOverrides(storedRates || {})
    profile.value = {
      ...legacy,
      confirmedRateKeys: [...legacy.confirmedRateKeys, ...Object.keys(overrides)],
    }
    confirmedLoadingRates.value = overrides
    if (legacy.payStatus !== PAY_STATUS.NOT_CONFIGURED) await saveProfile(profile.value)
  }

  /** 登出或登入失敗：回到訪客自己的設定 */
  function restoreGuest(guest) {
    profile.value = guest?.profile ? normalizeWorkProfile(guest.profile) : createEmptyWorkProfile()
    payslips.value = guest?.payslips ?? []
  }

  return {
    profile,
    payslips,
    setup,
    effective,
    latestPayslip,
    employerYtd,
    gate,
    wizard,
    pendingAction,
    requireSetup,
    openWizard,
    saveProfile,
    applyManualPay,
    applyPayslip,
    saveSchedule,
    removePayslip,
    loadMember,
    restoreGuest,
  }
}
