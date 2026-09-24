// Temporary settings only. Reloading or restarting the app removes the goal and day target.
/** @type {Record<string, any> | null} */
let savingGoal = null
/** @type {number | null} */
let workDayTarget = null

export const dashboardSettingsRepository = {
  async getSavingGoal() {
    return savingGoal ? { ...savingGoal } : null
  },
  async saveSavingGoal(goal) {
    savingGoal = { ...goal }
    return { ...savingGoal }
  },
  async getWorkDayTarget() {
    return workDayTarget
  },
  async saveWorkDayTarget(target) {
    workDayTarget = target
    return target
  },
}
