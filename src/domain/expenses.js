import { formatLocalDate, isDateInRange, parseLocalDate } from './date.js'
import { sumCents } from './money.js'

export const EXPENSE_GROUPS = [
  {
    id: 'HOUSING',
    label: '住房',
    icon: 'home-o',
    categories: [
      { id: 'RENT', label: '房租' },
      { id: 'UTILITIES', label: '水電瓦斯' },
    ],
  },
  {
    id: 'FOOD',
    label: '飲食',
    icon: 'shop-o',
    categories: [
      { id: 'GROCERIES', label: '採買' },
      { id: 'DINING', label: '吃飯' },
      { id: 'COFFEE', label: '咖啡飲料' },
    ],
  },
  {
    id: 'TRANSPORT',
    label: '交通',
    icon: 'logistics',
    categories: [
      { id: 'FUEL', label: '加油' },
      { id: 'CAR', label: '車輛維修' },
      { id: 'TRANSIT', label: '大眾運輸' },
    ],
  },
  {
    id: 'LIFE',
    label: '生活',
    icon: 'smile-o',
    categories: [
      { id: 'FITNESS', label: '健身房' },
      { id: 'PHONE', label: '手機網路' },
      { id: 'SHOPPING', label: '購物' },
      { id: 'TRAVEL', label: '旅遊' },
      { id: 'FUN', label: '娛樂' },
    ],
  },
  {
    id: 'INSURANCE',
    label: '保險',
    icon: 'shield-o',
    categories: [
      { id: 'HEALTH_INSURANCE', label: '醫療保險' },
      { id: 'CAR_INSURANCE', label: '車險' },
      { id: 'OTHER_INSURANCE', label: '其他保險' },
    ],
  },
  {
    id: 'FINANCE',
    label: '財務',
    icon: 'balance-o',
    categories: [
      { id: 'LOAN', label: '貸款還款' },
      { id: 'INVESTMENT_LOSS', label: '已實現投資虧損' },
    ],
  },
  {
    id: 'OTHER',
    label: '其他',
    icon: 'ellipsis',
    categories: [{ id: 'OTHER', label: '其他支出' }],
  },
]

export const EXPENSE_FREQUENCIES = [
  { id: 'NONE', label: '單次' },
  { id: 'WEEKLY', label: '每週' },
  { id: 'BIWEEKLY', label: '每兩週' },
  { id: 'MONTHLY', label: '每月' },
  { id: 'CUSTOM', label: '自訂天數' },
]

export function getExpenseGroup(groupId) {
  return EXPENSE_GROUPS.find((group) => group.id === groupId)
}

export function getExpenseCategory(groupId, categoryId) {
  return getExpenseGroup(groupId)?.categories.find((category) => category.id === categoryId)
}

export function createExpense(input) {
  if (!parseLocalDate(input.date)) throw new Error('請選擇有效日期')
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('請輸入大於 0 的有效金額')
  }
  if (!getExpenseCategory(input.group, input.category)) throw new Error('請選擇支出大類與小類')
  const frequency = input.frequency || 'NONE'
  if (!EXPENSE_FREQUENCIES.some((item) => item.id === frequency)) throw new Error('請選擇有效頻率')
  const customIntervalDays = Number(input.intervalDays)
  if (
    frequency === 'CUSTOM' &&
    (!Number.isSafeInteger(customIntervalDays) ||
      customIntervalDays < 1 ||
      customIntervalDays > 365)
  ) {
    throw new Error('自訂頻率請輸入 1–365 天')
  }
  if (!['PAID', 'PLANNED'].includes(input.status)) throw new Error('請選擇付款狀態')
  if (input.category === 'INVESTMENT_LOSS' && (frequency !== 'NONE' || input.status !== 'PAID')) {
    throw new Error('已實現投資虧損只能記為單次紀錄')
  }
  const endDate = frequency === 'NONE' ? null : input.endDate || null
  if (endDate && (!parseLocalDate(endDate) || endDate < input.date)) {
    throw new Error('結束日期不可早於起始日期')
  }
  const paidDates =
    frequency === 'NONE'
      ? []
      : [...new Set(input.paidDates || (input.status === 'PAID' ? [input.date] : []))]
  if (paidDates.some((date) => !parseLocalDate(date))) throw new Error('付款日期無效')
  if (endDate && paidDates.some((date) => date > endDate)) {
    throw new Error('結束日期不可早於已付紀錄')
  }

  return {
    id: input.id || `expense-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: input.date,
    amountCents: input.amountCents,
    group: input.group,
    category: input.category,
    title: String(input.title || '').trim(),
    note: String(input.note || '').trim(),
    frequency,
    intervalDays: frequency === 'CUSTOM' ? customIntervalDays : null,
    endDate,
    status: frequency === 'NONE' ? input.status : 'PLANNED',
    paidDates,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function occurrenceDate(expense, index) {
  const start = parseLocalDate(expense.date)
  if (!start) throw new Error('固定支出的起始日期無效')
  if (expense.frequency === 'MONTHLY') {
    const first = new Date(start.getFullYear(), start.getMonth() + index, 1)
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    return formatLocalDate(
      new Date(first.getFullYear(), first.getMonth(), Math.min(start.getDate(), lastDay)),
    )
  }
  const days =
    expense.frequency === 'WEEKLY'
      ? 7
      : expense.frequency === 'BIWEEKLY'
        ? 14
        : expense.intervalDays
  if (typeof days !== 'number' || !Number.isSafeInteger(days) || days < 1) {
    throw new Error('固定支出的間隔天數無效')
  }
  start.setDate(start.getDate() + index * days)
  return formatLocalDate(start)
}

export function getExpenseOccurrences(expenses, range) {
  if (!range) return []
  return expenses.flatMap((expense) => {
    if (expense.frequency === 'NONE')
      return isDateInRange(expense.date, range)
        ? [{ ...expense, sourceId: expense.id, occurrenceId: expense.id }]
        : []
    const occurrences = []
    // The selected week is short; stop once a generated due date has passed its end.
    for (let index = 0; index < 10000; index += 1) {
      const date = occurrenceDate(expense, index)
      if (date > range.end || (expense.endDate && date > expense.endDate)) break
      if (date >= range.start)
        occurrences.push({
          ...expense,
          date,
          sourceId: expense.id,
          occurrenceId: `${expense.id}@${date}`,
          status: expense.paidDates.includes(date) ? 'PAID' : 'PLANNED',
        })
    }
    return occurrences
  })
}

export function getExpenseSummary(expenses, range) {
  const weekly = getExpenseOccurrences(expenses, range)
  const paid = weekly.filter((expense) => expense.status === 'PAID')
  const planned = weekly.filter((expense) => expense.status === 'PLANNED')
  // Investment performance is tracked separately: a realized loss is not itself a cash payment.
  const cashPaid = paid.filter((expense) => expense.category !== 'INVESTMENT_LOSS')
  const cashPlanned = planned.filter((expense) => expense.category !== 'INVESTMENT_LOSS')
  return {
    paidCents: sumCents(cashPaid.map((expense) => expense.amountCents)),
    plannedCents: sumCents(cashPlanned.map((expense) => expense.amountCents)),
    investmentLossCents: sumCents(
      paid
        .filter((expense) => expense.category === 'INVESTMENT_LOSS')
        .map((expense) => expense.amountCents),
    ),
    count: weekly.length,
    byGroup: EXPENSE_GROUPS.map((group) => ({
      ...group,
      amountCents: sumCents(
        cashPaid
          .filter((expense) => expense.group === group.id)
          .map((expense) => expense.amountCents),
      ),
    })).filter((group) => group.amountCents > 0),
  }
}
