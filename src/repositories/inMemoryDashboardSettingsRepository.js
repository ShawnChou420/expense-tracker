// Temporary settings only. Reloading or restarting the app removes the goal and day target.
import { apiRequest, authToken } from '../services/authSession.js'
/** @type {Record<string, any> | null} */
let savingGoal = null
/** @type {number | null} */
let workDayTarget = null

export const dashboardSettingsRepository = {
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
