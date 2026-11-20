// Temporary settings only. Reloading or restarting the app removes the goal and day target.
import { apiRequest, authToken } from '../services/authSession.js'
/** @type {Record<string, any> | null} */
let savingGoal = null
/** @type {number | null} */
let workDayTarget = null
/** 訪客的首頁自訂：只在記憶體，重新整理後恢復預設；登入時不匯入 */
/** @type {Record<string, any> | null} */
let dashboardLayout = null

export const dashboardSettingsRepository = {
  /** 一次取回存款目標、工作日目標與首頁自訂（會員只打一次 API） */
  async getSettings() {
    if (authToken.value) {
      const settings = await apiRequest('/dashboard-settings')
      return {
        savingGoal: settings.savingGoal ?? null,
        workDayTarget: settings.workDayTarget ?? null,
        dashboardLayout: settings.dashboardLayout ?? null,
      }
    }
    return {
      savingGoal: savingGoal ? { ...savingGoal } : null,
      workDayTarget,
      dashboardLayout: dashboardLayout ? JSON.parse(JSON.stringify(dashboardLayout)) : null,
    }
  },
  async saveDashboardLayout(layout) {
    if (authToken.value)
      return apiRequest('/dashboard-settings/layout', { method: 'PUT', body: layout })
    dashboardLayout = JSON.parse(JSON.stringify(layout))
    return JSON.parse(JSON.stringify(dashboardLayout))
  },
  async getSavingGoal() {
    if (authToken.value) return (await apiRequest('/dashboard-settings')).savingGoal
    return savingGoal ? { ...savingGoal } : null
  },
  async saveSavingGoal(goal) {
    if (authToken.value)
      return apiRequest('/dashboard-settings/saving-goal', { method: 'PUT', body: goal })
    savingGoal = { ...goal }
    return { ...savingGoal }
  },
  async getWorkDayTarget() {
    if (authToken.value) return (await apiRequest('/dashboard-settings')).workDayTarget
    return workDayTarget
  },
  async saveWorkDayTarget(target) {
    if (authToken.value) {
      const result = await apiRequest('/dashboard-settings/work-day-target', {
        method: 'PUT',
        body: { target },
      })
      return result.target
    }
    workDayTarget = target
    return target
  },
}

export function getGuestDashboardSettings() {
  return { savingGoal: savingGoal ? { ...savingGoal } : null, workDayTarget }
}
