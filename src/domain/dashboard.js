import { formatLocalDate, getWeekRange, isDateInRange, parseLocalDate } from './date.js'
import { EXPENSE_GROUPS } from './expenses.js'
import { dollarsToCents, sumCents } from './money.js'

export const EXPENSE_COLORS = Object.freeze({
  HOUSING: '#1976d2',
  FOOD: '#20a27d',
  TRANSPORT: '#f29b38',
  LIFE: '#7f8fd8',
  INSURANCE: '#df7191',
  FINANCE: '#788da6',
  OTHER: '#9ba7b5',
})

export function getDashboardRange(referenceDate, period = 'week') {
  const date = parseLocalDate(referenceDate)
  if (!date) return null
  if (period === 'week') return getWeekRange(referenceDate)
  if (period !== 'month') return null
  return {
    start: formatLocalDate(new Date(date.getFullYear(), date.getMonth(), 1)),
    end: formatLocalDate(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
  }
}

export function getDatesInRange(range) {
  const start = parseLocalDate(range?.start)
  const end = parseLocalDate(range?.end)
  if (!start || !end || start > end) return []
  const dates = []
  for (const date = start; date <= end; date.setDate(date.getDate() + 1)) {
    dates.push(formatLocalDate(date))
  }
  return dates
}

/** @param {{ trips?: Array<any>, expenses?: Array<any>, salaryDeposits?: Array<any> | null }} sources */
export function getActualTransactions({ trips = [], expenses = [], salaryDeposits = null }) {
  const tripIncome = trips.flatMap((trip) =>
    (trip.charges || [])
      .filter((charge) => charge.paymentStatus === 'PAID' && parseLocalDate(charge.paidAt))
      .map((charge) => ({ date: charge.paidAt, amountCents: charge.amountCents, kind: 'trip' })),
  )
  const salaryIncome = (salaryDeposits || [])
    .filter(
      (deposit) =>
        deposit.type !== 'TRANSFER' &&
        parseLocalDate(deposit.paidAt) &&
        Number.isSafeInteger(deposit.amountCents),
    )
    .map((deposit) => ({ date: deposit.paidAt, amountCents: deposit.amountCents, kind: 'salary' }))
  const income = [...tripIncome, ...salaryIncome]
  const outgoings = expenses.flatMap((expense) => {
    // Current expense records use their date (or recurring paidDates) as the booked payment date.
    // There is no separate bank-settlement date in the existing data model.
    if (expense.category === 'INVESTMENT_LOSS') return []
    const dates =
      expense.frequency === 'NONE'
        ? expense.status === 'PAID'
          ? [expense.date]
          : []
        : expense.paidDates || []
    return dates
      .filter((date) => parseLocalDate(date))
      .map((date) => ({ date, amountCents: expense.amountCents, group: expense.group }))
  })
  return { income, outgoings }
}

export function getExpenseDistribution(outgoings, range) {
  const filtered = outgoings.filter((entry) => isDateInRange(entry.date, range))
  const totalCents = sumCents(filtered.map((entry) => entry.amountCents))
  const detail = EXPENSE_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    color: EXPENSE_COLORS[group.id],
    amountCents: sumCents(
      filtered.filter((entry) => entry.group === group.id).map((entry) => entry.amountCents),
    ),
  }))
    .filter((entry) => entry.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents || a.label.localeCompare(b.label))
    .map((entry) => ({
      ...entry,
      percent: Math.round((entry.amountCents / totalCents) * 1000) / 10,
    }))
  const chart = detail.slice(0, 5)
  if (detail.length > 5) {
    chart.push({
      id: 'COMBINED_OTHER',
      label: '其他分類',
      color: '#b7c3d2',
      amountCents: sumCents(detail.slice(5).map((entry) => entry.amountCents)),
      percent:
        Math.round(
          (sumCents(detail.slice(5).map((entry) => entry.amountCents)) / totalCents) * 1000,
        ) / 10,
    })
  }
  return { totalCents, detail, chart }
}

