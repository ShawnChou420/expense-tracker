import { apiRequest, authToken } from '../services/authSession.js'
import { notifyLedgerChanged } from './appRepositories.js'

// 訪客的工作設定與薪資單只存在這次開啟 App 的記憶體中；會員存到資料庫。
/** @type {Record<string, unknown> | null} */
let guestProfile = null
/** @type {any[]} */
let guestPayslips = []

// Vue 的 reactive proxy 不能用 structuredClone，設定都是純 JSON 資料
const clonePlain = (value) => JSON.parse(JSON.stringify(value))

export const workProfileRepository = {
  /** 會員：回傳已儲存的設定，沒有時回傳 null（可能是舊會員或新會員） */
  async load() {
    if (!authToken.value) return guestProfile
    const result = await apiRequest('/work-profile')
    return result?.profile ?? null
  },
  /** @param {Record<string, unknown>} profile */
  async save(profile) {
    if (!authToken.value) {
      guestProfile = clonePlain(profile)
      return guestProfile
    }
    const result = await apiRequest('/work-profile', { method: 'PUT', body: profile })
    return result?.profile ?? profile
  },
}

export const payslipImportRepository = {
  async list() {
    if (!authToken.value) return [...guestPayslips]
    return apiRequest('/payslip-imports')
  },
  /**
   * 保存使用者確認過的薪資單；會員可同時在同一個交易中建立薪資入帳。
   * @param {Record<string, any>} payslip
   * @param {{ recordDeposit: boolean }} options
   */
  async create(payslip, { recordDeposit }) {
    if (!authToken.value) {
      if (payslip.fileSha256 && guestPayslips.some((item) => item.fileSha256 === payslip.fileSha256)) {
        throw new Error('這份薪資單之前已經匯入過')
      }
      const saved = { ...payslip, id: crypto.randomUUID(), depositId: null }
      guestPayslips = [saved, ...guestPayslips]
      notifyLedgerChanged()
      return saved
    }
    const saved = await apiRequest('/payslip-imports', {
      method: 'POST',
      body: { ...payslip, recordDeposit },
    })
    notifyLedgerChanged()
    return saved
  },
  /** @param {string} id */
  async remove(id) {
    if (!authToken.value) {
      guestPayslips = guestPayslips.filter((item) => item.id !== id)
    } else {
      await apiRequest(`/payslip-imports/${encodeURIComponent(id)}`, { method: 'DELETE' })
    }
    notifyLedgerChanged()
  },
}

export function getGuestWorkSetup() {
  return { profile: guestProfile, payslips: [...guestPayslips] }
}
