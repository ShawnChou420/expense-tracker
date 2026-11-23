<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { applyAccountLocale } from './services/localePreference.js'
import { joinList, weekdayShort } from './i18n/format.js'
import { leaveTypeLabel, leaveTypeShortLabel } from './i18n/labels.js'
import * as XLSX from 'xlsx'
import TripTracker from './components/TripTracker.vue'
import ExpenseTracker from './components/ExpenseTracker.vue'
import ShoppingList from './components/ShoppingList.vue'
import DashboardPage from './components/DashboardPage.vue'
import MorePage from './components/MorePage.vue'
import AdminPage from './components/AdminPage.vue'
import AuthPanel from './components/AuthPanel.vue'
import AccountPage from './components/AccountPage.vue'
import PrivacyPage from './components/PrivacyPage.vue'
import { accountRepository } from './repositories/accountRepository.js'
import { ensureBackGuard, registerPageBack } from './services/backNavigation.js'
import { authEmail, authToken, signOut, clearSession, apiRequest, restoreSavedSession, waitForBackendReady, sessionExpired, reportEvent, isSuperAdmin } from './services/authSession.js'
import { startPerfPhase } from './services/perfTrace.js'
import { useWorkRecordsPersistence } from './composables/useWorkRecordsPersistence.js'
import { getGuestLedgerSnapshot, notifyLedgerChanged, passengerRepository, tripRepository, expenseRepository, salaryDepositRepository, financialEntryRepository } from './repositories/appRepositories.js'
import { dashboardSettingsRepository, getGuestDashboardSettings } from './repositories/inMemoryDashboardSettingsRepository.js'
import { leaveBlackoutRepository, getGuestLeaveBlackouts } from './repositories/leaveBlackoutRepository.js'
import { shoppingRepository, getGuestShoppingItems, notifyShoppingChanged } from './repositories/shoppingRepository.js'
import { getNoticesForDate, legacyBlackoutToNotice, removeLeaveBlackout, upsertBlackoutNotice } from './domain/leaveBlackouts.js'
import { blackoutNoticeRepository, getGuestBlackoutNotices } from './repositories/blackoutNoticeRepository.js'
import { visaJourneyRepository, getGuestVisaJourney } from './repositories/visaJourneyRepository.js'
import { getVisaJourneyProgress } from './domain/visaJourney.js'
import { formatCentsIn, resolveDisplayCurrency } from './domain/displayCurrency.js'
import { applyBatchLeave, getLeaveLabel } from './domain/leaveTypes.js'
import VisaJourneySetup from './components/VisaJourneySetup.vue'
import HistoryImportWizard from './components/HistoryImportWizard.vue'
import BatchLeaveSheet from './components/BatchLeaveSheet.vue'
import BlackoutNoticeSheet from './components/BlackoutNoticeSheet.vue'
import { formatDailyNet, getEstimatedDailyNet, hasDailyNetActivity } from './domain/dailyNet.js'
import { useLedgerSnapshot } from './composables/useLedgerSnapshot.js'
import DayLifeCard from './components/DayLifeCard.vue'
import FinancialEntrySheet from './components/FinancialEntrySheet.vue'
import { formatLocalDate, getCalendarDateRange, getMonthRange, getWeekRange } from './domain/date.js'
import { centsToDollars } from './domain/money.js'
import { getWeeklyPaySummary } from './domain/weeklyPay.js'
import { RATE_FIELDS } from './domain/payslip/rates.js'
import PayslipImport from './components/PayslipImport.vue'
import WorkSetupWizard from './components/WorkSetupWizard.vue'
import WorkSetupGate from './components/WorkSetupGate.vue'
import FillPreviewSheet from './components/FillPreviewSheet.vue'
import TimeTextField from './components/TimeTextField.vue'
import { timePickerFilter } from './domain/timeInput.js'
import { isDayEditorDirty, snapshotDayEditor } from './domain/dayEditor.js'
import { useWorkSetup } from './composables/useWorkSetup.js'
import { getGuestWorkSetup, payslipImportRepository, workProfileRepository } from './repositories/workSetupRepositories.js'
import {
  PAY_STATUS,
  describeSmoko,
  describeWeekPlan,
  getPlannedShift,
  getRateFlags,
  getSmokoInputs,
  inferLegacyWorkProfile,
  planFill,
  summarizeFillPreview,
  getTemplateTimes,
  matchShiftTemplate,
  shiftTimeBy,
  toggleCleaningTimes,
} from './domain/workProfile.js'
import { useShiftCalculator } from './composables/useShiftCalculator.js'
import { applyPrepTime, PREP_MINUTES } from './domain/prepTime.js'
import {
  formatHours,
  formatRate,
  roundTo,
} from './utils/number.js'
import {
  getTodayDate,
  isValidTime,
  normalizeTimeInput,
  sanitizeTimeInput,
} from './utils/time.js'
import {
  getNswPublicHolidayLabel,
  getNswPublicHolidayShortLabel,
} from './utils/holidays.js'
import {
  createWorkRecord,
} from './utils/workRecord.js'
import { clearRecordsInMonth, ensureUniqueRecordIds, getMissingScheduleDates, nextRecordId, recordsInMonth, upsertRecordForDate } from './utils/scheduleRecords.js'
import { showConfirmDialog, showToast } from 'vant'

// --- 💰 智慧幣別格式化工具 ---

// 1. 給明細列表用的（自動拔掉台幣/越南盾的小數點，並加上千分位）
const formatDisplayMoney = (amount) => {
  const val = Number(amount);
  if (isNaN(val)) return '0.00';
  // 判斷當前幣別是否為「不需要小數點」的國家
  const noDecimals = ['TWD', 'VND', 'KRW', 'JPY', 'THB'].includes(currentCurrency.value);
  return val.toLocaleString('en-US', {
    minimumFractionDigits: noDecimals ? 0 : 2,
    maximumFractionDigits: noDecimals ? 0 : 2
  });
};

// --- 狀態切換與清潔日 ---
const shiftType = ref('normal') // normal: 正常, leave: 請假
const isCleaningDay = ref(false)
const remark = ref('') // ✨ 新增：當日自訂備註狀態

// --- 控制時間選擇器彈出視窗的開關 ---
const showStartTimePicker = ref(false)
const showEndTimePicker = ref(false)

// --- 滾輪分鐘只列 5 的倍數；手動輸入的其他分鐘（例如 17:07）也保留，打開時才不會錯位 ---
const startPickerFilter = computed(() => timePickerFilter(startTime.value))
const endPickerFilter = computed(() => timePickerFilter(endTime.value))
// 手動輸入的時間格式錯誤時不能儲存
const timeInputInvalid = ref({ start: false, end: false })
const hasInvalidTimeInput = computed(() => timeInputInvalid.value.start || timeInputInvalid.value.end)

const onStartTimeConfirm = ({ selectedValues }) => {
  startTime.value = selectedValues.join(':')
  showStartTimePicker.value = false
}

const onEndTimeConfirm = ({ selectedValues }) => {
  endTime.value = selectedValues.join(':')
  showEndTimePicker.value = false
}

// --- 幣別與匯率相關狀態 ---
const currentCurrency = ref('AUD')
const showCurrencyPicker = ref(false)
const exchangeRates = ref({ AUD: 1 })

const { t } = useI18n()
const currencyColumns = computed(() =>
  ['AUD', 'TWD', 'NZD', 'CNY', 'KRW', 'THB', 'VND', 'USD', 'CAD'].map((value) => ({ text: t(`currencyNames.${value}`), value })),
)

const currencySymbol = computed(() => {
  const symbols = { AUD: '$', NZD: 'NZ$', TWD: 'NT$', CNY: '¥', KRW: '₩', THB: '฿', VND: '₫', USD: 'US$', CAD: 'CA$' }
  return symbols[currentCurrency.value] || '$'
})

const currencyFlag = computed(() => {
  const flags = { AUD: '🇦🇺', NZD: '🇳🇿', TWD: '🇹🇼', CNY: '🇨🇳', KRW: '🇰🇷', THB: '🇹🇭', VND: '🇻🇳', USD: '🇺🇸', CAD: '🇨🇦' }
  return flags[currentCurrency.value] || '🪙'
})

const currentExchangeRate = computed(() => {
  return exchangeRates.value[currentCurrency.value] || 1
})
// 首頁用：同一個顯示幣別，沒有匯率時退回 AUD
const dashboardCurrency = computed(() => resolveDisplayCurrency(currentCurrency.value, exchangeRates.value))

const fetchExchangeRates = async () => {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/AUD')
    const data = await res.json()
    if (data && data.rates) {
      exchangeRates.value = data.rates
    }
  } catch (error) {
    console.error('無法取得匯率資料', error)
  }
}

// 開啟時先顯示載入畫面：等後端與資料庫醒來、確認登入後才顯示內容，避免畫面一開就跳出連線或登入錯誤
const appReady = ref(false)
const bootSlow = ref(false)
onMounted(async () => {
  fetchExchangeRates()
  const slowTimer = setTimeout(() => (bootSlow.value = true), 8000)
  try {
    await waitForBackendReady()
    // 恢復上次的登入（重新整理不會登出）
    const endRestore = startPerfPhase('恢復登入（/auth/me）')
    const restored = await restoreSavedSession()
    endRestore()
    if (restored) await handleSignedIn()
  } catch (error) {
    console.error(error)
  } finally {
    clearTimeout(slowTimer)
    appReady.value = true
  }
  if (sessionExpired.value) showToast(t('app.sessionExpired'))
})

const onCurrencyConfirm = ({ selectedOptions }) => {
  currentCurrency.value = selectedOptions[0].value
  showCurrencyPicker.value = false
}

// --- 日期與時間基礎變數 ---
const workDate = ref(getTodayDate())
// 不預設任何人的上下班時間：有排班範本時由範本帶入，否則讓使用者自己選
const startTime = ref('')
const endTime = ref('')
const dataManagementSections = ref([])
const scheduleSections = ref([])
const expandedRecordId = ref('')
const workInputSection = ref(null)
const records = ref([])
const leaveBlackouts = ref([])
const blackoutNotices = ref([])
const showBlackoutEditor = ref(false)
// 集簽追蹤（設定由使用者輸入；進度依班表即時估算）
const visaJourney = ref(null)
const visaSetupOpen = ref(false)
const historyWizardOpen = ref(false)
const batchLeaveOpen = ref(false)
const authPanelOpen = ref(false)
const accountSheetOpen = ref(false)
const accountNickname = ref('')
const payslipImportOpen = ref(false)
const payslipDeposits = ref(null)

watch(payslipImportOpen, async (open) => {
  if (!open) return
  payslipDeposits.value = null
  if (!authToken.value) return
  try { payslipDeposits.value = await salaryDepositRepository.list() } catch { payslipDeposits.value = [] }
})

// 薪資單確認後：保存薪資單（會員同時可記錄入帳）、更新費率為「已確認」。
// 還沒設定班別時，直接接著打開設定精靈的 Step 2，不讓使用者自己找下一步。
async function applyPayslipImport({ rates, payslip, recordDeposit }) {
  const saved = await workSetup.applyPayslip({ rates, payslip, recordDeposit })
  if (!saved) return
  payslipImportOpen.value = false
  const parts = [t('app.payslipSaved'), Object.keys(rates).length ? t('app.ratesConfirmed', { count: Object.keys(rates).length }) : '']
  if (recordDeposit) parts.push(t('app.depositRecorded'))
  showToast(joinList(parts.filter(Boolean)))
  if (!workSetup.setup.value.scheduleReady) {
    openWorkSetup(2)
  } else if (workSetup.pendingAction.value) {
    continuePendingAction(workSetup.pendingAction.value)
  }
}

const wizardManual = ref(false)
function openWorkSetup(step, { manual = false } = {}) {
  wizardManual.value = manual
  payslipImportOpen.value = false
  workSetup.openWizard(step)
}
function openManualRates() {
  openWorkSetup(1, { manual: true })
}
function openPayslipFromSetup() {
  workSetup.gate.value = { ...workSetup.gate.value, show: false }
  workSetup.wizard.value = { ...workSetup.wizard.value, show: false }
  payslipImportOpen.value = true
}

const privacyOpen = ref(false)
function handlePageNavigate(target) {
  if (target === 'payslip') payslipImportOpen.value = true
  else if (target === 'privacy') privacyOpen.value = true
  else if (target === 'work-setup') openWorkSetup()
  else if (target === 'visa') visaSetupOpen.value = true
  else if (target === 'admin') openAdmin()
  else activeTab.value = target
}
const expenseTrackerRef = ref(null)
const tripTrackerRef = ref(null)
// 通用手動交易（一般收入、外幣支出、資金移轉）表單
const entrySheet = ref({ show: false, entry: null, type: 'INCOME' })
function openEntrySheet(type = 'INCOME', entry = null) {
  entrySheet.value = { show: true, entry, type }
}

// 首頁快捷操作：切到對應頁面，支出與車資直接打開新增表單
async function handleQuickAction(action) {
  if (action === 'shift') {
    activeTab.value = 'payroll'
    return
  }
  if (action === 'income') {
    openEntrySheet('INCOME')
    return
  }
  if (action === 'fill-week') {
    activeTab.value = 'payroll'
    workDate.value = getTodayDate()
    visibleMonth.value = workDate.value.slice(0, 7)
    loadSelectedDate()
    fillCurrentWeek()
    return
  }
  activeTab.value = action === 'expense' ? 'expenses' : 'trips'
  await nextTick()
  if (action === 'expense') expenseTrackerRef.value?.openForm()
  else tripTrackerRef.value?.openTripForm()
}

function openAccount() {
  if (authToken.value) accountSheetOpen.value = true
  else authPanelOpen.value = true
}
const workPersistence = useWorkRecordsPersistence(records, (error) => showToast(error.message))
let switchingAccount = false
let rateWritePaused = false
// 訪客沒有任何預設費率：未設定就是 0，並由工作設定擋下試算
let guestRates = { baseRate: 0, ppeAllowance: 0, withholdingTaxRate: 0, confirmedLoadingRates: {} }
let guestCurrency = 'AUD'
async function restoreGuestSettings() {
  rateWritePaused = true
  baseRate.value = guestRates.baseRate
  confirmedLoadingRates.value = { ...(guestRates.confirmedLoadingRates || {}) }
  ppeAllowance.value = guestRates.ppeAllowance
  withholdingTaxRate.value = guestRates.withholdingTaxRate
  currentCurrency.value = guestCurrency
  workSetup.restoreGuest(getGuestWorkSetup())
  await nextTick()
  rateWritePaused = false
  loadSelectedDate()
}