/** @param {{ range: {start: string, end: string} | null, workRecords?: Array<any>, trips?: Array<any>, expenses?: Array<any>, salaryDeposits?: Array<any> | null }} sources */
export function getDashboardSummary({
  range,
  workRecords = [],
  trips = [],
  expenses = [],
  salaryDeposits = null,
}) {
  const { income, outgoings } = getActualTransactions({ trips, expenses, salaryDeposits })
  const periodIncome = income.filter((entry) => isDateInRange(entry.date, range))
  const periodOutgoings = outgoings.filter((entry) => isDateInRange(entry.date, range))
  const periodWorkRecords = workRecords.filter(
    (record) => record.shiftType !== 'leave' && isDateInRange(record.workDate, range),
  )
  const actualIncomeCents = sumCents(periodIncome.map((entry) => entry.amountCents))
  const paidExpenseCents = sumCents(periodOutgoings.map((entry) => entry.amountCents))
  const estimatedWorkCents = sumCents(
    periodWorkRecords.map((record) => dollarsToCents(record.grossPay) || 0),
  )
  const pendingFareCents = sumCents(
    trips
      .filter((trip) => isDateInRange(trip.date, range))
      .flatMap((trip) =>
        (trip.charges || []).filter((charge) => charge.paymentStatus === 'PENDING'),
      )
      .map((charge) => charge.amountCents),
  )
  const distribution = getExpenseDistribution(outgoings, range)
  const days = getDatesInRange(range).map((date) => {
    const tripCents = sumCents(
      periodIncome
        .filter((entry) => entry.date === date && entry.kind === 'trip')
        .map((entry) => entry.amountCents),
    )
    const salaryCents = sumCents(
      periodIncome
        .filter((entry) => entry.date === date && entry.kind === 'salary')
        .map((entry) => entry.amountCents),
    )
    const workCents = sumCents(
      workRecords
        .filter((record) => record.workDate === date && record.shiftType !== 'leave')
        .map((record) => dollarsToCents(record.grossPay) || 0),
    )
    return {
      date,
      actualCents: tripCents + salaryCents,
      tripCents,
      salaryCents,
      estimatedCents: workCents,
    }
  })
  return {
    range,
    actualIncomeCents,
    paidExpenseCents,
    netCents: actualIncomeCents - paidExpenseCents,
    estimatedWorkCents,
    pendingFareCents,
    hasActualIncomeRecords: income.length > 0,
    hasEstimatedWorkRecords: workRecords.some((record) => record.shiftType !== 'leave'),
    hasActualIncomeInRange: periodIncome.length > 0,
    hasEstimatedWorkInRange: periodWorkRecords.length > 0,
    hasActualTransactions: income.length > 0 || outgoings.length > 0,
    salaryDepositConfigured: Array.isArray(salaryDeposits),
    distribution,
    days,
  }
}

export function getPreferredIncomeMode(summary) {
  if (summary.hasActualIncomeInRange) return 'actual'
  if (summary.hasEstimatedWorkInRange) return 'estimated'
  if (summary.hasActualIncomeRecords) return 'actual'
  if (summary.hasEstimatedWorkRecords) return 'estimated'
  return null
}

export function validateSavingGoal(goal) {
  if (!String(goal.name || '').trim()) throw new Error('請輸入目標名稱')
  if (!Number.isSafeInteger(goal.targetCents) || goal.targetCents <= 0)
    throw new Error('目標金額必須大於 0')
  if (!Number.isSafeInteger(goal.initialCents)) throw new Error('請輸入有效的起始存款')
  if (!parseLocalDate(goal.startDate)) throw new Error('請選擇有效開始日期')
  if (goal.endDate && (!parseLocalDate(goal.endDate) || goal.endDate < goal.startDate))
    throw new Error('截止日期不可早於開始日期')
  return { ...goal, name: goal.name.trim(), endDate: goal.endDate || null }
}

export function getSavingProgress(goal, transactions, today) {
  if (!goal) return null
  const end = today >= goal.startDate ? today : null
  const inGoalRange = (entry) => end && entry.date >= goal.startDate && entry.date <= end
  const goalIncome = transactions.income.filter(inGoalRange)
  const goalExpenses = transactions.outgoings.filter(inGoalRange)
  const actualIncomeCents = sumCents(goalIncome.map((entry) => entry.amountCents))
  const paidExpenseCents = sumCents(goalExpenses.map((entry) => entry.amountCents))
  const currentCents = goal.initialCents + actualIncomeCents - paidExpenseCents
  const percent = Math.round((currentCents / goal.targetCents) * 1000) / 10
  return {
    currentCents,
    actualIncomeCents,
    paidExpenseCents,
    remainingCents: Math.max(0, goal.targetCents - currentCents),
    excessCents: Math.max(0, currentCents - goal.targetCents),
    percent,
    progressPercent: Math.min(100, Math.max(0, percent)),
    hasActualTransactions: goalIncome.length > 0 || goalExpenses.length > 0,
  }
}

/** @param {Array<any>} [records] @param {number | null} [target] */
export function getDesignatedWorkProgress(records = [], target = null) {
  const dates = [
    ...new Set(
      records
        .filter(
          (record) =>
            record.designatedWork === true &&
            record.shiftType !== 'leave' &&
            record.paidMinutes > 0 &&
            parseLocalDate(record.workDate),
        )
        .map((record) => record.workDate),
    ),
  ].sort()
  return {
    dates,
    count: dates.length,
    target,
    remaining: target === null ? null : Math.max(0, target - dates.length),
    progressPercent: target === null ? null : Math.min(100, (dates.length / target) * 100),
  }
}
