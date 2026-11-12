/**
 * 首頁「開始使用」引導：依目前資料判斷使用者下一步該做什麼。
 * 只讀取資料、不修改資料；每一步的 action 由畫面決定要開哪個頁面或表單。
 *
 * @param {{
 *   workRecords?: Array<{ shiftType?: string, paidMinutes?: number }>,
 *   expenses?: Array<unknown>,
 *   savingGoal?: unknown,
 *   salaryDeposits?: Array<unknown> | null,
 *   isMember?: boolean,
 * }} sources
 */
export function getOnboardingSteps({
  workRecords = [],
  expenses = [],
  savingGoal = null,
  salaryDeposits = null,
  isMember = false,
}) {
  const steps = [
    {
      id: 'schedule',
      title: '排好這週的班表',
      description: '在薪資頁點日曆上的日期，或按「填滿本週」，自動試算週薪。',
      actionLabel: '去排班',
      action: 'payroll',
      done: workRecords.some(
        (record) => record.shiftType !== 'leave' && Number(record.paidMinutes) > 0,
      ),
    },
    ...(isMember
      ? [
          {
            id: 'salary',
            title: '記錄一筆薪資入帳',
            description: '收到薪水後記下稅後金額，首頁的收入才是實際數字。',
            actionLabel: '記錄入帳',
            action: 'salary',
            done: Array.isArray(salaryDeposits) && salaryDeposits.length > 0,
          },
        ]
      : []),
    {
      id: 'expense',
      title: '記一筆支出',
      description: '房租、超市、油錢都記下來，才能算出每週存了多少。',
      actionLabel: '去記帳',
      action: 'expenses',
      done: expenses.length > 0,
    },
    {
      id: 'goal',
      title: '設定儲蓄目標',
      description: '設定目標金額與日期，首頁會顯示你的存款進度。',
      actionLabel: '設定目標',
      action: 'goal',
      done: Boolean(savingGoal),
    },
  ]
  const doneCount = steps.filter((step) => step.done).length
  return { steps, doneCount, total: steps.length, allDone: doneCount === steps.length }
}