async function handleSignedIn() {
  const endPerfPhase = startPerfPhase('登入後載入資料')
  switchingAccount = true
  rateWritePaused = true
  try {
    guestRates = {
      baseRate: baseRate.value,
      ppeAllowance: ppeAllowance.value,
      withholdingTaxRate: withholdingTaxRate.value,
      confirmedLoadingRates: { ...confirmedLoadingRates.value },
    }
    const guestWorkSetup = getGuestWorkSetup()
    const guestHasPaySetup =
      guestWorkSetup.profile && guestWorkSetup.profile.payStatus !== PAY_STATUS.NOT_CONFIGURED
    guestCurrency = currentCurrency.value
    const guestWork = workPersistence.getGuestRecords()
    const guestLedger = await getGuestLedgerSnapshot()
    const guestSettings = getGuestDashboardSettings()
    const guestBlackouts = getGuestLeaveBlackouts()
    const guestShopping = getGuestShoppingItems()
    const guestVisa = getGuestVisaJourney()
    const guestNotices = getGuestBlackoutNotices()
    const [memberWork, memberPassengers, memberTrips, memberExpenses, memberSettings, memberBlackouts, memberVisa, memberNotices, memberEntries] = await Promise.all([
      apiRequest('/work-records'), passengerRepository.list(), tripRepository.list(), expenseRepository.list(),
      apiRequest('/dashboard-settings'), leaveBlackoutRepository.list(),
      // 讀取失敗時是 undefined，不可當成「沒有設定」而用訪客資料覆蓋
      visaJourneyRepository.load().catch(() => undefined),
      blackoutNoticeRepository.list().catch(() => undefined),
      // 讀取失敗時是 undefined：不匯入，避免無法比對而重複
      financialEntryRepository.list().catch(() => undefined),
    ])
    let memberShopping = null
    try { memberShopping = await shoppingRepository.list() } catch { showToast(t('app.shoppingUnavailable')) }
    // 讀取失敗時不可當成「沒有設定」重用，否則可能被推斷成舊會員設定並覆蓋
    let memberProfileLoaded = true
    const memberProfile = await workProfileRepository.load().catch(() => {
      memberProfileLoaded = false
      return null
    })
    const existingRates = await apiRequest('/salary-rates')
    // 會員已有自己的設定（或舊版已存的費率）時，不用訪客的設定覆蓋
    const memberHasPaySetup =
      Boolean(memberProfile) || inferLegacyWorkProfile(existingRates).payStatus !== PAY_STATUS.NOT_CONFIGURED
    const hasGuestData = guestWork.length || guestLedger.passengers.length || guestLedger.trips.length ||
      guestLedger.expenses.length || (memberEntries && guestLedger.entries.length) || guestSettings.savingGoal || guestSettings.workDayTarget || guestBlackouts.length || (memberShopping && guestShopping.length) ||
      (guestVisa && memberVisa === null) || (guestNotices.length && memberNotices) ||
      guestWorkSetup.payslips.length || (guestHasPaySetup && !memberHasPaySetup)
    // 有匯入訪客資料時，下面要重新讀取；沒有匯入就直接重用剛讀到的資料，不重複請求
    let imported = false
    const memberHasData = memberWork.length || memberPassengers.length || memberTrips.length || memberExpenses.length || memberEntries?.length || memberBlackouts.length || memberShopping?.length
    if (hasGuestData) {
      try {
        await showConfirmDialog({
          title: t('app.importGuestTitle'),
          message: memberHasData
            ? t('app.importGuestExisting')
            : t('app.importGuestEmpty'),
          confirmButtonText: t('app.import'),
        })
        imported = true
        const missing = (guestItems, memberItems) => guestItems.filter(
          (item) => !memberItems.some((member) => String(member.id) === String(item.id)),
        )
        for (const passenger of missing(guestLedger.passengers, memberPassengers)) await passengerRepository.save(passenger)
        for (const trip of missing(guestLedger.trips, memberTrips)) await tripRepository.save(trip)
        for (const expense of missing(guestLedger.expenses, memberExpenses)) await expenseRepository.save(expense)
        // 通用手動交易：以 client id 比對，後端也是 upsert，重送不會重複
        if (memberEntries) {
          for (const entry of missing(guestLedger.entries, memberEntries)) await financialEntryRepository.save(entry)
        }
        for (const record of missing(guestWork, memberWork)) await apiRequest(`/work-records/${encodeURIComponent(record.id)}`, { method: 'PUT', body: record })
        for (const blackout of guestBlackouts.filter((item) =>
          !memberBlackouts.some((member) => member.date === item.date))) {
          await leaveBlackoutRepository.save(blackout)
        }
        if (memberShopping) {
          for (const item of guestShopping.filter((guest) =>
            !memberShopping.some((member) => member.id === guest.id))) {
            await shoppingRepository.add(item)
          }
        }
        if (guestVisa && memberVisa === null) await visaJourneyRepository.save(guestVisa)
        if (memberNotices) {
          for (const notice of guestNotices.filter((item) => !memberNotices.some((member) => member.id === item.id))) {
            await blackoutNoticeRepository.save(notice)
          }
        }
        if (guestSettings.savingGoal && !memberSettings.savingGoal) await dashboardSettingsRepository.saveSavingGoal(guestSettings.savingGoal)
        if (guestSettings.workDayTarget && !memberSettings.workDayTarget) await dashboardSettingsRepository.saveWorkDayTarget(guestSettings.workDayTarget)
        // 會員還沒有自己的工作設定時，才把訪客剛完成的設定與費率帶過去（不覆蓋會員既有設定）
        if (guestHasPaySetup && !memberHasPaySetup) {
          await apiRequest('/salary-rates', {
            method: 'PUT',
            body: {
              ...guestRates.confirmedLoadingRates,
              baseRate: guestRates.baseRate,
              ppeAllowance: guestRates.ppeAllowance,
              withholdingTaxRate: guestRates.withholdingTaxRate,
            },
          })
          await workProfileRepository.save(guestWorkSetup.profile)
        }
        for (const payslip of guestWorkSetup.payslips) {
          try {
            const { id: _guestId, depositId: _deposit, ...data } = payslip
            await payslipImportRepository.create(data, { recordDeposit: false })
          } catch {
            // 已匯入過的同一份薪資單會被後端擋下，略過即可
          }
        }
      } catch (error) {
        if (error !== 'cancel') showToast(error.message || t('app.importFailed'))
      }
    }
    await workPersistence.loadMemberRecords(imported ? undefined : memberWork)
    leaveBlackouts.value = imported ? await leaveBlackoutRepository.list() : memberBlackouts
    visaJourney.value = imported ? await visaJourneyRepository.load().catch(() => memberVisa ?? null) : memberVisa ?? null
    blackoutNotices.value = imported ? await blackoutNoticeRepository.list().catch(() => memberNotices ?? []) : memberNotices ?? []
    const memberRates = imported ? await apiRequest('/salary-rates') : existingRates
    // 沒有存過費率的會員就是 0（未設定），絕不套用任何人的預設費率
    baseRate.value = Number(memberRates.baseRate ?? 0)
    ppeAllowance.value = Number(memberRates.ppeAllowance ?? 0)
    withholdingTaxRate.value = Number(memberRates.withholdingTaxRate ?? 0)
    await workSetup.loadMember(memberRates, !imported && memberProfileLoaded ? { profile: memberProfile } : undefined)
    loadSelectedDate()
    currentCurrency.value = memberSettings.displayCurrency || 'AUD'
    // 帳號有語言偏好就套用；沒有（null）就沿用目前畫面語言。與顯示貨幣互不影響
    applyAccountLocale(memberSettings.language)
    // 各頁面在登入身分改變時已自行讀取；只有匯入過訪客資料才需要再通知一次
    if (imported) {
      notifyLedgerChanged()
      notifyShoppingChanged()
    }
    // 顯示名稱只用於帳號卡，讀取失敗不影響登入
    const signedInToken = authToken.value
    accountRepository.get().then((account) => {
      // 回應前已登出或換帳號就丟棄，避免名稱殘留在訪客畫面
      if (authToken.value === signedInToken) accountNickname.value = account.nickname || ''
    }).catch(() => {})
  } catch (error) {
    showToast(error.message)
    clearSession()
    await workPersistence.restoreGuestRecords()
    leaveBlackouts.value = getGuestLeaveBlackouts()
    blackoutNotices.value = getGuestBlackoutNotices()
    visaJourney.value = getGuestVisaJourney()
    await restoreGuestSettings()
  } finally {
    await nextTick()
    rateWritePaused = false
    switchingAccount = false
    endPerfPhase()
  }
}

async function handleSignOut() {
  switchingAccount = true
  accountSheetOpen.value = false
  try {
    try { await workPersistence.flush() } catch { /* Errors are shown by the persistence handler. */ }
    try { await signOut() } catch { showToast(t('app.signOutFailed')) }
    await workPersistence.restoreGuestRecords()
    leaveBlackouts.value = getGuestLeaveBlackouts()
    blackoutNotices.value = getGuestBlackoutNotices()
    visaJourney.value = getGuestVisaJourney()
    await restoreGuestSettings()
    notifyLedgerChanged()
    notifyShoppingChanged()
  } finally {
    switchingAccount = false
  }
}

// 帳號已在後端刪除（含所有 session）：不呼叫登出 API，直接清除登入狀態，
// 由下方 watch 還原訪客資料並關閉會員頁
function handleAccountDeleted() {
  clearSession()
  showToast(t('app.accountDeleted'))
}

watch(authToken, async (token) => {
  if (!token) {
    // 登出或登入失效時關閉會員頁並清掉顯示名稱，避免殘留會員畫面
    accountSheetOpen.value = false
    accountNickname.value = ''
  }
  if (!token && !switchingAccount) {
    await workPersistence.restoreGuestRecords()
    leaveBlackouts.value = getGuestLeaveBlackouts()
    blackoutNotices.value = getGuestBlackoutNotices()
    visaJourney.value = getGuestVisaJourney()
    await restoreGuestSettings()
    notifyLedgerChanged()
    notifyShoppingChanged()
  }
})
const activeTab = ref('dashboard')
// 薪資頁分成三段：班表（日曆）、本週（結算與明細）、設定（費率、班別、匯出）
const PAYROLL_VIEWS = [{ id: 'schedule' }, { id: 'week' }, { id: 'settings' }]
const payrollView = ref('schedule')
// 點日曆日期時打開的當天面板
const daySheetOpen = ref(false)
const monthMenuOpen = ref(false)
// 採買清單從「更多」進入，底部分頁仍亮在「更多」
const tabbarActive = computed(() => (['shopping', 'admin'].includes(activeTab.value) ? 'more' : activeTab.value))

// --- 管理後台：網址 #/admin（靜態網站沒有伺服器轉址，所以用 hash）；權限由後端驗證 ---
const ADMIN_HASH = '#/admin'
function openAdmin() {
  if (!isSuperAdmin.value) return
  activeTab.value = 'admin'
}
watch(activeTab, (tab) => {
  // 保留 history.state，不清掉返回鍵的守門紀錄
  if (tab === 'admin' && window.location.hash !== ADMIN_HASH) window.history.replaceState(window.history.state, '', ADMIN_HASH)
  if (tab !== 'admin' && window.location.hash === ADMIN_HASH)
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
})
// 登出或失去管理員權限時離開管理後台
watch(isSuperAdmin, (admin) => {
  if (!admin && activeTab.value === 'admin') activeTab.value = 'more'
  if (admin && window.location.hash === ADMIN_HASH) activeTab.value = 'admin'
})
// 返回鍵：子頁面回上一層、其他分頁回首頁；首頁再按返回才離開 App
// 薪資頁有未儲存的單日修改時先提醒，取消就留在原地
registerPageBack({
  canGoBack: () => activeTab.value !== 'dashboard',
  back: () => {
    const target = ['shopping', 'admin'].includes(activeTab.value) ? 'more' : 'dashboard'
    if (activeTab.value === 'dashboard') return false
    if (activeTab.value === 'payroll') {
      confirmLeaveDayEditor().then((proceed) => {
        if (proceed) activeTab.value = target
      })
      return true
    }
    activeTab.value = target
    return true
  },
})
watch(activeTab, () => nextTick(ensureBackGuard))
const payBreakdownOpen = ref([])
const advancedRatesOpen = ref([])
const visibleMonth = ref(workDate.value.slice(0, 7))
const scheduleMonth = ref(visibleMonth.value)
const displayedMonthRange = computed(() => getMonthRange(visibleMonth.value))
const displayedMonthRecords = computed(() => recordsInMonth(records.value, visibleMonth.value))
const monthlyScheduleRecords = computed(() =>
  recordsInMonth(records.value, scheduleMonth.value).sort((a, b) =>
    a.workDate === b.workDate ? a.startTime.localeCompare(b.startTime) : a.workDate.localeCompare(b.workDate),
  ),
)
watch(visibleMonth, (month) => { scheduleMonth.value = month })

const onCalendarPanelChange = ({ date }) => {
  visibleMonth.value = formatLocalDate(date).slice(0, 7)
}

const moveScheduleMonth = (direction) => {
  const [year, month] = scheduleMonth.value.split('-').map(Number)
  scheduleMonth.value = formatLocalDate(new Date(year, month - 1 + direction, 1)).slice(0, 7)
}

const parseWorkDate = (dateText) => {
  const [year, month, day] = dateText.split('-').map(Number)
  return new Date(year, month - 1, day)
}


const calendarDefaultDate = computed(() => parseWorkDate(workDate.value))
// 日曆範圍隨今天往後滾動，並涵蓋目前選取日期與所有班表日期（不再固定停在 2027 年底）
const calendarRange = computed(() =>
  getCalendarDateRange({ dates: [workDate.value, ...records.value.map((record) => record.workDate)] }),
)
// 只在年份變動時產生新的 Date，避免每次編輯班表都觸發 van-calendar 重設
const calendarMinYear = computed(() => calendarRange.value.minDate.getFullYear())
const calendarMaxYear = computed(() => calendarRange.value.maxDate.getFullYear())
const calendarMinDate = computed(() => new Date(calendarMinYear.value, 0, 1))
const calendarMaxDate = computed(() => new Date(calendarMaxYear.value, 11, 31))
const selectedRecord = computed(() => records.value.find((record) => record.workDate === workDate.value))
// 禁休公告：新的期間公告＋舊版單日禁休一起顯示。只是提醒，不影響班表、薪資或集簽。
const allBlackoutNotices = computed(() => [
  ...blackoutNotices.value,
  ...leaveBlackouts.value.map(legacyBlackoutToNotice),
])
const selectedNotices = computed(() => getNoticesForDate(allBlackoutNotices.value, workDate.value))

const openBlackoutEditor = () => {
  showBlackoutEditor.value = true
}

async function saveBlackoutNotice(notice, previous) {
  const saved = await blackoutNoticeRepository.save(notice)
  blackoutNotices.value = upsertBlackoutNotice(blackoutNotices.value, saved)
  // 舊版單日禁休編輯後已轉存成新公告，移除舊的那一筆
  if (previous?.legacyDate) {
    await leaveBlackoutRepository.remove(previous.legacyDate)
    leaveBlackouts.value = removeLeaveBlackout(leaveBlackouts.value, previous.legacyDate)
  }
}

async function removeBlackoutNotice(notice) {
  if (notice.legacyDate) {
    await leaveBlackoutRepository.remove(notice.legacyDate)
    leaveBlackouts.value = removeLeaveBlackout(leaveBlackouts.value, notice.legacyDate)
    return
  }
  await blackoutNoticeRepository.remove(notice.id)
  blackoutNotices.value = blackoutNotices.value.filter((item) => item.id !== notice.id)
}

// 這天依使用者的每週排班應該上什麼班（沒有設定就是 null，不再用任何人的固定班表）
const plannedShiftFor = (date) => getPlannedShift(workSetup.profile.value, date)
const selectedPlannedShift = computed(() => {
  const plan = plannedShiftFor(workDate.value)
  return plan && plan.shiftType !== 'leave' ? plan : null
})
const selectedDateHasDefaultShift = computed(() => Boolean(selectedPlannedShift.value))

// --- 未儲存提醒：載入某天時記下基準值，目前的值和基準值不同就是有未儲存修改 ---
// 初始值＝空白編輯器（訪客一開始不會呼叫 loadSelectedDate）
const dayEditorBaseline = ref(snapshotDayEditor({}))
const timeFieldKey = ref(0)
const currentDayEditorState = () =>
  snapshotDayEditor({
    startTime: startTime.value,
    endTime: endTime.value,
    shiftType: shiftType.value,
    isCleaningDay: isCleaningDay.value,
    remark: remark.value,
    smokoCountOverride: smokoCountOverride.value,
  })
const markDayEditorClean = () => {
  dayEditorBaseline.value = currentDayEditorState()
}
const dayEditorDirty = computed(() => isDayEditorDirty(dayEditorBaseline.value, currentDayEditorState()))

const loadSelectedDate = () => {
  const existingRecord = selectedRecord.value
  smokoCountOverride.value = null
  // 重新建立時間欄位，清掉沒通過驗證的輸入
  timeFieldKey.value += 1

  if (existingRecord) {
    startTime.value = existingRecord.startTime
    endTime.value = existingRecord.endTime
    shiftType.value = existingRecord.shiftType || 'normal'
    isCleaningDay.value = existingRecord.isCleaningDay || false
    remark.value = existingRecord.remark || ''
  } else {
    const planned = selectedPlannedShift.value
    startTime.value = planned?.startTime ?? ''
    endTime.value = planned?.endTime ?? ''
    shiftType.value = 'normal'
    isCleaningDay.value = planned?.isCleaningDay ?? false
    remark.value = ''
  }
  markDayEditorClean()
}

// 有未儲存修改時先問：儲存（成功才繼續）／不儲存（丟棄後繼續）／取消（留在原地）
const unsavedPrompt = ref({ show: false, date: '' })
let resolveUnsavedPrompt = null
const unsavedActions = computed(() => [
  { name: t('common.save'), value: 'save', color: '#1989fa' },
  { name: t('payrollPage.dontSave'), value: 'discard', color: '#ee0a24' },
])
// 當天面板的生活紀錄（日記）也算在同一個未儲存提醒裡
const dayLifeCard = ref(null)
const daySheetDirty = computed(() => dayEditorDirty.value || Boolean(dayLifeCard.value?.dirty))
function confirmLeaveDayEditor() {
  if (!daySheetDirty.value) return Promise.resolve(true)
  resolveUnsavedPrompt?.(false)
  unsavedPrompt.value = { show: true, date: workDate.value }
  return new Promise((resolve) => {
    resolveUnsavedPrompt = resolve
  })
}
function finishUnsavedPrompt(proceed) {
  const resolve = resolveUnsavedPrompt
  resolveUnsavedPrompt = null
  unsavedPrompt.value = { ...unsavedPrompt.value, show: false }
  resolve?.(proceed)
}
async function onUnsavedAction(action) {
  if (action.value === 'save') {
    const shiftSaved = dayEditorDirty.value ? addTodayRecordToList() : true
    const lifeSaved = shiftSaved && dayLifeCard.value ? await dayLifeCard.value.save() : shiftSaved
    finishUnsavedPrompt(Boolean(lifeSaved))
    return
  }
  loadSelectedDate()
  dayLifeCard.value?.reset()
  finishUnsavedPrompt(true)
}
// 點遮罩、取消、手機返回都當作「取消」（選項不自動關閉，由 onUnsavedAction 關，避免先被當成取消）
function onUnsavedPromptShow(show) {
  if (!show && resolveUnsavedPrompt) finishUnsavedPrompt(false)
}

// 離開薪資頁前檢查
const beforeTabChange = (tab) => (activeTab.value === 'payroll' && tab !== 'payroll' ? confirmLeaveDayEditor() : true)

// 點擊日曆上的某一天
const payrollCalendar = ref(null)
const onDateSelect = async (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const nextDate = `${year}-${month}-${day}`
  if (nextDate === workDate.value) {
    // 同一天：有未儲存修改就保留，直接打開面板繼續編輯
    if (!dayEditorDirty.value) loadSelectedDate()
    daySheetOpen.value = true
    return
  }
  if (!(await confirmLeaveDayEditor())) {
    // 留在原本那天：日曆的選取也退回去
    payrollCalendar.value?.reset(parseWorkDate(workDate.value))
    return
  }
  showBlackoutEditor.value = false
  workDate.value = nextDate
  visibleMonth.value = `${year}-${month}`
  loadSelectedDate()
  daySheetOpen.value = true
}

// 首頁今日班表的「工作地點」：存進工作設定（會員寫回帳號，訪客只在這次開啟期間）
async function saveWorkplace(workplace) {
  const saved = await workSetup.saveProfile({ ...workSetup.profile.value, workplace })
  showToast(saved.workplace ? t('common.saved') : t('shiftCard.workplaceCleared'))
}

// 首頁「調整上下班時間」：不切換分頁，直接打開那天的當天面板並捲到時間欄位
// （同一個面板、同一套薪資計算與未儲存提醒）
async function openDayEditorFromHome(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return
  if (date !== workDate.value) {
    if (!(await confirmLeaveDayEditor())) return
    showBlackoutEditor.value = false
    workDate.value = date
    visibleMonth.value = date.slice(0, 7)
    payrollCalendar.value?.reset(parseWorkDate(date))
    loadSelectedDate()
  } else if (!dayEditorDirty.value) {
    loadSelectedDate()
  }
  ledger.ensureLoaded()
  daySheetOpen.value = true
  // 等面板滑出後再捲動，避免動畫中捲動位置被重設
  setTimeout(() => workInputSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 320)
}

// 關閉當天面板（×、點遮罩）前，有未儲存修改就先提醒；取消就留在面板
const beforeDaySheetClose = () => confirmLeaveDayEditor()
async function closeDaySheet() {
  if (await confirmLeaveDayEditor()) daySheetOpen.value = false
}

// 從當天面板打開其他表單時，先收起面板，不疊兩層彈窗
async function openFromDaySheet(open) {
  if (!(await confirmLeaveDayEditor())) return
  daySheetOpen.value = false
  open()
}

// 日期明細的財務項目：連到原本的支出／車資編輯流程；工作項目捲到下方的班表編輯
async function openDayExpense(sourceId) {
  await openFromDaySheet(async () => {
    activeTab.value = 'expenses'
    await nextTick()
    expenseTrackerRef.value?.openForm({ sourceId })
  })
}
async function openDayTrip(tripId) {
  const trip = ledger.trips.value.find((item) => item.id === tripId)
  if (!trip) return
  await openFromDaySheet(async () => {
    activeTab.value = 'trips'
    await nextTick()
    tripTrackerRef.value?.openTripForm(trip)
  })
}
function scrollToWorkInput() {
  workInputSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// 切換班表／本週／設定前也檢查
async function switchPayrollView(view) {
  if (view === payrollView.value) return
  if (await confirmLeaveDayEditor()) payrollView.value = view
}

function saveDayFromSheet() {
  const saved = addTodayRecordToList()
  // 存進去就收起面板；被設定閘門擋下時也收起，讓閘門不疊在面板上（修改仍保留，下次打開還在）
  if (saved || workSetup.gate.value.show) daySheetOpen.value = false
}

// --- 填滿本週／本月：先檢查設定 → 預覽 → 使用者確認後才寫入 ---
const fillPreviewOpen = ref(false)
const fillPreview = ref(null)

const datesBetween = (start, end) => {
  const dates = []
  const cursor = parseWorkDate(start)
  const last = parseWorkDate(end)
  while (cursor <= last) {
    dates.push(formatLocalDate(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

/**
 * 依工作設定產生區間內的班表（不寫入）。已有紀錄的日期一律略過。
 * 跨午夜的班仍記在上班當天，薪資由計算引擎依實際時段切分（含跨月、跨週）。
 */
function buildPlannedRecords(profile, dates, existing = records.value) {
  const { plan, skippedExisting, offDays } = planFill(existing, profile, dates)
  const smoko = getSmokoInputs(profile.smoko)
  let nextId = nextRecordId(records.value)
  const built = []
  for (const item of plan) {
    const record = buildWorkRecordFromInputs({
      id: nextId++,
      workDate: item.date,
      startTime: item.startTime,
      endTime: item.endTime,
      shiftType: item.shiftType,
      isCleaningDay: item.isCleaningDay,
      remark: '',
      prepMinutes: currentPrepMinutes.value,
      smokoCountOverride: smoko.smokoCountOverride,
      smokoMinutes: smoko.deductMinutesPerBreak,
    })
    if (record) built.push({ ...record, shiftName: item.shiftType === 'leave' ? '' : item.name })
  }
  return { records: built, skippedExisting, offDays }
}

function openFillPreview({ start, end, title }) {
  const result = buildPlannedRecords(workSetup.profile.value, datesBetween(start, end))
  const short = (date) => date.slice(5).replace('-', '/')
  fillPreview.value = {
    title,
    rangeLabel: `${short(start)} – ${short(end)}`,
    ...result,
    summary: summarizeFillPreview(result.records),
  }
  fillPreviewOpen.value = true
}

function confirmFillPreview() {
  const preview = fillPreview.value
  if (!preview?.records.length) return
  // 寫入前再確認一次：預覽打開期間若新增了紀錄，那些日期不覆蓋
  const taken = new Set(records.value.map((record) => record.workDate))
  const additions = preview.records
    .filter((record) => !taken.has(record.workDate))
    .map(({ shiftName: _name, ...record }) => record)
  records.value = ensureUniqueRecordIds([...records.value, ...additions])
  fillPreviewOpen.value = false
  loadSelectedDate()
  showToast(t('payrollPage.addedRecords', { count: additions.length }))
  reportEvent('FILL_MONTH_COMPLETED', { details: { count: additions.length } })
}

function runFillAction(action) {
  if (!workSetup.requireSetup(action)) return
  openFillPreview(action.payload)
}

const fillCurrentWeek = () => {
  const range = getWeekRange(workDate.value)
  if (!range) return
  runFillAction({
    type: 'FILL_WEEK',
    label: t('payrollPage.fillWeek'),
    payload: { ...range, title: t('payrollPage.fillWeek') },
  })
}

const fillCurrentMonth = () => {
  const range = displayedMonthRange.value
  if (!range) return
  const month = Number(visibleMonth.value.slice(5))
  runFillAction({
    type: 'FILL_MONTH',
    label: t('payrollPage.fillMonthLabel', { month }),
    payload: { ...range, title: t('payrollPage.fillMonthTitle', { year: visibleMonth.value.slice(0, 4), month }) },
  })
}

// 設定完成後回到使用者原本的操作
function continuePendingAction(action) {
  workSetup.wizard.value = { ...workSetup.wizard.value, show: false }
  workSetup.pendingAction.value = null
  if (!action) {
    activeTab.value = 'payroll'
    return
  }
  if (action.type === 'HISTORY_IMPORT') {
    historyWizardOpen.value = true
    return
  }
  activeTab.value = 'payroll'
  if (action.type === 'ADD_SHIFT') {
    addTodayRecordToList()
    return
  }
  openFillPreview(action.payload)
}

// 精靈 Step 3 的「以本週為例」預覽：用草稿設定試算，不寫入
function previewSetupWeek(draftProfile) {
  const range = getWeekRange(getTodayDate())
  if (!range) return null
  const dates = datesBetween(range.start, range.end)
  const { records: built } = buildPlannedRecords(draftProfile, dates, [])
  const byDate = new Map(built.map((record) => [record.workDate, record]))
  const days = dates.map((date) => {
    const record = byDate.get(date)
    const worked = record && record.shiftType !== 'leave'
    return {
      date,
      weekday: weekdayShort(parseWorkDate(date)),
      name: worked ? record.shiftName : '',
      leave: record?.shiftType === 'leave',
      time: worked ? `${record.startTime}–${record.endTime}${record.endTime <= record.startTime ? t('payrollPage.nextDayShort') : ''}` : '',
      paidMinutes: worked ? record.paidMinutes : 0,
      grossCents: worked ? Math.round(record.grossPay * 100) : 0,
    }
  })
  return { days, summary: summarizeFillPreview(built) }
}

const clearCurrentMonth = async () => {
  const count = displayedMonthRecords.value.length
  if (!count) return showToast(t('payrollPage.nothingToClear', { month: visibleMonth.value }))
  const markedCount = displayedMonthRecords.value.filter((record) => record.designatedWork).length
  try {
    await showConfirmDialog({
      title: t('payrollPage.clearTitle', { month: visibleMonth.value }),
      message: t('payrollPage.clearMessage', { start: displayedMonthRange.value.start, end: displayedMonthRange.value.end, count, marked: markedCount }),
      confirmButtonText: t('payrollPage.clearConfirm'),
      confirmButtonColor: '#ee0a24',
    })
    records.value = clearRecordsInMonth(records.value, visibleMonth.value)
    if (workDate.value.startsWith(visibleMonth.value)) loadSelectedDate()
    showToast(t('payrollPage.cleared', { count }))
  } catch {
    // The user cancelled the destructive action.
  }
}

const selectedHolidayLabel = computed(() => {
  if (!workDate.value) return ''
  return getNswPublicHolidayLabel(parseWorkDate(workDate.value))
})

// --- 生活日曆：每日預估淨收支（計算在 domain/dailyNet.js） ---
const ledger = useLedgerSnapshot((error) => showToast(error.message))
watch(
  activeTab,
  (tab) => {
    if (tab === 'payroll') ledger.ensureLoaded()
  },
  { immediate: true },
)
const passengerNames = computed(() =>
  Object.fromEntries(ledger.passengers.value.map((passenger) => [passenger.id, passenger.name])),
)
const dailyNetByDate = computed(() =>
  getEstimatedDailyNet({
    range: { start: formatLocalDate(calendarMinDate.value), end: formatLocalDate(calendarMaxDate.value) },
    workRecords: records.value,
    trips: ledger.trips.value,
    expenses: ledger.expenses.value,
    salaryDeposits: ledger.salaryDeposits.value,
    entries: ledger.entries.value,
    passengerNames: passengerNames.value,
  }),
)
const selectedDailyNet = computed(() => dailyNetByDate.value.get(workDate.value) ?? null)
const calendarMoney = (/** @type {number} */ cents) => formatCentsIn(cents, dashboardCurrency.value)
const signedCalendarMoney = (/** @type {number} */ cents) =>
  `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${calendarMoney(Math.abs(cents))}`

// ✨ 日曆格式化：上方放假日/清潔日/假別，下方放每日預估淨額
const holidayCalendarFormatter = (day) => {
  if (!day.date) return day

  const year = day.date.getFullYear()
  const month = String(day.date.getMonth() + 1).padStart(2, '0')
  const dayNum = String(day.date.getDate()).padStart(2, '0')
  const dateStr = `${year}-${month}-${dayNum}`

  const holidayLabel = getNswPublicHolidayShortLabel(day.date)
  const isBlackout = getNoticesForDate(allBlackoutNotices.value, dateStr).length > 0
  const record = records.value.find((r) => r.workDate === dateStr)
  // 清潔班只依使用者自己的班表或排班設定標示，不再固定星期二
  const isCleaning = record ? record.isCleaningDay === true : plannedShiftFor(dateStr)?.isCleaningDay === true

  // 1. 處理上方標籤 (國定假日 / 清潔日)
  if (holidayLabel) {
    day.topInfo = holidayLabel
    day.className = `${day.className || ''} holiday-day`.trim()
  } else if (isBlackout) {
    day.topInfo = t('payrollPage.blackoutTag')
  } else if (isCleaning) {
    day.topInfo = t('payrollPage.cleaningTag')
    day.className = `${day.className || ''} cleaning-day`.trim()
  }
  if (isBlackout) day.className = `${day.className || ''} leave-blackout-day`.trim()

  // 請假：沒有假日／禁休／清潔班標籤時，把假別放上方（下方留給淨額）
  if (record?.shiftType === 'leave' && !holidayLabel && !isBlackout) {
    day.topInfo = record.leaveType ? leaveTypeShortLabel(record.leaveType, getLeaveLabel(record).slice(0, 2)) : t('payrollPage.leaveTag')
  }

  // 2. 下方：每日預估淨額（工作收入＋車資應收－生活支出）；沒有任何紀錄就留白
  let classNames = []
  const net = dailyNetByDate.value.get(dateStr)
  if (hasDailyNetActivity(net)) {
    const formatted = formatDailyNet(net.netCents, dashboardCurrency.value.rate)
    day.bottomInfo = formatted.text
    classNames.push(`net-${formatted.sign}`)
  }

  if (record) {
    classNames.push(record.shiftType === 'leave' ? 'record-leave-day' : 'record-work-day')
    
    if (record.remark && record.remark.trim() !== '') {
      classNames.push('has-remark-day')
    }
  }

  day.className = `${day.className || ''} ${classNames.join(' ')}`.trim()
  return day
}

const updateRate = (targetRef, value, digits = 3) => {
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return
  targetRef.value = roundTo(parsed, digits)
}

// --- 費率設定 ---
// 每位使用者自己的費率：未設定就是 0，並由「工作設定」擋下試算；不再有任何人的預設時薪或稅率。
const baseRate = ref(0)
const ppeAllowance = ref(0)
// 本期實際預扣比例（PAYG withholding）＝薪資單 Tax ÷ Gross，或使用者手動輸入；與年度應繳稅額分開
const withholdingTaxRate = ref(0)
// 已由薪資單或使用者確認的加成費率（未確認的不在這裡）
const confirmedLoadingRates = ref({})

const workSetup = useWorkSetup({ baseRate, ppeAllowance, withholdingTaxRate, confirmedLoadingRates })

// --- 當天快速調整：選班別、標記清潔日、提早／延後 ---
// 主管每天在群組公布當天時間（常差 5–30 分鐘），清潔日也是前一天才知道，所以都在當天調整，不改每週排班
const dayShiftTemplates = computed(() => workSetup.profile.value.shiftTemplates)
const selectedShiftTemplate = computed(() =>
  matchShiftTemplate(dayShiftTemplates.value, startTime.value, isCleaningDay.value),
)
const applyShiftTemplate = (template) => {
  const times = getTemplateTimes(template, isCleaningDay.value)
  startTime.value = times.startTime
  endTime.value = times.endTime
}
const setCleaningDay = (value) => {
  const next = toggleCleaningTimes(dayShiftTemplates.value, { startTime: startTime.value, endTime: endTime.value }, value)
  isCleaningDay.value = value
  startTime.value = next.startTime
  endTime.value = next.endTime
}
const nudgeTime = (field, minutes) => {
  const target = field === 'start' ? startTime : endTime
  if (!isValidTime(target.value)) return
  target.value = shiftTimeBy(target.value, minutes)
}
const TIME_NUDGES = [-15, -5, 5, 15]
// 剛完成或修改工作設定時，選取中的日期若還沒有班表也還沒填時間，直接帶入排班時間
watch(() => workSetup.profile.value, () => {
  if (!selectedRecord.value && !startTime.value && !endTime.value) loadSelectedDate()
})
const setupState = workSetup.setup
// 班表段的設定摘要：最多列兩個班別名稱
const setupShiftNames = computed(() => {
  const names = workSetup.profile.value.shiftTemplates.map((template) => template.name).filter(Boolean)
  return names.length > 2 ? t('payrollPage.moreShifts', { names: joinList(names.slice(0, 2)), count: names.length }) : joinList(names)
})

// 計算用的加成費率：已確認＝實際值；未確認＝使用者同意暫估時用預設倍率，否則不計入（並在畫面標示）。
// 舊班表的金額在儲存當下已固定，費率變更不會改變歷史班表。
const effectiveRate = (key) => computed(() => workSetup.effective.value.rates[key] ?? 0)
const casualLoadingRate = effectiveRate('casualLoadingRate')
const shiftLoadingRate = effectiveRate('shiftLoadingRate')
const saturdayOrdLoadingRate = effectiveRate('saturdayOrdLoadingRate')
const timeHalfRate = effectiveRate('timeHalfRate')
const doubleRate = effectiveRate('doubleRate')
const sundayLoadingRate = effectiveRate('sundayLoadingRate')
const rateStatus = computed(() => workSetup.effective.value.status)
// 匯入薪資單時比對用：已確認的視為「來自薪資單」，其他視為預設
const rateSources = computed(() =>
  Object.fromEntries(
    RATE_FIELDS.map(({ key }) => [key, workSetup.profile.value.confirmedRateKeys.includes(key) ? 'payslip' : 'default']),
  ),
)
// 加班 1.5／2 倍是完整時薪：未確認時先以基本時薪計，其他加給未確認就不計入
const isOvertimeKey = (key) => key === 'timeHalfRate' || key === 'doubleRate'
const hidesRate = (key) => rateStatus.value[key] === 'EXCLUDED' && !isOvertimeKey(key)
const rateSourceLabel = (key) => {
  const status = rateStatus.value[key]
  if (status === 'EXCLUDED') return isOvertimeKey(key) ? t('payrollPage.rateNotConfirmedOvertime') : t('payrollPage.rateNotConfirmed')
  return { CONFIRMED: t('payrollPage.rateConfirmed'), PROVISIONAL: t('payrollPage.rateProvisional') }[status] ?? ''
}
const currentRateValues = computed(() => ({
  baseRate: baseRate.value,
  casualLoadingRate: casualLoadingRate.value,
  shiftLoadingRate: shiftLoadingRate.value,
  saturdayOrdLoadingRate: saturdayOrdLoadingRate.value,
  sundayLoadingRate: sundayLoadingRate.value,
  timeHalfRate: timeHalfRate.value,
  doubleRate: doubleRate.value,
  ppeAllowance: ppeAllowance.value,
  withholdingTaxRate: withholdingTaxRate.value,
}))

const ratePreviewItems = computed(() => [
  { key: 'baseRate', label: t('payrollPage.rates.baseRate'), value: baseRate.value, unit: t('payrollPage.perHourLong') },
  { key: 'casualLoadingRate', label: t('payrollPage.rates.casualLoadingRate'), value: casualLoadingRate.value, unit: t('payrollPage.perHourLong') },
  { key: 'shiftLoadingRate', label: t('payrollPage.rates.shiftLoadingRate'), value: shiftLoadingRate.value, unit: t('payrollPage.perHourLong') },
  { key: 'saturdayOrdLoadingRate', label: t('payrollPage.rates.saturdayOrdLoadingRate'), value: saturdayOrdLoadingRate.value, unit: t('payrollPage.perHourLong') },
  { key: 'timeHalfRate', label: t('payrollPage.rates.timeHalfRate'), value: timeHalfRate.value, unit: t('payrollPage.perHourLong') },
  { key: 'doubleRate', label: t('payrollPage.rates.doubleRate'), value: doubleRate.value, unit: t('payrollPage.perHourLong') },
  { key: 'sundayLoadingRate', label: t('payrollPage.rates.sundayLoadingRate'), value: sundayLoadingRate.value, unit: t('payrollPage.perHourLong') },
  { key: 'ppeAllowance', label: t('payrollPage.rates.ppeAllowance'), value: ppeAllowance.value, unit: t('payrollPage.perWeek') },
])
const hasCurrentExchangeRate = computed(() => currentCurrency.value === 'AUD' || Number.isFinite(exchangeRates.value[currentCurrency.value]))

// Smoko：全域規則來自工作設定；當天的次數可另外覆寫，不會改到全域設定
const profileSmoko = computed(() => getSmokoInputs(workSetup.profile.value.smoko))
const smokoMinutesPerBreak = computed(() => profileSmoko.value.deductMinutesPerBreak)
const smokoCountOverride = ref(null)
const effectiveSmokoCountOverride = computed(() =>
  smokoCountOverride.value !== null ? smokoCountOverride.value : profileSmoko.value.smokoCountOverride,
)

watch(currentCurrency, async (currency) => {
  if (!authToken.value || rateWritePaused) return
  try {
    await apiRequest('/dashboard-settings/display-currency', { method: 'PUT', body: { currency } })
  } catch (error) { showToast(error.message) }
})
watch([baseRate, ppeAllowance, withholdingTaxRate, confirmedLoadingRates], async () => {
  // 還沒完成薪資設定時不寫入，避免把 0 當成會員的費率
  if (!authToken.value || rateWritePaused || workSetup.profile.value.payStatus === PAY_STATUS.NOT_CONFIGURED) return
  try {
    await apiRequest('/salary-rates', {
      method: 'PUT',
      body: {
        ...confirmedLoadingRates.value,
        baseRate: baseRate.value,
        ppeAllowance: ppeAllowance.value,
        withholdingTaxRate: withholdingTaxRate.value,
      },
    })
  } catch (error) { showToast(error.message) }
})

watch([workDate, startTime, endTime, shiftType], () => {
  smokoCountOverride.value = null
})

const displayedSmokoCount = computed(() => {
  if (smokoCountOverride.value !== null) return smokoCountOverride.value
  return workSummary.value?.smokoCount ?? 0
})

// --- 5. 新增：提早換裝 5 分鐘打卡開關 ---
const enablePrepTime = ref(true) // 預設開啟

// 換裝時間計薪：預覽與儲存都使用同一個實際計薪起點（見 src/domain/prepTime.js）
const currentPrepMinutes = computed(() => (enablePrepTime.value ? PREP_MINUTES : 0))
const effectiveShiftStart = computed(() => {
  if (shiftType.value === 'leave') return { workDate: workDate.value, startTime: '00:00' }
  return (
    applyPrepTime(workDate.value, startTime.value, currentPrepMinutes.value) ?? {
      workDate: workDate.value,
      startTime: startTime.value,
    }
  )
})
const effectiveWorkDate = computed(() => effectiveShiftStart.value.workDate)
const effectiveStartTime = computed(() => effectiveShiftStart.value.startTime)

// 原本的 effectiveEndTime 維持不變
const effectiveEndTime = computed(() => shiftType.value === 'leave' ? '00:00' : endTime.value)

const {
  workSummary,
  isNightShift,
  holidaySummary,
  paidSegmentedMinutes,
  saturdayRuleBreakdown,
  payBreakdown,
} = useShiftCalculator({
  workDate: effectiveWorkDate,
  startTime: effectiveStartTime,
  endTime: effectiveEndTime,
  smokoMinutesPerBreak,
  smokoCountOverride: effectiveSmokoCountOverride,
  baseRate,
  casualLoadingRate,
  shiftLoadingRate,
  saturdayOrdLoadingRate,
  timeHalfRate,
  doubleRate,
  sundayLoadingRate,
})

// 這天的試算用到哪些未確認的費率（畫面標示「含未確認費率，僅供參考」或「未含」）
const todayRateFlags = computed(() => getRateFlags(payBreakdown.value, rateStatus.value))

// 🐛 BUG 完美修復：當狀態為請假時，100% 寫死生成 0 元數據，斬草除根
const buildWorkRecordFromInputs = ({
  id,
  workDate: inputWorkDate,
  startTime: inputStartTime,
  endTime: inputEndTime,
  smokoCountOverride: inputSmokoCountOverride = null,
  shiftType: inputShiftType = 'normal',
  isCleaningDay: inputIsCleaningDay = false,
  remark: inputRemark = '',
  designatedWork: inputDesignatedWork = false,
  prepMinutes: inputPrepMinutes = 0,
  // 沒有指定時沿用工作設定的 Smoko 規則（自動或固定次數、每次分鐘數、是否計薪）
  smokoMinutes: inputSmokoMinutes = smokoMinutesPerBreak.value,
  // 補登時使用者把某天改成「自動」：不套用工作設定的固定次數
  forceAutoSmoko = false,
}) => {

  if (inputShiftType === 'leave') {
    const record = createWorkRecord({
      id,
      workDate: inputWorkDate,
      startTime: '00:00',
      endTime: '00:00',
      workSummary: { totalMinutes: 0, paidMinutes: 0, smokoCount: 0, crossesMidnight: false, smokoDeductMinutes: 0 },
      paidSegmentedMinutes: { weekdayPaidMinutes: 0, sundayPaidMinutes: 0, saturdayPaidMinutes: 0, holidayPaidMinutes: 0 },
      saturdayRuleBreakdown: { satOrdMinutes: 0, timeHalfMinutes: 0, doubleMinutes: 0 },
      payBreakdown: { basePay: 0, casualPay: 0, shiftPay: 0, holidayPenaltyPay: 0, satOrdPay: 0, timeHalfPay: 0, doublePay: 0, sunOrdPay: 0, grossPay: 0, holidayPenaltyRate: 0 },
    })
    record.shiftType = 'leave'
    record.isCleaningDay = false
    record.remark = inputRemark
    record.designatedWork = false
    record.prepMinutes = 0
    return record
  }

  // 薪資用套用換裝時間後的起點計算；紀錄仍保存使用者輸入的上班時間
  const paidStart = applyPrepTime(inputWorkDate, inputStartTime, inputPrepMinutes) ?? {
    workDate: inputWorkDate,
    startTime: inputStartTime,
  }
  const tempWorkDate = ref(paidStart.workDate)
  const tempStartTime = ref(paidStart.startTime)
  const tempEndTime = ref(inputEndTime)
  const tempSmokoCountOverride = ref(forceAutoSmoko ? null : (inputSmokoCountOverride ?? profileSmoko.value.smokoCountOverride))
  const tempSmokoMinutes = ref(inputSmokoMinutes)

  const {
    workSummary: tempWorkSummary,
    paidSegmentedMinutes: tempPaidSegmentedMinutes,
    saturdayRuleBreakdown: tempSaturdayRuleBreakdown,
    payBreakdown: tempPayBreakdown,
  } = useShiftCalculator({
    workDate: tempWorkDate,
    startTime: tempStartTime,
    endTime: tempEndTime,
    smokoMinutesPerBreak: tempSmokoMinutes,
    smokoCountOverride: tempSmokoCountOverride,
    baseRate,
    casualLoadingRate,
    shiftLoadingRate,
    saturdayOrdLoadingRate,
    timeHalfRate,
    doubleRate,
    sundayLoadingRate,
  })

  if (!tempWorkSummary.value || !tempPayBreakdown.value) return null

  const record = createWorkRecord({
    id,
    workDate: inputWorkDate,
    startTime: inputStartTime,
    endTime: inputEndTime,
    workSummary: tempWorkSummary.value,
    paidSegmentedMinutes: tempPaidSegmentedMinutes.value,
    saturdayRuleBreakdown: tempSaturdayRuleBreakdown.value,
    payBreakdown: tempPayBreakdown.value,
  })
  
  record.shiftType = inputShiftType
  record.isCleaningDay = inputIsCleaningDay
  record.remark = inputRemark
  record.designatedWork = inputDesignatedWork
  record.prepMinutes = paidStart.startTime === inputStartTime ? 0 : inputPrepMinutes
  // 記下這一班用到哪些未確認費率；之後費率變更不會改寫這筆紀錄的金額
  record.rateFlags = getRateFlags(tempPayBreakdown.value, rateStatus.value)
  return record
}

// --- 集簽：進度、首次設定、補登歷史班表 ---
const visaProgress = computed(() =>
  getVisaJourneyProgress({
    settings: visaJourney.value,
    records: records.value,
    payslips: workSetup.payslips.value,
    profile: workSetup.profile.value,
    today: getTodayDate(),
  }),
)

async function saveVisaJourney(settings) {
  const saved = await visaJourneyRepository.save(settings)
  visaJourney.value = saved
  visaSetupOpen.value = false
  if (saved.goal === 'NONE') return showToast(t('payrollPage.visaNone'))
  showToast(t('payrollPage.visaStarted'))
  if (!saved.started || visaProgress.value?.hasHistory) return
  try {
    await showConfirmDialog({
      title: t('payrollPage.historyPromptTitle'),
      message: t('payrollPage.historyPromptMessage'),
      confirmButtonText: t('payrollPage.historyPromptConfirm'),
      cancelButtonText: t('payrollPage.later'),
    })
    openHistoryWizard()
  } catch {
    // 稍後再補登：首頁卡片會保留入口
  }
}

// 「⋯」選單：不常用或有風險的月份操作
const monthMenuActions = computed(() => [
  { name: t('payrollPage.fillWeek'), run: () => fillCurrentWeek() },
  { name: t('payrollPage.addHistory'), run: () => openHistoryWizard() },
  {
    name: t('payrollPage.clearMonth'),
    color: '#ee0a24',
    disabled: displayedMonthRecords.value.length === 0,
    run: () => clearCurrentMonth(),
  },
])

function openHistoryWizard() {
  // 補登要依使用者自己的班別與排班；還沒設定就先完成工作設定
  if (!workSetup.requireSetup({ type: 'HISTORY_IMPORT', label: t('payrollPage.historyLabel') })) return
  historyWizardOpen.value = true
}

/** 補登精靈用：依草稿用既有薪資計算建立一筆上班紀錄 */
function buildHistoryWork(draft, id) {
  return buildWorkRecordFromInputs({
    id,
    workDate: draft.date,
    startTime: draft.startTime,
    endTime: draft.endTime,
    shiftType: 'normal',
    isCleaningDay: draft.isCleaningDay,
    remark: '',
    designatedWork: true,
    prepMinutes: currentPrepMinutes.value,
    smokoCountOverride: draft.smokoMode === 'MANUAL' ? draft.smokoCount : null,
    forceAutoSmoko: draft.smokoMode === 'AUTO',
  })
}

let historyIdCursor = 0
function nextHistoryId() {
  historyIdCursor = Math.max(historyIdCursor + 1, nextRecordId(records.value))
  return historyIdCursor
}

async function saveHistoryRecords(newRecords) {
  const taken = new Set(records.value.map((record) => record.workDate))
  const additions = newRecords.filter((record) => !taken.has(record.workDate))
  records.value = ensureUniqueRecordIds([...records.value, ...additions])
  await nextTick()
  // 會員：等同步完成才回報成功，確保重新登入後資料還在
  if (authToken.value) {
    await workPersistence.flush()
    if (workPersistence.hasPendingChanges()) throw new Error(t('payrollPage.pendingNotSaved'))
  }
  loadSelectedDate()
  return additions.length
}

function viewVisaProgress() {
  historyWizardOpen.value = false
  activeTab.value = 'dashboard'
  nextTick(() => document.querySelector('.visa-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
}

// --- 請假（單日或批次） ---
function applyLeave({ dates, leaveType, conflictMode }) {
  let cursor = nextRecordId(records.value)
  records.value = applyBatchLeave(records.value, dates, { leaveType, conflictMode, nextId: () => cursor++ })
  batchLeaveOpen.value = false
  loadSelectedDate()
  showToast(dates.length === 1 ? t('payrollPage.leaveSetOne', { date: dates[0] }) : t('payrollPage.leaveSetMany', { count: dates.length }))
}

/** 批次請假時改成請假的工作日，可以恢復原本的時間 */
function restoreReplacedWork() {
  const previous = selectedRecord.value?.replacedWork
  if (!previous) return
  const record = buildWorkRecordFromInputs({
    id: selectedRecord.value.id,
    workDate: workDate.value,
    startTime: previous.startTime,
    endTime: previous.endTime,
    shiftType: 'normal',
    isCleaningDay: previous.isCleaningDay,
    remark: selectedRecord.value.remark || '',
    designatedWork: previous.designatedWork === true,
    prepMinutes: currentPrepMinutes.value,
    smokoCountOverride: Number.isInteger(previous.smokoCount) ? previous.smokoCount : null,
  })
  if (!record) return showToast(t('payrollPage.restoreFailed'))
  if (selectedRecord.value.source) record.source = selectedRecord.value.source
  records.value = upsertRecordForDate(records.value, record)
  loadSelectedDate()
  showToast(t('payrollPage.restored', { start: previous.startTime, end: previous.endTime }))
}

const markSelectedDateAsLeave = () => {
  const record = buildWorkRecordFromInputs({
    id: selectedRecord.value?.id ?? nextRecordId(records.value),
    workDate: workDate.value,
    startTime: '00:00',
    endTime: '00:00',
    shiftType: 'leave',
    remark: selectedRecord.value?.remark || '',
  })
  records.value = upsertRecordForDate(records.value, record)
  loadSelectedDate()
  showToast(t('payrollPage.setAsLeave', { date: workDate.value }))
}

const restoreSelectedDateShift = () => {
  const defaults = selectedPlannedShift.value
  if (!defaults) {
    shiftType.value = 'normal'
    startTime.value = ''
    endTime.value = ''
    openSelectedDateEditor()
    showToast(t('payrollPage.chooseTimes'))
    return
  }
  if (!workSetup.requireSetup({ type: 'ADD_SHIFT', label: t('payrollPage.addShiftLabel') }, 'pay')) return
  // 恢復出勤使用使用者自己的每週排班；休假紀錄不保存先前的工時。
  const record = buildWorkRecordFromInputs({
    id: selectedRecord.value?.id ?? nextRecordId(records.value),
    workDate: workDate.value,
    startTime: defaults.startTime,
    endTime: defaults.endTime,
    shiftType: 'normal',
    isCleaningDay: defaults.isCleaningDay,
    remark: selectedRecord.value?.remark || '',
    prepMinutes: currentPrepMinutes.value,
  })
  if (!record) return
  records.value = upsertRecordForDate(records.value, record)
  loadSelectedDate()
  showToast(t('payrollPage.defaultRestored', { date: workDate.value }))
}

const openSelectedDateEditor = () => {
  daySheetOpen.value = true
}

// --- 本週總結加總：只計算目前選取日期所在的週（週一至週日）---
const weeklyPaySummary = computed(() =>
  getWeeklyPaySummary(records.value, workDate.value, {
    ppeAllowance: ppeAllowance.value,
    withholdingTaxRate: withholdingTaxRate.value,
  }),
)
const weeklyRangeLabel = computed(() => {
  const range = weeklyPaySummary.value.range
  if (!range) return ''
  const short = (date) => date.slice(5).replace('-', '/')
  return `${short(range.start)}–${short(range.end)}`
})
const weeklySubtotal = computed(() => centsToDollars(weeklyPaySummary.value.shiftCents))
const weeklyPPE = computed(() => centsToDollars(weeklyPaySummary.value.ppeCents))
const weeklyTotal = computed(() => centsToDollars(weeklyPaySummary.value.grossCents))
const weeklyTaxEstimate = computed(() => centsToDollars(weeklyPaySummary.value.taxCents))
const weeklyNetTotal = computed(() => centsToDollars(weeklyPaySummary.value.netCents))
const weeklyTaxRateLabel = computed(() => `${roundTo(withholdingTaxRate.value * 100, 2)}%`)
const convertedNetTotal = computed(() => roundTo(weeklyNetTotal.value * currentExchangeRate.value, 2))

const isEditingRecord = computed(() => Boolean(selectedRecord.value))

// ======= 備份控制中心與 Excel 生成引擎 =======
const exportTodayJson = () => {
  if (!workSummary.value || !payBreakdown.value) return
  const todayRecord = buildWorkRecordFromInputs({ workDate: workDate.value, startTime: startTime.value, endTime: endTime.value, smokoCountOverride: smokoCountOverride.value, shiftType: shiftType.value, isCleaningDay: isCleaningDay.value, remark: remark.value, designatedWork: selectedRecord.value?.designatedWork === true, prepMinutes: currentPrepMinutes.value })
  if (!todayRecord) return
  const blob = new Blob([JSON.stringify(todayRecord, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = `${workDate.value}.json`; link.click(); URL.revokeObjectURL(url)
}

const exportWeeklyJson = () => {
  if (records.value.length === 0) return
  const blob = new Blob([JSON.stringify(records.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'weekly-records.json'; link.click(); URL.revokeObjectURL(url)
}

const exportWeeklyXlsx = () => {
  if (records.value.length === 0) return
  const sortedExportRecords = [...records.value].sort((a, b) => { if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate); return a.startTime.localeCompare(b.startTime) })
  let cumulativePaidHours = 0
  const totalRawMinutes = sortedExportRecords.reduce((sum, record) => sum + record.totalMinutes, 0)
  const totalSmokoCount = sortedExportRecords.reduce((sum, record) => sum + record.smokoCount, 0)
  const totalSmokoDeductMinutes = sortedExportRecords.reduce((sum, record) => sum + record.smokoDeductMinutes, 0)
  const totalPaidMinutes = sortedExportRecords.reduce((sum, record) => sum + record.paidMinutes, 0)
  const totalBasePay = roundTo(sortedExportRecords.reduce((sum, record) => sum + record.basePay, 0), 2)
  const totalCasualPay = roundTo(sortedExportRecords.reduce((sum, record) => sum + record.casualPay, 0), 2)
  const totalShiftPay = roundTo(sortedExportRecords.reduce((sum, record) => sum + record.shiftPay, 0), 2)
  const totalGrossPay = roundTo(sortedExportRecords.reduce((sum, record) => sum + record.grossPay, 0), 2)
  const totalPaidHours = roundTo(totalPaidMinutes / 60, 4)
  const totalBaseHours = roundTo((totalPaidMinutes - sortedExportRecords.reduce((sum, r) => sum + r.timeHalfMinutes + r.doubleMinutes, 0)) / 60, 4)

  const exportRows = sortedExportRecords.map((record) => {
    cumulativePaidHours = roundTo(cumulativePaidHours + record.paidMinutes / 60, 4)
    return ({ 日期: record.workDate, 開始時間: record.startTime, 結束時間: record.endTime, 計薪工時分鐘: record.paidMinutes, 當日總薪資: record.grossPay, 加總工時: cumulativePaidHours, 備註事項: record.remark || '' })
  })
  exportRows.push({ 日期: '合計', 開始時間: '', 結束時間: '', 計薪工時分鐘: totalPaidMinutes, 當日總薪資: totalGrossPay, 加總工時: totalPaidHours, 備註事項: '' })
  const ws = XLSX.utils.json_to_sheet(exportRows); const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Weekly Summary'); XLSX.writeFile(wb, 'weekly-summary.xlsx')
}
// =============================================================

const getDayOfWeek = (dateStr) => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const [y, m, d] = dateStr.split('-').map(Number)
  return days[new Date(y, m - 1, d).getDay()]
}

/** 儲存目前編輯中的這天；成功回傳 true */
const addTodayRecordToList = () => {
  if (shiftType.value !== 'leave') {
    if (hasInvalidTimeInput.value) {
      showToast(t('payrollPage.timeFormat'))
      return false
    }
    if (!isValidTime(startTime.value) || !isValidTime(endTime.value)) {
      showToast(t('payrollPage.chooseTimesFirst'))
      return false
    }
    // 需要計算薪資的班表：先確認費率（休假紀錄不需要）
    if (!workSetup.requireSetup({ type: 'ADD_SHIFT', label: t('payrollPage.saveDayLabel') }, 'pay')) return false
  }

  const todayRecord = buildWorkRecordFromInputs({
    id: selectedRecord.value?.id ?? nextRecordId(records.value),
    workDate: workDate.value,
    startTime: startTime.value,
    endTime: endTime.value,
    smokoCountOverride: smokoCountOverride.value,
    shiftType: shiftType.value,
    isCleaningDay: isCleaningDay.value,
    remark: remark.value,
    designatedWork: selectedRecord.value?.designatedWork === true,
    prepMinutes: currentPrepMinutes.value,
  })

  if (!todayRecord) return false
  const wasExisting = Boolean(selectedRecord.value)
  records.value = upsertRecordForDate(records.value, todayRecord)
  markDayEditorClean()
  showToast(wasExisting ? t('payrollPage.updatedDay') : t('payrollPage.addedDay'))
  return true
}

// 日曆卡片上一鍵標記／取消清潔日：換成該班別的清潔日時間並直接儲存（主管前一天公布時用）
const selectedDayIsCleaning = computed(() => selectedRecord.value?.isCleaningDay === true)
const canToggleCleaning = computed(() =>
  selectedRecord.value ? selectedRecord.value.shiftType !== 'leave' : Boolean(selectedPlannedShift.value),
)
const toggleSelectedDateCleaning = () => {
  loadSelectedDate()
  if (shiftType.value === 'leave' || !isValidTime(startTime.value) || !isValidTime(endTime.value)) {
    showToast(t('payrollPage.noShiftForCleaning'))
    return
  }
  setCleaningDay(!isCleaningDay.value)
  addTodayRecordToList()
  const saved = selectedRecord.value
  if (!saved) return
  showToast(t(saved.isCleaningDay ? 'payrollPage.cleaningSet' : 'payrollPage.cleaningUnset', { start: saved.startTime, end: saved.endTime }))
}

const editRecord = async (record) => {
  if (record.workDate !== workDate.value && !(await confirmLeaveDayEditor())) return
  workDate.value = record.workDate
  loadSelectedDate()
  scheduleSections.value = []
  expandedRecordId.value = ''
  daySheetOpen.value = true
}

const cancelEditingRecord = () => {
  loadSelectedDate()
  showToast(t('payrollPage.reverted'))
}

const deleteRecord = (recordId) => {
  records.value = records.value.filter((record) => record.id !== recordId)
  if (expandedRecordId.value === recordId) expandedRecordId.value = ''
  loadSelectedDate()
}

const markDesignatedWorkDate = ({ date, marked }) => {
  records.value = records.value.map((record) =>
    record.workDate === date && record.shiftType !== 'leave' && record.paidMinutes > 0
      ? { ...record, designatedWork: marked }
      : record,
  )
}
</script>

<template>
  <div v-if="!appReady" class="boot-splash" role="status" aria-live="polite">
    <span class="boot-splash__mark" aria-hidden="true"><van-icon name="balance-o" /></span>
    <van-loading size="28" color="var(--color-primary, #1989fa)" />
    <span class="visually-hidden">{{ t('app.loading') }}</span>
    <p class="boot-splash__hint" :class="{ 'boot-splash__hint--show': bootSlow }">{{ t('app.firstLoadSlow') }}</p>
  </div>
  <div v-else class="page">
    <div v-if="activeTab !== 'dashboard'" class="account-shell">
      <div class="account-card" :class="{ 'account-card--shopping-guest': !authToken && activeTab === 'shopping' }">
        <span class="account-card__avatar" aria-hidden="true">
          <van-icon :name="authToken ? 'user-circle-o' : 'user-o'" />
        </span>
        <div class="account-card__identity">
          <strong>{{ authToken ? accountNickname || t('app.loggedIn') : activeTab === 'shopping' ? t('app.guestMode') : t('app.guestTrial') }}</strong>
          <span :title="authToken ? authEmail : undefined">
            {{ authToken ? authEmail : activeTab === 'shopping' ? t('app.guestShoppingNote') : t('app.guestSaveNote') }}
          </span>
        </div>
        <van-button size="small" plain type="primary" class="account-card__action"
          @click="openAccount">
          {{ authToken ? t('nav.account') : t('app.loginOrSignUp') }}
        </van-button>
      </div>
    </div>
    <AuthPanel v-model:show="authPanelOpen" @signed-in="handleSignedIn" @open-privacy="privacyOpen = true" />
    <PrivacyPage v-model:show="privacyOpen" />
    <VisaJourneySetup v-model:show="visaSetupOpen" :settings="visaJourney" :today="getTodayDate()" :submit="saveVisaJourney" />
    <HistoryImportWizard
      v-model:show="historyWizardOpen"
      :records="records"
      :profile="workSetup.profile.value"
      :build-work="buildHistoryWork"
      :next-id="nextHistoryId"
      :default-start="visaJourney?.workStart || ''"
      :today="getTodayDate()"
      :submit="saveHistoryRecords"
      @view-progress="viewVisaProgress"
    />
    <DashboardPage
      v-show="activeTab === 'dashboard'"
      :work-records="records"
      :active="activeTab === 'dashboard'"
      :payroll-rates="{ ppeAllowance, withholdingTaxRate }"
      :employer-ytd="workSetup.employerYtd.value"
      :latest-payslip="workSetup.latestPayslip.value"
      :setup="setupState"
      :tax-source="workSetup.profile.value.taxRateSource"
      :visa-journey="visaJourney"
      :visa-progress="visaProgress"
      :display-currency="dashboardCurrency"
      :workplace="workSetup.profile.value.workplace"
      @save-workplace="saveWorkplace"
      @change-currency="showCurrencyPicker = true"
      @visa-setup="visaSetupOpen = true"
      @import-history="openHistoryWizard"
      @mark-work-date="markDesignatedWorkDate"
      @navigate="activeTab = $event"
      @open-account="openAccount"
      @quick-action="handleQuickAction"
      @adjust-shift="openDayEditorFromHome"
      @import-payslip="payslipImportOpen = true"
      @work-setup="openWorkSetup($event)"
    />
    <PayslipImport
      v-model:show="payslipImportOpen"
      :current-rates="currentRateValues"
      :rate-sources="rateSources"
      :is-member="Boolean(authToken)"
      :existing-deposits="payslipDeposits"
      :existing-payslips="workSetup.payslips.value"
      :first-time="!workSetup.latestPayslip.value"
      @apply="applyPayslipImport"
      @manual="openManualRates"
    />
    <WorkSetupGate
      v-model:show="workSetup.gate.value.show"
      :needs="workSetup.gate.value.needs"
      :pending-label="workSetup.pendingAction.value?.label ?? ''"
      @upload-payslip="openPayslipFromSetup"
      @manual="openWorkSetup(1, { manual: true })"
      @schedule="openWorkSetup(2)"
    />
    <WorkSetupWizard
      v-model:show="workSetup.wizard.value.show"
      :step="workSetup.wizard.value.step"
      :manual="wizardManual"
      :profile="workSetup.profile.value"
      :pay="{ baseRate, ppeAllowance, withholdingTaxRate, loadings: confirmedLoadingRates }"
      :latest-payslip="workSetup.latestPayslip.value"
      :pending-action="workSetup.pendingAction.value"
      :preview-week="previewSetupWeek"
      :save-pay="workSetup.applyManualPay"
      :save-schedule="workSetup.saveSchedule"
      @upload-payslip="openPayslipFromSetup"
      @continue="continuePendingAction"
    />
    <FillPreviewSheet
      v-model:show="fillPreviewOpen"
      :preview="fillPreview"
      @confirm="confirmFillPreview"
      @edit-setup="fillPreviewOpen = false; openWorkSetup(2)"
    />
    <AccountPage
      v-if="authToken"
      v-model:show="accountSheetOpen"
      @sign-out="handleSignOut"
      @account-deleted="handleAccountDeleted"
      @open-privacy="privacyOpen = true"
      @profile-updated="accountNickname = $event.nickname || ''"
    />
    <section v-show="activeTab === 'payroll'" class="payroll-page app-page">
    <div class="header app-page__header">
      <div class="header-main">
        <h1>{{ t('payrollPage.title') }}</h1>
        <van-button size="small" plain type="primary" class="global-currency-btn" @click="showCurrencyPicker = true">
          {{ currencyFlag }} {{ currentCurrency }}
        </van-button>
      </div>
    </div>

    <div class="payroll-views" role="tablist" :aria-label="t('payrollPage.viewsAria')">
      <button
        v-for="view in PAYROLL_VIEWS"
        :key="view.id"
        type="button"
        role="tab"
        :aria-selected="payrollView === view.id"
        :class="{ 'is-active': payrollView === view.id }"
        @click="switchPayrollView(view.id)"
      >
        {{ t(`payrollPage.views.${view.id}`) }}
      </button>
    </div>

    <section v-if="payrollView === 'settings' || !setupState.ready" class="work-setup-card" :class="{ 'work-setup-card--todo': !setupState.ready }" aria-labelledby="work-setup-title">
      <div class="work-setup-card__head">
        <span class="work-setup-card__icon" aria-hidden="true">
          <van-icon :name="setupState.ready ? 'passed' : 'setting-o'" />
        </span>
        <div>
          <h2 id="work-setup-title">{{ t('payroll.workSetup') }}</h2>
          <p v-if="!setupState.ready">{{ t('payrollPage.setupIntro') }}</p>
          <p v-else>{{ t('payrollPage.setupDone') }}</p>
        </div>
      </div>
      <button type="button" class="work-setup-card__row" @click="openWorkSetup(1)">
        <span class="work-setup-card__label">{{ t('payroll.payRates') }}</span>
        <span class="work-setup-card__value">
          <template v-if="setupState.payReady">
            ${{ baseRate.toFixed(2) }}{{ t('payrollPage.perHour') }} ·
            {{ workSetup.profile.value.payStatus === PAY_STATUS.PAYSLIP_CONFIRMED ? t('work.payslipConfirmed') : t('work.manualRates') }}
          </template>
          <em v-else>{{ t('work.notConfigured') }}</em>
        </span>
        <van-icon name="arrow" aria-hidden="true" />
      </button>
      <button type="button" class="work-setup-card__row" @click="openWorkSetup(2)">
        <span class="work-setup-card__label">{{ t('payroll.shiftsAndDays') }}</span>
        <span class="work-setup-card__value">
          <template v-if="setupState.scheduleReady">
            <span v-for="line in describeWeekPlan(workSetup.profile.value)" :key="line" class="work-setup-card__line">{{ line }}</span>
          </template>
          <em v-else>{{ t('work.notConfigured') }}</em>
        </span>
        <van-icon name="arrow" aria-hidden="true" />
      </button>
      <button v-if="setupState.scheduleReady" type="button" class="work-setup-card__row" @click="openWorkSetup(3)">
        <span class="work-setup-card__label">Smoko</span>
        <span class="work-setup-card__value">{{ describeSmoko(workSetup.profile.value.smoko) }}</span>
        <van-icon name="arrow" aria-hidden="true" />
      </button>
      <van-button v-if="!setupState.ready" type="primary" block class="work-setup-card__cta" @click="openWorkSetup()">
        {{ setupState.payReady ? t('payrollPage.setShifts') : t('payrollPage.startSetup') }}
      </van-button>
    </section>

    <!-- 工作設定完成後，班表段只留一行摘要；點了到「設定」段看完整內容 -->
    <button
      v-if="payrollView === 'schedule' && setupState.ready"
      type="button"
      class="work-setup-summary"
      @click="switchPayrollView('settings')"
    >
      <span class="work-setup-summary__text">
        <strong>A${{ baseRate.toFixed(2) }}{{ t('payrollPage.perHour') }}</strong>
        <span v-if="setupShiftNames"> · {{ setupShiftNames }}</span> · {{ t('payrollPage.configured') }}
      </span>
      <van-icon name="arrow" aria-hidden="true" />
    </button>

    <div v-show="payrollView === 'schedule'" class="section calendar-section">
      <div class="calendar-intro">
        <p class="calendar-help">{{ t('payrollPage.calendarHelp') }}</p>
        <p class="calendar-net-legend">
          <span>{{ t('payrollPage.dailyNetFormula') }}</span>
          <strong>{{ t('common.currencyUnit', { currency: dashboardCurrency.code }) }}</strong>
        </p>
      </div>
      <div class="calendar-month-actions">
        <span>{{ t('payrollPage.showingMonth', { month: visibleMonth }) }}</span>
        <van-button size="small" type="primary" icon="calendar-o" @click="fillCurrentMonth">{{ t('payroll.monthFill') }}</van-button>
        <van-button size="small" plain type="warning" @click="batchLeaveOpen = true">{{ t('payroll.leaveRange') }}</van-button>
        <van-button size="small" plain icon="ellipsis" :aria-label="t('payrollPage.moreActions')" @click="monthMenuOpen = true" />
      </div>
      <div class="calendar-wrapper">
        <van-calendar
          ref="payrollCalendar"
          :poppable="false"
          :show-confirm="false"
          :default-date="calendarDefaultDate"
          :min-date="calendarMinDate"
          :max-date="calendarMaxDate"
          :formatter="holidayCalendarFormatter"
          switch-mode="year-month"
          @select="onDateSelect"
          @panel-change="onCalendarPanelChange"
        />
      </div>
    </div>


    <BlackoutNoticeSheet
      v-model:show="showBlackoutEditor"
      :notices="selectedNotices"
      :date="workDate"
      :save="saveBlackoutNotice"
      :remove="removeBlackoutNotice"
    />
    <BatchLeaveSheet v-model:show="batchLeaveOpen" :records="records" :default-date="workDate" @apply="applyLeave" />

    <van-action-sheet
      v-model:show="monthMenuOpen"
      :actions="monthMenuActions"
      :cancel-text="t('common.cancel')"
      close-on-click-action
      @select="(action) => action.run()"
    />
    <!-- 當天面板：點日曆上的日期就從底部滑出，班別、時間、請假、預估都在這裡完成 -->
    <van-popup
      v-model:show="daySheetOpen"
      position="bottom"
      round
      safe-area-inset-bottom
      teleport="body"
      class="payroll-day-sheet"
      :before-close="beforeDaySheetClose"
    >
      <div class="pday__body">
          <div class="calendar-day-actions">
            <div class="calendar-day-actions__heading">
              <div>
                <strong>{{ workDate }} <small>{{ getDayOfWeek(workDate) }}</small></strong>
                <p v-if="selectedRecord?.shiftType === 'leave'">{{ t('payrollPage.leaveUnpaid', { label: leaveTypeLabel(selectedRecord.leaveType, getLeaveLabel(selectedRecord)) }) }}</p>
                <p v-else-if="selectedRecord">{{ t('payrollPage.rostered', { start: selectedRecord.startTime, end: selectedRecord.endTime }) }}</p>
                <p v-else>{{ t('payrollPage.notRostered') }}</p>
                <button v-for="notice in selectedNotices" :key="notice.id" type="button" class="calendar-day-actions__blackout" @click="openFromDaySheet(openBlackoutEditor)">
                  {{ t('payrollPage.blackoutNotice') }}{{ notice.title ? `：${notice.title}` : '' }} <span>{{ t('payrollPage.view') }}</span>
                </button>
                <p v-if="selectedRecord?.source === 'HISTORICAL_USER_CONFIRMED'" class="calendar-day-actions__source">{{ t('payrollPage.userAdded') }}</p>
              </div>
              <strong
                v-if="hasDailyNetActivity(selectedDailyNet)"
                class="calendar-day-actions__pay"
                :class="`day-net--${selectedDailyNet.netCents > 0 ? 'positive' : selectedDailyNet.netCents < 0 ? 'negative' : 'zero'}`"
              >
                <small>{{ t('payrollPage.estimatedNet') }}</small>
                {{ signedCalendarMoney(selectedDailyNet.netCents) }}
              </strong>
              <button type="button" class="pday__close" :aria-label="t('common.close')" @click="closeDaySheet">
                <van-icon name="cross" />
              </button>
            </div>
            <div class="calendar-day-actions__buttons">
              <van-button v-if="selectedRecord?.shiftType === 'leave'" block plain type="primary" @click="restoreSelectedDateShift">{{ selectedDateHasDefaultShift ? t('payrollPage.restoreShift', { name: selectedPlannedShift.name }) : t('payrollPage.setWorkTime') }}</van-button>
              <van-button v-else block plain type="danger" @click="openFromDaySheet(() => (batchLeaveOpen = true))">{{ t('payrollPage.leaveEllipsis') }}</van-button>
              <van-button v-if="selectedRecord?.replacedWork" block plain type="primary" @click="restoreReplacedWork">{{ t('payrollPage.restoreOriginal', { start: selectedRecord.replacedWork.startTime, end: selectedRecord.replacedWork.endTime }) }}</van-button>
              <van-button v-if="canToggleCleaning" block plain type="success" @click="toggleSelectedDateCleaning">{{ selectedDayIsCleaning ? t('payrollPage.unsetCleaning') : t('payrollPage.setCleaning') }}</van-button>
              <van-button block plain type="warning" class="calendar-day-actions__blackout-button" @click="openFromDaySheet(openBlackoutEditor)">
                {{ selectedNotices.length ? t('payrollPage.viewBlackout') : t('payrollPage.addBlackout') }}
              </van-button>
            </div>
            <p v-if="selectedRecord?.shiftType === 'leave'" class="calendar-day-actions__hint">{{ selectedDateHasDefaultShift ? t('payrollPage.restoreHint', { start: selectedPlannedShift.startTime, end: selectedPlannedShift.endTime }) : t('payrollPage.setTimesHint') }}</p>
            <p class="calendar-day-actions__hint">{{ t('payrollPage.reminderOnly') }}</p>
          </div>
        <section class="day-money" aria-labelledby="day-money-title">
          <h2 id="day-money-title">{{ t('payrollPage.dayMoney') }} <small>{{ t('payrollPage.estimateUnit', { currency: dashboardCurrency.code }) }}</small></h2>
          <p v-if="!hasDailyNetActivity(selectedDailyNet)" class="day-money__empty">{{ t('payrollPage.noDayMoney') }}</p>
          <template v-else>
            <dl class="day-money__summary">
              <div><dt>{{ t('payrollPage.workIncomeGross') }}</dt><dd>{{ calendarMoney(selectedDailyNet.workCents) }}</dd></div>
              <div><dt>{{ t('calendar.tripReceivable') }}</dt><dd>{{ calendarMoney(selectedDailyNet.fareCents) }}</dd></div>
              <div><dt>{{ t('calendar.expenses') }}</dt><dd>{{ signedCalendarMoney(-selectedDailyNet.expenseCents) }}</dd></div>
              <div v-if="selectedDailyNet.investmentLossCents > 0"><dt>{{ t('payrollPage.investmentLoss') }}</dt><dd>{{ signedCalendarMoney(-selectedDailyNet.investmentLossCents) }}</dd></div>
              <div class="day-money__net" :class="`day-net--${selectedDailyNet.netCents > 0 ? 'positive' : selectedDailyNet.netCents < 0 ? 'negative' : 'zero'}`"><dt>{{ t('payrollPage.estimatedNet') }}</dt><dd>{{ signedCalendarMoney(selectedDailyNet.netCents) }}</dd></div>
            </dl>
            <ul class="day-money__items">
              <li v-for="item in selectedDailyNet.workItems" :key="`work-${item.id}`">
                <button type="button" @click="scrollToWorkInput">
                  <span class="day-money__kind day-money__kind--work">{{ t('payrollPage.kindWork') }}</span>
                  <span class="day-money__label">{{ t('payrollPage.rosterEstimate', { start: item.startTime, end: item.endTime }) }}</span>
                  <strong class="is-income">+{{ calendarMoney(item.grossCents) }}</strong>
                </button>
              </li>
              <li v-for="(item, index) in selectedDailyNet.fareItems" :key="`fare-${item.tripId}-${item.passengerId}-${index}`">
                <button type="button" @click="openDayTrip(item.tripId)">
                  <span class="day-money__kind day-money__kind--fare">{{ t('payrollPage.kindFare') }}</span>
                  <span class="day-money__label">
                    {{ item.passengerName || t('payrollPage.passenger') }}
                    <small>{{ item.receivedCents >= item.amountCents ? t('payrollPage.fullyReceived') : item.receivedCents > 0 ? t('payrollPage.partlyReceived', { amount: calendarMoney(item.receivedCents) }) : t('payrollPage.toCollect') }}</small>
                  </span>
                  <strong class="is-income">+{{ calendarMoney(item.amountCents) }}</strong>
                </button>
              </li>
              <li v-for="item in selectedDailyNet.expenseItems" :key="`expense-${item.occurrenceId}`">
                <button type="button" @click="openDayExpense(item.sourceId)">
                  <span class="day-money__kind day-money__kind--expense">{{ t('payrollPage.kindExpense') }}</span>
                  <span class="day-money__label">
                    {{ item.title }}
                    <small>{{ item.status === 'PAID' ? t('payrollPage.paid') : t('payrollPage.toPay') }}</small>
                  </span>
                  <strong class="is-expense">−{{ calendarMoney(item.amountCents) }}</strong>
                </button>
              </li>
              <li v-for="item in selectedDailyNet.investmentLossItems" :key="`loss-${item.occurrenceId}`">
                <button type="button" @click="openDayExpense(item.sourceId)">
                  <span class="day-money__kind day-money__kind--loss">{{ t('payrollPage.investmentLoss') }}</span>
                  <span class="day-money__label">{{ item.title }}</span>
                  <strong class="is-expense">−{{ calendarMoney(item.amountCents) }}</strong>
                </button>
              </li>
            </ul>
            <p class="day-money__note">{{ t('payrollPage.dayMoneyNote') }}</p>
          </template>
          <p v-if="selectedDailyNet?.salaryDeposits.length" class="day-money__deposit">
            {{ t('payrollPage.salaryDepositNote', { amount: calendarMoney(selectedDailyNet.salaryDeposits.reduce((sum, deposit) => sum + deposit.amountCents, 0)) }) }}
          </p>
        </section>
        <div ref="workInputSection" class="section">
          <h2>{{ t('payroll.editHours') }}</h2>
      
          <van-cell-group inset style="margin-bottom: 12px;">
            <div style="padding: 14px 16px;">
              <div style="font-size: 14px; color: #646566; margin-bottom: 12px; font-weight: bold;">{{ t('payrollPage.attendanceStatus') }}</div>
              <van-radio-group v-model="shiftType" direction="horizontal">
                <van-radio name="normal">{{ t('payroll.normal') }}</van-radio>
                <van-radio name="leave">{{ t('payroll.leave') }}</van-radio>
              </van-radio-group>
            </div>
          </van-cell-group>

          <van-cell-group inset>
            <van-cell v-if="selectedHolidayLabel" :title="t('payrollPage.holidayCell')" :value="selectedHolidayLabel" value-class="holiday-text" />
            <van-cell v-if="!selectedRecord && selectedPlannedShift" :title="t('payrollPage.byYourRoster')" :value="`${selectedPlannedShift.name} ${selectedPlannedShift.startTime}–${selectedPlannedShift.endTime}`" />
        
    <!-- 找到這個區塊，在 endTime 下方加入開關 -->
            <template v-if="shiftType !== 'leave'">
              <div v-if="dayShiftTemplates.length" class="day-shift">
                <span class="day-shift__label">{{ t('payrollPage.shiftLabel') }}</span>
                <div class="day-shift__chips" role="group" :aria-label="t('payrollPage.applyShiftAria')">
                  <button
                    v-for="template in dayShiftTemplates"
                    :key="template.id"
                    type="button"
                    class="day-shift__chip"
                    :class="{ 'is-selected': selectedShiftTemplate?.id === template.id }"
                    @click="applyShiftTemplate(template)"
                  >
                    {{ template.name }}
                    <small>{{ getTemplateTimes(template, isCleaningDay).startTime }}</small>
                  </button>
                </div>
              </div>
              <van-cell center :title="t('payrollPage.cleaningDay')" :label="isCleaningDay ? t('payrollPage.cleaningOn') : t('payrollPage.cleaningOff')">
                <template #right-icon>
                  <van-switch :model-value="isCleaningDay" size="20px" @update:model-value="setCleaningDay" />
                </template>
              </van-cell>
              <TimeTextField
                :key="`start-${timeFieldKey}`"
                v-model="startTime"
                :label="t('payroll.plannedStart')"
                @update:invalid="timeInputInvalid.start = $event"
                @open-picker="showStartTimePicker = true"
              />
              <div v-if="startTime" class="time-nudge" role="group" :aria-label="t('payrollPage.startNudgeAria')">
                <button v-for="step in TIME_NUDGES" :key="step" type="button" @click="nudgeTime('start', step)">
                  {{ step > 0 ? t('payrollPage.plusMinutes', { minutes: step }) : t('payrollPage.minusMinutes', { minutes: -step }) }}
                </button>
              </div>
              <TimeTextField
                :key="`end-${timeFieldKey}`"
                v-model="endTime"
                :label="t('payroll.plannedEnd')"
                @update:invalid="timeInputInvalid.end = $event"
                @open-picker="showEndTimePicker = true"
              />
              <div v-if="endTime" class="time-nudge" role="group" :aria-label="t('payrollPage.endNudgeAria')">
                <button v-for="step in TIME_NUDGES" :key="step" type="button" @click="nudgeTime('end', step)">
                  {{ step > 0 ? t('payrollPage.plusMinutes', { minutes: step }) : t('payrollPage.minusMinutes', { minutes: -step }) }}
                </button>
              </div>
              <!-- 這裡放入新的換裝時間開關 -->
              <van-cell center :title="t('payrollPage.prepTime')">
                <template #right-icon>
                  <van-switch v-model="enablePrepTime" size="20px" />
                </template>
              </van-cell>
              <van-cell center :title="t('payrollPage.smokoToday')" :label="smokoCountOverride === null ? t('payrollPage.smokoFromSetup') : t('payrollPage.smokoOverride')">
                <template #right-icon>
                  <van-stepper :model-value="displayedSmokoCount" :min="0" :max="3" integer theme="round" button-size="28px" disable-input @change="(val) => { if (Number(val) !== displayedSmokoCount) smokoCountOverride = Number(val) }" />
                </template>
              </van-cell>
            </template>

            <van-cell v-else>
              <template #title>
                <div style="color: #ee0a24; text-align: center; font-size: 14px; padding: 10px 0; font-weight: bold;">
                  {{ t('payrollPage.leaveNoPay') }}
                </div>
              </template>
            </van-cell>

            <van-field
              v-model="remark"
              :label="t('payrollPage.remarkLabel')"
              :placeholder="t('payrollPage.remarkPlaceholder')"
              input-align="right"
              clearable
            />
          </van-cell-group>
        </div>
        <div v-if="shiftType !== 'leave' && !setupState.payReady" class="section">
          <h2>{{ t('payrollPage.dayPayEstimate') }}</h2>
          <div class="section-card setup-needed">
            <van-icon name="balance-o" aria-hidden="true" />
            <div>
              <strong>{{ t('payrollPage.noRatesTitle') }}</strong>
              <p>{{ t('payrollPage.noRatesText') }}</p>
            </div>
            <van-button size="small" type="primary" @click="openWorkSetup(1)">{{ t('payrollPage.setUp') }}</van-button>
          </div>
        </div>
        <div class="section" v-else-if="workSummary && shiftType !== 'leave'">
          <h2>{{ t('payrollPage.dayPayEstimate') }} ({{ currentCurrency }})</h2>
          <p v-if="todayRateFlags.provisional.length" class="rate-flag">
            <van-icon name="info-o" aria-hidden="true" />{{ t('payrollPage.provisionalNote', { items: joinList(todayRateFlags.provisional) }) }}
          </p>
          <p v-if="todayRateFlags.excluded.length" class="rate-flag rate-flag--warn">
            <van-icon name="warning-o" aria-hidden="true" />{{ t('payrollPage.excludedNote', { items: joinList(todayRateFlags.excluded) }) }}
          </p>
          <van-cell-group inset style="margin-bottom: 12px;">
            <van-cell :title="t('payrollPage.paidHours')" :value="t('payrollPage.hoursValue', { hours: formatHours(workSummary.paidMinutes) })" value-class="highlight-blue" />
            <van-cell :title="t('payrollPage.nightCheck')" :value="isNightShift ? t('payrollPage.applies') : t('payrollPage.notApplies')" />
            <van-cell :title="t('payrollPage.smokoCount')" :value="t('payrollPage.timesValue', { count: workSummary.smokoCount }) + (workSetup.profile.value.smoko.paid ? t('payrollPage.paidAsUsual') : '')" />
          </van-cell-group>
          <van-cell-group inset>
            <van-cell :title="t('payrollPage.dayGross')" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.grossPay * currentExchangeRate)}`" class="gross-cell" />
          </van-cell-group>
          <van-collapse v-model="payBreakdownOpen" class="advanced-collapse">
            <van-collapse-item name="breakdown" :title="t('payrollPage.viewLoadings')">
              <van-cell-group :border="false">
                <van-cell :title="t('payrollPage.basePay')" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.basePay * currentExchangeRate)}`" />
                <van-cell title="CASUAL LOADING 25%" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.casualPay * currentExchangeRate)}`" />
                <van-cell v-if="payBreakdown.shiftPay > 0" :title="t('payrollPage.shiftNight')" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.shiftPay * currentExchangeRate)}`" />
                <van-cell v-if="payBreakdown.holidayPenaltyPay > 0" title="P/HOL 150%" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.holidayPenaltyPay * currentExchangeRate)}`" />
                <van-cell title="SAT ORD 50%" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.satOrdPay * currentExchangeRate)}`" />
                <van-cell :title="t('payrollPage.timeHalf')" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.timeHalfPay * currentExchangeRate)}`" />
                <van-cell :title="t('payrollPage.double')" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.doublePay * currentExchangeRate)}`" />
                <van-cell title="SUN ORD 75%" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.sunOrdPay * currentExchangeRate)}`" />
              </van-cell-group>
              <dl class="term-glossary">
                <div><dt>Casual 25%</dt><dd>{{ t('payrollPage.glossCasual') }}</dd></div>
                <div><dt>{{ t('payrollPage.glossNightTerm') }}</dt><dd>{{ t('payrollPage.glossNight') }}</dd></div>
                <div><dt>SAT ORD 50%</dt><dd>{{ t('payrollPage.glossSat') }}</dd></div>
                <div><dt>T/Half · Double</dt><dd>{{ t('payrollPage.glossOvertime') }}</dd></div>
                <div><dt>SUN ORD 75%</dt><dd>{{ t('payrollPage.glossSun') }}</dd></div>
                <div><dt>P/HOL 150%</dt><dd>{{ t('payrollPage.glossHoliday') }}</dd></div>
                <div><dt>Smoko</dt><dd>{{ t('payrollPage.glossSmoko') }}</dd></div>
              </dl>
              <p class="section-note section-note--compact">{{ t('payrollPage.payslipPrevails') }}</p>
            </van-collapse-item>
          </van-collapse>
        </div>
        <DayLifeCard v-if="daySheetOpen" ref="dayLifeCard" :key="workDate" :date="workDate" />
      </div>
      <div class="pday__footer">
        <van-button v-if="isEditingRecord" plain type="default" @click="cancelEditingRecord">{{ t('payrollPage.revert') }}</van-button>
        <van-button type="primary" block @click="saveDayFromSheet">
          {{ shiftType === 'leave' ? t('payrollPage.saveLeave') : isEditingRecord ? t('payrollPage.saveChanges') : t('payrollPage.saveDay') }}
        </van-button>
      </div>
    </van-popup>

    <van-popup v-model:show="showStartTimePicker" position="bottom" round>
      <van-time-picker :title="t('payroll.plannedStart')" :model-value="(startTime || '06:00').split(':')" :filter="startPickerFilter" @confirm="onStartTimeConfirm" @cancel="showStartTimePicker = false" />
    </van-popup>
    <van-popup v-model:show="showEndTimePicker" position="bottom" round>
      <van-time-picker :title="t('payroll.plannedEnd')" :model-value="(endTime || '15:00').split(':')" :filter="endPickerFilter" @confirm="onEndTimeConfirm" @cancel="showEndTimePicker = false" />
    </van-popup>
    <van-action-sheet
      :show="unsavedPrompt.show"
      :title="t('payrollPage.unsavedDayTitle')"
      :description="t('payrollPage.unsavedDayMessage', { date: unsavedPrompt.date })"
      :actions="unsavedActions"
      :cancel-text="t('common.cancel')"
      class="unsaved-prompt"
      teleport="body"
      :close-on-popstate="false"
      @select="onUnsavedAction"
      @update:show="onUnsavedPromptShow"
    />

    <div class="workflow">
      <div v-show="payrollView === 'week'" class="week-toolbar">
        <van-button size="small" plain type="primary" icon="calendar-o" @click="fillCurrentWeek">{{ t('payrollPage.fillWeek') }}</van-button>
      </div>
      <div v-show="payrollView === 'week'" class="section">
        <h2>{{ t('payrollPage.weekSummary') }}<span v-if="weeklyRangeLabel" class="weekly-summary__range">（{{ weeklyRangeLabel }}）</span></h2>
        <p v-if="weeklyPaySummary.rateFlags.provisional.length" class="rate-flag">
          <van-icon name="info-o" aria-hidden="true" />{{ t('payrollPage.provisionalShort') }}
        </p>
        <p v-if="weeklyPaySummary.rateFlags.excluded.length" class="rate-flag rate-flag--warn">
          <van-icon name="warning-o" aria-hidden="true" />{{ t('payrollPage.excludedNote', { items: joinList(weeklyPaySummary.rateFlags.excluded) }) }}
        </p>
        <div class="section-card weekly-summary-card">
          <div class="weekly-summary__row">
            <span class="weekly-summary__label">{{ t('payrollPage.weekSubtotal', { currency: currentCurrency }) }}</span>
            <span class="weekly-summary__value">{{ currencySymbol }}{{ formatDisplayMoney(weeklySubtotal * currentExchangeRate) }}</span>
          </div>
          <div class="weekly-summary__row">
            <span class="weekly-summary__label">{{ t('payrollPage.ppeAllowance', { currency: currentCurrency }) }}</span>
            <span class="weekly-summary__value">{{ currencySymbol }}{{ formatDisplayMoney(weeklyPPE * currentExchangeRate) }}</span>
          </div>
          <div class="weekly-summary__row" style="margin-top: 8px; border-top: 1px dashed #ebedf0; padding-top: 8px;">
            <span class="weekly-summary__label" style="font-size: 13px; color: #646566;">{{ t('payrollPage.weekGross', { currency: currentCurrency }) }}</span>
            <span class="weekly-summary__value" style="font-size: 14px; color: #646566; font-weight: 500;">{{ currencySymbol }}{{ formatDisplayMoney(weeklyTotal * currentExchangeRate) }}</span>
          </div>
          <div class="weekly-summary__row weekly-summary__row--tax" style="margin-bottom: 8px;">
            <span class="weekly-summary__label">{{ t('payrollPage.withholding', { rate: weeklyTaxRateLabel, source: workSetup.profile.value.taxRateSource?.type === 'PAYSLIP_PERIOD' ? t('payrollPage.fromLatestPayslip') : '', currency: currentCurrency }) }}</span>
            <span class="weekly-summary__value weekly-summary__value--tax">-{{ currencySymbol }}{{ formatDisplayMoney(weeklyTaxEstimate * currentExchangeRate) }}</span>
          </div>
          <div class="weekly-summary__total weekly-summary__total--net">
            <div class="weekly-summary__total-label">{{ t('payrollPage.weekNet') }}</div>
            <div class="weekly-summary__total-value weekly-summary__total-value--net">
              <span style="margin-right: 4px;">{{ currencyFlag }}</span>
              {{ currencySymbol }}{{ formatDisplayMoney(convertedNetTotal) }}
              <span style="font-size: 14px; font-weight: normal; color: #15803d; margin-left: 2px;">{{ currentCurrency }}</span>
            </div>
            <div v-if="currentCurrency !== 'AUD'" style="font-size: 12px; color: #15803d; margin-top: 6px; font-weight: normal; text-align: right; opacity: 0.8;">
              {{ t('payrollPage.rateReference', { rate: exchangeRates[currentCurrency], currency: currentCurrency }) }}
            </div>
          </div>
        </div>
      </div>
      <div v-show="payrollView === 'week'" class="section">
        <h2>{{ t('payrollPage.scheduleDetails') }}</h2>
        <div class="schedule-month-nav" :aria-label="t('payrollPage.monthNavAria')">
          <button type="button" :aria-label="t('payrollPage.prevMonth')" @click="moveScheduleMonth(-1)"><van-icon name="arrow-left" /></button>
          <strong>{{ t('payrollPage.monthCount', { month: scheduleMonth, count: monthlyScheduleRecords.length }) }}</strong>
          <button type="button" :aria-label="t('payrollPage.nextMonth')" @click="moveScheduleMonth(1)"><van-icon name="arrow" /></button>
        </div>
        <div v-if="monthlyScheduleRecords.length === 0" class="section-card empty-state">
          <div class="empty-state__title">{{ t('payrollPage.noMonthRecords', { month: scheduleMonth }) }}</div>
          <div class="empty-state__text">{{ t('payrollPage.noMonthHint') }}</div>
        </div>
        <van-collapse v-else v-model="scheduleSections" class="schedule-collapse">
          <van-collapse-item name="records">
            <template #title>
              <div class="schedule-overview">
                <strong>{{ t('payrollPage.viewMonthRecords', { month: scheduleMonth, count: monthlyScheduleRecords.length }) }}</strong>
                <small>{{ t('payrollPage.sortedHint') }}</small>
              </div>
            </template>
            <van-collapse v-model="expandedRecordId" accordion class="record-collapse">
              <van-collapse-item v-for="record in monthlyScheduleRecords" :key="record.id" :name="record.id">
                <template #title>
                  <span class="schedule-date">{{ record.workDate }} <small>{{ getDayOfWeek(record.workDate) }}</small></span>
                </template>
                <template #value>
                  <strong class="schedule-pay">{{ currencySymbol }}{{ formatDisplayMoney(record.grossPay * currentExchangeRate) }}</strong>
                </template>
                <div class="schedule-detail">
                  <div class="schedule-detail__tags">
                    <van-tag v-if="record.shiftType === 'leave'" type="danger">{{ t('payrollPage.leaveBadge') }}</van-tag>
                    <van-tag v-if="record.isCleaningDay" type="success">{{ t('payrollPage.cleaningTag') }}</van-tag>
                    <van-tag v-if="record.rateFlags?.provisional?.length" plain type="warning">{{ t('payrollPage.provisionalBadge') }}</van-tag>
                    <van-tag v-if="record.shiftPay > 0" plain type="primary">{{ t('payrollPage.nightBadge') }}</van-tag>
                  </div>
                  <p v-if="record.shiftType !== 'leave'">{{ t('payrollPage.recordLine', { start: record.startTime, end: record.endTime, hours: formatHours(record.paidMinutes), smoko: record.smokoCount }) }}</p>
                  <p v-if="record.remark">{{ t('payrollPage.remark', { text: record.remark }) }}</p>
                  <div class="schedule-detail__actions">
                    <van-button size="small" plain type="primary" @click="editRecord(record)">{{ t('payrollPage.editHours') }}</van-button>
                    <van-button size="small" plain type="danger" @click="deleteRecord(record.id)">{{ t('payrollPage.remove') }}</van-button>
                  </div>
                </div>
              </van-collapse-item>
            </van-collapse>
          </van-collapse-item>
        </van-collapse>
      </div>
      <div v-show="payrollView === 'settings'" class="section">
        <h2>{{ t('payrollPage.myRates', { currency: currentCurrency }) }}{{ currentCurrency === 'AUD' ? '' : t('payrollPage.conversionRef') }}</h2>
        <button type="button" class="payslip-entry" @click="payslipImportOpen = true">
          <span class="payslip-entry__icon" aria-hidden="true"><van-icon name="description-o" /></span>
          <span class="payslip-entry__text">
            <strong>{{ workSetup.latestPayslip.value ? t('payrollPage.uploadNewPayslip') : t('payrollPage.importRatesFromPayslip') }}</strong>
            <small>{{ t('payrollPage.autoReadRates') }}</small>
          </span>
          <van-icon name="arrow" aria-hidden="true" />
        </button>
        <template v-if="setupState.payReady">
          <p v-if="!hasCurrentExchangeRate" class="section-note">{{ t('payrollPage.noRateYet', { currency: currentCurrency }) }}</p>
          <div v-else class="rate-preview section-card">
            <div v-for="rate in ratePreviewItems" :key="rate.label" class="rate-preview__row">
              <span>
                {{ rate.label }}
                <small v-if="rateStatus[rate.key] === 'PROVISIONAL'" class="rate-preview__status rate-preview__status--provisional">{{ t('payrollPage.provisionalTag') }}</small>
                <small v-else-if="rateStatus[rate.key] === 'EXCLUDED'" class="rate-preview__status rate-preview__status--excluded">{{ isOvertimeKey(rate.key) ? t('payrollPage.noLoadingTag') : t('payrollPage.notCountedTag') }}</small>
              </span>
              <strong>{{ hidesRate(rate.key) ? '—' : `${currencySymbol}${formatDisplayMoney(rate.value * currentExchangeRate)} ${currentCurrency}${rate.unit}` }}</strong>
            </div>
          </div>
          <van-collapse v-model="advancedRatesOpen" class="advanced-collapse">
            <van-collapse-item name="rates" :title="t('payrollPage.rateSources')">
              <van-cell-group :border="false">
                <van-cell v-for="rate in ratePreviewItems.slice(1, 7)" :key="rate.key" :title="rate.label" :value="hidesRate(rate.key) ? '—' : formatRate(rate.value)" :label="rateSourceLabel(rate.key)" />
              </van-cell-group>
              <p class="section-note section-note--compact">{{ t('payrollPage.rateSourcesNote') }}</p>
              <van-button size="small" plain type="primary" class="rate-reset-btn" @click="openWorkSetup(1, { manual: true })">{{ t('payrollPage.editRatesManually') }}</van-button>
            </van-collapse-item>
          </van-collapse>
        </template>
        <div v-else class="section-card setup-needed">
          <van-icon name="info-o" aria-hidden="true" />
          <div>
            <strong>{{ t('payrollPage.noRatesSet') }}</strong>
            <p>{{ t('payrollPage.noRatesSetHint') }}</p>
          </div>
          <van-button size="small" type="primary" @click="openWorkSetup(1, { manual: true })">{{ t('shiftCard.manualSetup') }}</van-button>
        </div>
      </div>
      <div v-show="payrollView === 'settings'" class="section">
        <h2>{{ t('payrollPage.dataManagement') }}</h2>
        <van-collapse v-model="dataManagementSections" class="data-management-collapse">
          <van-collapse-item name="data-management" :title="t('payrollPage.openExport')">
            <div class="button-group">
              <p class="section-note section-note--compact">{{ t('payrollPage.exportHint') }}</p>
              <van-button block plain type="default" @click="exportTodayJson">{{ t('payrollPage.exportTodayJson') }}</van-button>
              <van-button block plain type="primary" style="margin-top: 12px" :disabled="records.length === 0" @click="exportWeeklyJson">{{ t('payrollPage.exportWeekJson') }}</van-button>
              <van-button block plain type="success" style="margin-top: 12px" :disabled="records.length === 0" @click="exportWeeklyXlsx">{{ t('payrollPage.exportWeekXlsx') }}</van-button>
            </div>
          </van-collapse-item>
        </van-collapse>
      </div>
    </div>
    <!-- 首頁與薪資頁共用；放到 body，在首頁也能打開 -->
    <van-popup v-model:show="showCurrencyPicker" position="bottom" round teleport="body">
      <van-picker :title="t('payrollPage.chooseCurrency')" :model-value="[currentCurrency]" :columns="currencyColumns" @confirm="onCurrencyConfirm" @cancel="showCurrencyPicker = false" />
    </van-popup>
    </section>

    <TripTracker v-show="activeTab === 'trips'" ref="tripTrackerRef" />
    <ExpenseTracker v-show="activeTab === 'expenses'" ref="expenseTrackerRef" />
    <MorePage v-show="activeTab === 'more'" @navigate="handlePageNavigate" />
    <AdminPage v-if="activeTab === 'admin' && isSuperAdmin" @back="activeTab = 'more'" />
    <div v-if="activeTab === 'shopping'" class="sub-page-back">
      <button type="button" @click="activeTab = 'more'"><van-icon name="arrow-left" /> {{ t('app.backToMore') }}</button>
    </div>
    <ShoppingList v-show="activeTab === 'shopping'" :active="activeTab === 'shopping'" @navigate="activeTab = $event" />

    <FinancialEntrySheet
      v-model:show="entrySheet.show"
      :entry="entrySheet.entry"
      :default-type="entrySheet.type"
      :exchange-rates="exchangeRates"
    />
    <van-tabbar :model-value="tabbarActive" fixed safe-area-inset-bottom :before-change="beforeTabChange" @update:model-value="activeTab = $event">
      <van-tabbar-item name="dashboard" icon="home-o">{{ t('nav.home') }}</van-tabbar-item>
      <van-tabbar-item name="payroll" icon="balance-o">{{ t('app.tabPay') }}</van-tabbar-item>
      <van-tabbar-item name="expenses" icon="records">{{ t('nav.expenses') }}</van-tabbar-item>
      <van-tabbar-item name="trips" icon="friends-o">{{ t('nav.trips') }}</van-tabbar-item>
      <van-tabbar-item name="more" icon="apps-o">{{ t('nav.more') }}</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<style scoped>
.boot-splash { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; min-height: 100vh; min-height: 100dvh; background: var(--color-background); }
.boot-splash__mark { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 20px; background: var(--color-primary, #1989fa); color: #fff; font-size: 34px; box-shadow: 0 8px 24px rgb(25 137 250 / 0.25); }
.boot-splash__hint { min-height: 1.4em; margin: 0; color: var(--color-muted, #969799); font-size: 13px; opacity: 0; transition: opacity 0.4s; }
.boot-splash__hint--show { opacity: 1; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.page { min-height: 100vh; background: var(--color-background); }
.account-shell { max-width: 820px; margin-inline: auto; padding: calc(10px + env(safe-area-inset-top, 0px)) max(var(--page-inset), env(safe-area-inset-right, 0px)) 0 max(var(--page-inset), env(safe-area-inset-left, 0px)); }
.account-card { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 58px; padding: 8px 10px; box-sizing: border-box; border: 1px solid var(--color-border); border-radius: 16px; background: var(--color-surface); box-shadow: 0 6px 18px rgba(29, 66, 106, .05); }
.account-card__avatar { display: grid; flex: none; place-items: center; width: 38px; height: 38px; border-radius: 12px; background: var(--color-primary-soft); color: var(--color-primary); font-size: 20px; }
.account-card__identity { display: grid; gap: 2px; flex: 1; min-width: 0; }
.account-card__identity strong { color: var(--color-heading); font-size: 13px; font-weight: 800; line-height: 1.2; }
.account-card__identity span { overflow: hidden; color: var(--color-muted); font-size: 12px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.account-card--shopping-guest .account-card__identity span { overflow: visible; white-space: normal; }
.account-card__action { flex: none; min-height: 38px; padding-inline: 12px; border-radius: 11px; font-weight: 700; }
.page :deep(.app-page) { padding-top: 12px; }
.payroll-page { max-width: 820px; margin: 0 auto; }
.header { flex-wrap: wrap; }
.header-main { display: flex; justify-content: space-between; align-items: center; gap: 12px; width: 100%; }
.header p { width: 100%; }
.global-currency-btn { flex: none; min-height: 38px; font-weight: 700; border-radius: 12px; background: #fff; box-shadow: 0 2px 8px rgba(29, 66, 106, .06); }

.section { margin-top: var(--page-section-gap); }
.section h2 { font-size: var(--font-heading); font-weight: 800; color: var(--color-heading); margin: 0 0 12px; letter-spacing: -.02em; }
.calendar-section { margin-top: 8px; }
.calendar-intro { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.calendar-intro :deep(.van-button) { flex: none; min-height: 40px; border-radius: 11px; }
.calendar-help { margin: 0; color: var(--color-muted); font-size: 13px; line-height: 1.4; }
.calendar-intro:has(.calendar-net-legend) { flex-wrap: wrap; }
.calendar-net-legend { flex: 1 1 100%; display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 10px; margin: 0; color: var(--color-muted); font-size: 12px; line-height: 1.4; }
.calendar-net-legend strong { color: var(--color-heading); font-size: 13px; font-variant-numeric: tabular-nums; }
.calendar-month-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 12px; }
.calendar-month-actions span { flex: 1 1 100%; color: var(--color-muted); font-size: 13px; font-weight: 700; }
.calendar-month-actions :deep(.van-button) { min-height: 40px; border-radius: 11px; }
.rate-preview { display: grid; gap: 0; margin-bottom: 10px; }
.rate-preview__row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 5px 12px; padding: 7px 0; font-size: 13px; border-bottom: 1px solid var(--color-border); }
.rate-preview__row:last-child { border-bottom: 0; }
.rate-preview__row strong { color: var(--color-primary); margin-left: auto; font-variant-numeric: tabular-nums; }
.rate-input-note { margin-top: 10px; }
.schedule-month-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; padding: 4px; border-radius: 14px; background: var(--color-primary-soft); }
.schedule-month-nav button { width: 40px; height: 40px; border: 0; border-radius: 10px; background: #fff; color: var(--color-primary); }
.schedule-month-nav strong { font-size: 14px; text-align: center; }

.calendar-wrapper { border-radius: var(--page-card-radius); overflow: hidden; box-shadow: 0 12px 28px rgba(29, 66, 106, .07); background: #fff; border: 1px solid var(--color-border); }
.calendar-day-actions { margin: 12px 0 0; padding: 15px 16px; border: 1px solid var(--color-border); border-radius: 18px; background: #fff; box-shadow: 0 6px 18px rgba(29, 66, 106, .05); }
.calendar-day-actions__heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 10px; }
.calendar-day-actions__heading strong { color: var(--color-heading); font-size: 15px; }
.calendar-day-actions__heading small { color: var(--color-muted); font-size: 11px; }
.calendar-day-actions__heading p { margin: 4px 0 0; color: var(--color-muted); font-size: 12px; }
.calendar-day-actions__heading .calendar-day-actions__blackout { display: block; margin: 4px 0 0; padding: 0; border: 0; background: none; color: #a95a0c; font: inherit; font-weight: 700; text-align: left; overflow-wrap: anywhere; }
.calendar-day-actions__blackout span { margin-left: 4px; color: var(--color-primary); font-weight: 600; text-decoration: underline; }
.calendar-day-actions__heading .calendar-day-actions__source { display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 999px; background: var(--color-primary-soft); color: var(--color-primary); font-size: 12px; }
.calendar-day-actions__pay { margin-left: auto; color: var(--color-primary) !important; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.calendar-day-actions__pay small { display: block; color: var(--color-muted); font-size: 11px; font-weight: 600; text-align: right; }
.calendar-day-actions__pay.day-net--positive { color: var(--color-income) !important; }
.calendar-day-actions__pay.day-net--negative { color: var(--color-blackout-text) !important; }
.calendar-day-actions__pay.day-net--zero { color: var(--color-muted) !important; }
.day-money { display: grid; gap: 10px; margin: 0 16px 16px; padding: 16px; border: 1px solid var(--color-border); border-radius: var(--radius-medium); background: var(--color-surface); }
.day-money h2 { display: flex; align-items: baseline; gap: 8px; margin: 0; color: var(--color-heading); font-size: var(--font-section); }
.day-money h2 small { color: var(--color-muted); font-size: 12px; font-weight: 600; }
.day-money__empty, .day-money__note, .day-money__deposit { margin: 0; color: var(--color-muted); font-size: 13px; line-height: 1.5; }
.day-money__deposit { padding: 8px 10px; border-radius: 10px; background: var(--color-pending-soft); color: var(--color-pending); }
.day-money__summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 0; }
.day-money__summary div { display: grid; gap: 2px; padding: 8px 10px; border-radius: 10px; background: var(--color-background); }
.day-money__summary dt { color: var(--color-muted); font-size: 12px; }
.day-money__summary dd { margin: 0; color: var(--color-heading); font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.day-money__summary .day-money__net { grid-column: 1 / -1; background: var(--color-primary-soft); }
.day-money__summary .day-money__net dd { font-size: 18px; }
.day-money__summary .day-net--positive dd { color: var(--color-income); }
.day-money__summary .day-net--negative dd { color: var(--color-blackout-text); }
.day-money__summary .day-net--zero dd { color: var(--color-muted); }
.day-money__items { display: grid; margin: 0; padding: 0; list-style: none; }
.day-money__items button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: var(--touch-target); padding: 6px 0; border: 0; border-bottom: 1px solid var(--color-border); background: none; color: var(--color-heading); font: inherit; font-size: 14px; text-align: left; }
.day-money__items li:last-child button { border-bottom: 0; }
.day-money__kind { flex: none; padding: 2px 6px; border-radius: 6px; font-size: 11px; font-weight: 700; }
.day-money__kind--work { background: var(--color-primary-soft); color: var(--color-primary); }
.day-money__kind--fare { background: var(--color-income-soft); color: var(--color-income); }
.day-money__kind--expense { background: var(--color-blackout-bg); color: var(--color-blackout-text); }
.day-money__kind--loss { background: var(--color-pending-soft); color: var(--color-pending); }
.day-money__label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.day-money__label small { margin-left: 4px; color: var(--color-muted); font-size: 12px; }
.day-money__items strong { flex: none; font-variant-numeric: tabular-nums; }
.day-money__items .is-income { color: var(--color-income); }
.day-money__items .is-expense { color: var(--color-blackout-text); }
.calendar-day-actions__buttons { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 13px; }
.calendar-day-actions__buttons :deep(.van-button) { min-height: 42px; padding: 0 8px; border-radius: 11px; font-size: 13px; }
.calendar-day-actions__blackout-button { grid-column: 1 / -1; }
.calendar-day-actions__hint { margin: 10px 0 0; color: var(--color-muted); font-size: 11px; line-height: 1.4; }
.blackout-editor { max-height: 90dvh; overflow-y: auto; padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); }
.blackout-editor__heading { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; color: var(--color-heading); }
.blackout-editor__heading strong { font-size: 18px; }
.blackout-editor__heading span { color: var(--color-muted); font-size: 13px; }
.blackout-editor p { color: var(--color-muted); font-size: 13px; line-height: 1.5; }
.blackout-editor__actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 18px; }
.blackout-editor__actions :deep(.van-button) { min-height: 46px; border-radius: 12px; }
.blackout-editor__actions :deep(.van-button:only-child) { grid-column: 1 / -1; }
.bulk-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
:deep(.van-calendar) { height: auto !important; }
:deep(.van-calendar__body) { padding-bottom: 12px; }
:deep(.van-calendar__day) {
  height: max(68px, 4.4rem) !important;
  position: relative !important;
  padding-top: 8px !important;
  align-items: flex-start !important;
}
:deep(.van-calendar__top-info) {
  position: absolute !important;
  top: 29px !important;
  left: 3px;
  right: 3px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 9px !important;
  line-height: 1.2;
  text-align: center;
}
:deep(.holiday-day .van-calendar__top-info) { color: #ef4444 !important; font-weight: 700; }
:deep(.cleaning-day .van-calendar__top-info) { color: #f97316 !important; font-weight: 700; }
/* 當天快速調整：班別快選與時間微調 */
.day-shift { display: grid; gap: 8px; padding: 12px 16px 4px; }
.day-shift__label { color: var(--color-muted); font-size: 14px; }
.day-shift__chips { display: flex; flex-wrap: wrap; gap: 8px; }
.day-shift__chip { display: grid; justify-items: center; min-width: 72px; min-height: 44px; padding: 4px 12px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface); color: var(--color-heading); font: inherit; font-size: 14px; font-weight: 700; }
.day-shift__chip small { color: var(--color-muted); font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
.day-shift__chip.is-selected { border-color: var(--color-primary); background: var(--color-primary-soft); color: var(--color-primary); }
.day-shift__chip.is-selected small { color: var(--color-primary); }
.time-nudge { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; padding: 0 16px 10px; }
.time-nudge button { min-height: 36px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); color: var(--color-primary); font: inherit; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
.time-nudge button:active { background: var(--color-primary-soft); }
:deep(.leave-blackout-day) { box-shadow: inset 0 0 0 2px #f7b060; border-radius: 8px; }
:deep(.leave-blackout-day .van-calendar__top-info) { color: #a95a0c !important; font-weight: 800; }
:deep(.van-calendar__bottom-info) {
  position: absolute !important;
  bottom: 7px !important;
  left: 3px;
  right: 3px;
  overflow: hidden;
  padding: 3px 0;
  border-radius: 6px;
  white-space: nowrap;
  font-size: 11px !important;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  text-align: center;
}
/* 每日預估淨額：正綠、負柔和紅、零中性；文字一定帶 +／− 號，不只靠顏色 */
:deep(.net-positive .van-calendar__bottom-info) { color: var(--color-income) !important; background: var(--color-income-soft); }
:deep(.net-negative .van-calendar__bottom-info) { color: var(--color-blackout-text) !important; background: var(--color-blackout-bg); }
:deep(.net-zero .van-calendar__bottom-info) { color: var(--color-muted) !important; background: var(--color-border); }
:deep(.net-positive .van-calendar__bottom-info), :deep(.net-negative .van-calendar__bottom-info), :deep(.net-zero .van-calendar__bottom-info) { left: 1px; right: 1px; font-size: clamp(9.5px, 2.9vw, 11px) !important; letter-spacing: -0.02em; text-overflow: clip; }
:deep(.record-leave-day:not(.holiday-day):not(.leave-blackout-day) .van-calendar__top-info) { color: var(--color-muted) !important; font-weight: 700; }
:deep(.has-remark-day) {
  background-color: #fffbeb !important;
  border: 1px dashed #fef3c7 !important;
  border-radius: 6px;
}
:deep(.van-calendar__selected-day) {
  position: absolute;
  top: 3px;
  display: flex !important;
  flex-direction: column !important;
  justify-content: flex-start !important;
  width: calc(100% - 6px) !important;
  height: calc(100% - 6px) !important;
  padding-top: 6px !important;
  border-radius: 10px !important;
  box-sizing: border-box !important;
}
:deep(.van-calendar__selected-day .van-calendar__top-info) { color: #fff !important; }
:deep(.leave-blackout-day .van-calendar__selected-day .van-calendar__top-info) { color: #fff !important; }
:deep(.van-calendar__selected-day .van-calendar__bottom-info) { color: #fff !important; background: rgba(255, 255, 255, .2) !important; }
:deep(.van-calendar__selected-day .van-calendar__bottom-info) { left: 0 !important; right: 0 !important; }

.workflow { margin-top: 4px; }
.section-card { padding: 18px; border-radius: var(--page-card-radius); background: #fff; box-shadow: 0 12px 28px rgba(29, 66, 106, .07); }
.section-note { margin: 0 0 14px; font-size: 13px; line-height: 1.5; color: var(--color-muted); }
:deep(.gross-cell .van-cell__value) { font-weight: 700; color: #1989fa; font-size: 16px; }

.weekly-actions { display: grid; gap: 12px; }
.weekly-actions :deep(.van-button--primary) { min-height: 50px; font-size: 15px; font-weight: 800; box-shadow: 0 8px 20px rgba(25, 137, 250, 0.2); border-radius: 15px; }
.weekly-actions :deep(.van-button--plain) { min-height: 42px; border-radius: 12px; box-shadow: none; }
.empty-state { padding: 30px 16px; text-align: center; }
.empty-state__title { font-size: 14px; font-weight: 700; color: var(--color-muted); }
.empty-state__text { margin-top: 6px; font-size: 12px; line-height: 1.5; color: #9ca3af; }
.schedule-collapse { overflow: hidden; border: 1px solid var(--color-border); border-radius: 20px; background: #fff; box-shadow: 0 12px 28px rgba(29, 66, 106, .07); }
:deep(.schedule-collapse > .van-collapse-item > .van-cell) { min-height: 62px; padding: 12px 18px; }
.schedule-overview { display: grid; gap: 2px; }
.schedule-overview strong { color: var(--color-heading); font-size: 14px; font-weight: 800; }
.schedule-overview small { color: var(--color-muted); font-size: 11px; }
:deep(.schedule-collapse > .van-collapse-item > .van-collapse-item__wrapper .van-collapse-item__content) { padding: 0 12px 12px; }
.record-collapse { overflow: hidden; border: 1px solid var(--color-border); border-radius: 13px; }
:deep(.record-collapse .van-cell) { min-height: 48px; padding: 10px 12px; }
:deep(.record-collapse .van-cell__title) { min-width: 0; }
:deep(.record-collapse .van-cell__value) { flex: 0 1 auto; max-width: 50%; margin-left: 8px; }
.schedule-date { color: var(--color-heading); font-size: 13px; font-weight: 800; white-space: nowrap; }
.schedule-date small { margin-left: 3px; color: var(--color-muted); font-size: 11px; }
.schedule-pay { color: var(--color-primary); font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
.schedule-detail { padding: 2px 0; }
.schedule-detail__tags { display: flex; flex-wrap: wrap; gap: 6px; }
.schedule-detail p { margin: 8px 0 0; color: var(--color-muted); font-size: 12px; line-height: 1.5; }
.schedule-detail__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.schedule-detail__actions :deep(.van-button) { min-height: 34px; border-radius: 9px; }
.weekly-summary-card { padding: 14px 16px 16px; }
.weekly-summary__row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; padding: 6px 0; }
.weekly-summary__label { font-size: 13px; color: var(--color-muted); }
.advanced-collapse { margin: 12px var(--van-cell-group-inset-padding, 16px) 0; overflow: hidden; border-radius: 16px; }
.term-glossary { display: grid; gap: 6px; margin: 12px 0 0; padding: 12px; border-radius: 12px; background: #f7fbff; }
.term-glossary div { display: grid; grid-template-columns: 96px 1fr; gap: 8px; }
.term-glossary dt { color: var(--color-primary); font-size: 12px; font-weight: 800; }
.term-glossary dd { margin: 0; color: #4b5b6b; font-size: 12px; line-height: 1.45; }
.sub-page-back { max-width: 820px; margin: 8px auto -4px; padding: 0 max(var(--page-inset), env(safe-area-inset-left, 0px)); }
.sub-page-back button { display: inline-flex; align-items: center; gap: 4px; min-height: 36px; padding: 6px 10px; border: 1px solid var(--color-border); border-radius: 11px; background: #fff; color: var(--color-primary); font: inherit; font-size: 13px; font-weight: 700; }
/* 薪資頁分段 */
.payroll-views { position: sticky; top: 0; z-index: 5; display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin: 0 0 var(--page-section-gap); padding: 4px; border-radius: 14px; background: #e9eef5; }
.payroll-views button { min-height: 40px; border: 0; border-radius: 11px; background: transparent; color: var(--color-muted); font: inherit; font-size: 15px; font-weight: 700; }
.payroll-views button.is-active { background: var(--color-surface); color: var(--color-primary); box-shadow: 0 1px 4px rgba(16, 42, 67, 0.12); }
.week-toolbar { display: flex; justify-content: flex-end; margin-bottom: 8px; }
/* 當天面板 */
.payroll-day-sheet { display: flex; flex-direction: column; max-height: 90dvh; background: var(--color-background, var(--color-background)); }
.pday__body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 16px 0 8px; }
.pday__body > .calendar-day-actions { margin: 0 var(--page-inset, 16px) 8px; }
.pday__body > .section > h2 { margin-top: 12px; padding: 0 var(--page-inset, 16px); }
.pday__close { display: grid; flex: none; place-items: center; width: 40px; height: 40px; margin: -6px -8px 0 4px; border: 0; border-radius: 50%; background: transparent; color: var(--color-muted); font-size: 18px; }
.pday__footer { display: flex; gap: 10px; padding: 10px var(--page-inset, 16px); border-top: 1px solid var(--color-border); background: var(--color-surface); }
.pday__footer .van-button { min-height: var(--touch-target); border-radius: var(--radius-button); font-weight: 700; }
.pday__footer .van-button--block { flex: 1; }
/* 工作設定卡片 */
.work-setup-card { margin: 0 0 var(--page-section-gap); padding: 16px; border: 1px solid var(--color-border); border-radius: var(--page-card-radius); background: var(--color-surface); box-shadow: var(--shadow-card); }
.work-setup-card--todo { border-color: var(--color-primary); background: linear-gradient(180deg, var(--color-primary-soft), var(--color-surface) 70%); }
.work-setup-card__head { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
.work-setup-card__icon { display: grid; flex: none; place-items: center; width: 40px; height: 40px; border-radius: 13px; background: var(--color-income-soft); color: var(--color-income); font-size: 22px; }
.work-setup-card--todo .work-setup-card__icon { background: var(--color-primary); color: #fff; }
.work-setup-card__head h2 { margin: 0; color: var(--color-heading); font-size: 16px; font-weight: 800; }
.work-setup-card__head p { margin: 2px 0 0; color: var(--color-muted); font-size: 13px; }
.work-setup-card__row { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 8px 0; border: 0; border-top: 1px solid var(--color-border); background: none; color: var(--color-heading); font: inherit; text-align: left; cursor: pointer; }
.work-setup-card__row > .van-icon { flex: none; color: var(--color-muted); }
.work-setup-card__label { flex: none; width: 92px; color: var(--color-muted); font-size: 13px; }
.work-setup-card__value { display: grid; flex: 1; gap: 2px; min-width: 0; font-size: 13px; font-weight: 700; line-height: 1.45; }
.work-setup-card__value em { color: var(--color-pending); font-style: normal; }
.work-setup-card__line { overflow-wrap: anywhere; }
.work-setup-card__cta { height: var(--page-button-height); margin-top: 10px; border-radius: var(--radius-button); font-weight: 700; }
.setup-needed { display: flex; align-items: center; gap: 12px; }
.setup-needed > .van-icon { flex: none; color: var(--color-primary); font-size: 24px; }
.setup-needed > div { flex: 1; min-width: 0; }
.setup-needed strong { color: var(--color-heading); font-size: 14px; }
.setup-needed p { margin: 2px 0 0; color: var(--color-muted); font-size: 12px; line-height: 1.5; }
.setup-needed .van-button { flex: none; border-radius: 10px; }
.rate-flag { display: flex; gap: 6px; margin: 0 0 10px; padding: 9px 12px; border-radius: var(--radius-medium); background: var(--color-pending-soft); color: var(--color-pending); font-size: 12px; line-height: 1.5; }
.rate-flag--warn { background: #fdecec; color: var(--color-expense); }
.rate-preview__status { margin-left: 4px; padding: 1px 6px; border-radius: 999px; font-size: 10px; font-weight: 700; }
.rate-preview__status--provisional { background: var(--color-pending-soft); color: var(--color-pending); }
.rate-preview__status--excluded { background: #fdecec; color: var(--color-expense); }
.payslip-entry { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 64px; margin: 0 0 12px; padding: 12px 14px; border: 1px solid var(--color-primary); border-radius: var(--radius-large); background: var(--color-primary-soft); color: var(--color-heading); font: inherit; text-align: left; cursor: pointer; }
.payslip-entry__icon { display: grid; flex: none; place-items: center; width: 40px; height: 40px; border-radius: 13px; background: var(--color-surface); color: var(--color-primary); font-size: 21px; }
.payslip-entry__text { display: grid; flex: 1; gap: 2px; min-width: 0; }
.payslip-entry__text strong { font-size: 15px; }
.payslip-entry__text small { color: var(--color-muted); font-size: 12px; }
.rate-reset-btn { margin-top: 8px; }
.weekly-summary__range { margin-left: 4px; font-size: 14px; font-weight: 500; color: var(--color-muted); }
.weekly-summary__value { margin-left: auto; font-size: 14px; font-weight: 600; color: #1f2937; overflow-wrap: anywhere; }
.weekly-summary__row--tax { padding-top: 12px; margin-top: 8px; border-top: 1px dashed #e5e7eb; }
.weekly-summary__value--tax { color: #b45309; font-weight: bold; }
.weekly-summary__total--net { margin-top: 12px; padding: 16px; border-radius: 14px; background: linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%); border: 1px solid #bbf7d0; }
.weekly-summary__total-label { font-size: 13px; color: #166534; font-weight: bold; }
.weekly-summary__total-value--net { color: #15803d; font-size: 26px; font-weight: 800; margin-top: 4px; overflow-wrap: anywhere; }
.data-management-collapse { overflow: hidden; border-radius: 16px; background: #fff; box-shadow: 0 4px 14px rgba(15, 23, 42, 0.04); border: 1px solid var(--color-border); }
:deep(.data-management-collapse .van-cell) { padding: 14px 16px; font-weight: bold; }
:deep(.data-management-collapse .van-collapse-item__content) { padding: 14px 16px; background: #fafafa; }
.work-setup-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: var(--touch-target); margin: 0 0 var(--space-row); padding: 10px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-medium); background: var(--color-surface); color: var(--color-muted); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
.work-setup-summary__text { min-width: 0; overflow-wrap: anywhere; }
.work-setup-summary strong { color: var(--color-heading); font-variant-numeric: tabular-nums; }
.work-setup-summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
</style>
