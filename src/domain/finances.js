import { isDateInRange, parseLocalDate } from './date.js'
import { EXPENSE_GROUPS, getExpenseOccurrences } from './expenses.js'
import { resolveConversion, getTransactionCurrency } from './fx.js'
import { dollarsToCents, sumCents } from './money.js'
import { getChargeReceivedCents } from './trips.js'

/**
 * 收支整合（Expense Tracker 3.0）：通用手動交易 financial_entry 與統一的收支 view model。
 *
 * 口徑（避免重複計算）：
 * - 已確認收入 = 薪資入帳（paidAt）＋ 車資實收（收款日）＋ 一般收入（INCOME／NORMAL／SETTLED，有 AUD 金額）
 * - 已支付支出 = 既有支出付款（付款日，不含 INVESTMENT_LOSS）＋ 外幣支出（EXPENSE／SETTLED，有 AUD 金額）
 * - 投資績效（另列）= INVESTMENT_GAIN − INVESTMENT_LOSS，不算一般收支
 * - 待收款（另列）= 車資未收（依行程日）＋ 預計收入（PLANNED）
 * - 預估薪資（另列）= 班表 grossPay（稅前），永遠不和薪資入帳相加
 * - 退款（另列）：不算收入、不抵支出、不計入實際差額
 * - 資金移轉（TRANSFER）：不算收入也不算支出
 * - 外幣沒有匯率（convertedAudCents = null）：不併入任何 AUD 合計，另列「未換算」
 * - 一般收入不影響薪資、集簽、工時、Payslip YTD（那些計算不讀 financial_entry）
 */

export const ENTRY_TYPES = Object.freeze({
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
  TRANSFER: 'TRANSFER',
})

export const ENTRY_STATUSES = Object.freeze({ SETTLED: 'SETTLED', PLANNED: 'PLANNED' })

export const CLASSIFICATIONS = Object.freeze({
  NORMAL: 'NORMAL',
  INVESTMENT_PNL: 'INVESTMENT_PNL',
  REFUND: 'REFUND',
  TRANSFER: 'TRANSFER',
})

/** 一般收入分類（不含薪資：薪資只來自班表預估與 Payslip 入帳） */
export const INCOME_CATEGORIES = Object.freeze([
  { id: 'SIDE_JOB', label: '副業收入', icon: 'bag-o' },
  { id: 'SECONDHAND_SALE', label: '二手出售', icon: 'exchange' },
  { id: 'BONUS', label: '獎金', icon: 'gift-o' },
  { id: 'GIFT', label: '禮金', icon: 'gift-card-o' },
  { id: 'REFUND', label: '退款', icon: 'cash-back-record' },
  { id: 'INVESTMENT_GAIN', label: '已實現投資獲利', icon: 'chart-trending-o' },
  { id: 'OTHER_INCOME', label: '其他收入', icon: 'ellipsis' },
])

/** @param {string} id */
export function getIncomeCategory(id) {
  return INCOME_CATEGORIES.find((category) => category.id === id)
}

/** 外幣支出可用的支出小類（已實現投資虧損仍只能用 AUD 記在支出頁） */
export function getForeignExpenseCategories() {
  return EXPENSE_GROUPS.flatMap((group) =>
    group.categories
      .filter((category) => category.id !== 'INVESTMENT_LOSS')
      .map((category) => ({ ...category, group: group.id })),
  )
}

/** @param {string} categoryId */
export function getExpenseGroupOfCategory(categoryId) {
  return EXPENSE_GROUPS.find((group) => group.categories.some((item) => item.id === categoryId))
}

/**
 * 分類 → 口徑。與後端 FinancialEntryController.classificationOf 相同。
 * @param {string} type
 * @param {string} category
 */
export function classificationOf(type, category) {
  if (type === ENTRY_TYPES.TRANSFER) return CLASSIFICATIONS.TRANSFER
  if (category === 'INVESTMENT_GAIN') return CLASSIFICATIONS.INVESTMENT_PNL
  if (category === 'REFUND') return CLASSIFICATIONS.REFUND
  return CLASSIFICATIONS.NORMAL
}

/** @typedef {{
 *   id: string, date: string, type: string, classification: string, status: string,
 *   category: string, title: string, note: string, amountMinor: number, currency: string,
 *   convertedAudCents: number | null, fxRate: string | null, fxRateDate: string | null,
 *   fxSource: string | null, createdAt?: string, updatedAt?: string,
 * }} FinancialEntry */

/**
 * 建立／驗證一筆通用手動交易（訪客與會員共用；後端會再驗證一次）。錯誤訊息是 i18n key。
 * @param {any} input
 * @returns {FinancialEntry}
 */
export function createFinancialEntry(input) {
  if (!parseLocalDate(input.date)) throw new Error('finances.errors.date')
  const type = input.type
  if (!Object.values(ENTRY_TYPES).includes(type)) throw new Error('finances.errors.type')
  const status = input.status || ENTRY_STATUSES.SETTLED
  if (!Object.values(ENTRY_STATUSES).includes(status)) throw new Error('finances.errors.status')
  const currency = input.currency || 'AUD'
  if (!getTransactionCurrency(currency)) throw new Error('finances.errors.currency')
  const category = input.category
  if (type === ENTRY_TYPES.INCOME && !getIncomeCategory(category))
    throw new Error('finances.errors.category')
  if (type === ENTRY_TYPES.EXPENSE) {
    if (!getForeignExpenseCategories().some((item) => item.id === category))
      throw new Error('finances.errors.category')
    if (currency === 'AUD') throw new Error('finances.errors.audExpense')
  }
  if (type === ENTRY_TYPES.TRANSFER && category !== 'TRANSFER')
    throw new Error('finances.errors.category')
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new Error('finances.errors.amount')
  const conversion = resolveConversion({
    amountMinor: input.amountMinor,
    currency,
    fxRate: input.fxRate,
    fxRateDate: input.fxRateDate,
    fxSource: input.fxSource,
  })
  const now = new Date().toISOString()
  return {
    id: input.id || `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: input.date,
    type,
    classification: classificationOf(type, category),
    status,
    category,
    title: String(input.title || '')
      .trim()
      .slice(0, 120),
    note: String(input.note || '')
      .trim()
      .slice(0, 500),
    amountMinor: input.amountMinor,
    currency,
    ...conversion,
    createdAt: input.createdAt || now,
    updatedAt: now,
  }
}

/** @param {FinancialEntry} entry */
const isSettled = (entry) => entry.status === ENTRY_STATUSES.SETTLED
/** @param {FinancialEntry} entry */
const hasAud = (entry) => Number.isSafeInteger(entry.convertedAudCents)

/** 一般收入（會算進已確認收入的那種） @param {FinancialEntry} entry */
export const isNormalIncome = (entry) =>
  entry.type === ENTRY_TYPES.INCOME && entry.classification === CLASSIFICATIONS.NORMAL
/** @param {FinancialEntry} entry */
export const isInvestmentGain = (entry) =>
  entry.type === ENTRY_TYPES.INCOME && entry.classification === CLASSIFICATIONS.INVESTMENT_PNL

/**
 * 已實際發生、有 AUD 金額、會影響現金收支的手動交易（給首頁／存款目標用）。
 * @param {Array<FinancialEntry>} entries
 */
export function getSettledEntryTransactions(entries = []) {
  const valid = entries.filter(
    (entry) => entry && isSettled(entry) && hasAud(entry) && parseLocalDate(entry.date),
  )
  return {
    income: valid.filter(isNormalIncome).map((entry) => ({
      date: entry.date,
      amountCents: /** @type {number} */ (entry.convertedAudCents),
      kind: 'other',
    })),
    outgoings: valid
      .filter((entry) => entry.type === ENTRY_TYPES.EXPENSE)
      .map((entry) => ({
        date: entry.date,
        amountCents: /** @type {number} */ (entry.convertedAudCents),
        group: getExpenseGroupOfCategory(entry.category)?.id || 'OTHER',
      })),
  }
}

/**
 * @typedef {object} FinanceItem
 * @property {'EXPENSE' | 'TRIP_CHARGE' | 'SALARY_DEPOSIT' | 'FINANCIAL_ENTRY' | 'WORK_ESTIMATE'} sourceType
 * @property {string} sourceId
 * @property {string} key 清單用的唯一鍵
 * @property {string} date
 * @property {'INCOME' | 'EXPENSE' | 'TRANSFER' | 'INVESTMENT' | 'FARE'} kind
 * @property {'ACTUAL' | 'PLANNED' | 'ESTIMATED'} basis
 * @property {number | null} audCents 正數；投資虧損也是正數（kind 決定方向）
 * @property {{ amountMinor: number, currency: string }} original
 * @property {string} category
 * @property {string} title
 * @property {string} status
 * @property {any} [detail]
 */

/**
 * 統一收支清單：每一筆來源只出現一次（sourceType + sourceId），由頁面決定怎麼篩選。
 * - 支出：依到期／發生日（週期支出展開成各期），狀態 PAID／PLANNED
 * - 車資：一個乘客的一筆應收一列（依行程日），附已收金額
 * - 薪資入帳：依入帳日
 * - 手動交易：依交易日
 * - 預估薪資：依班表日（ESTIMATED，不是實際收入）
 * @param {{
 *   range: { start: string, end: string } | null,
 *   expenses?: Array<any>, trips?: Array<any>, salaryDeposits?: Array<any> | null,
 *   entries?: Array<FinancialEntry>, workRecords?: Array<any>,
 *   passengerNames?: Record<string, string>,
 * }} sources
 * @returns {Array<FinanceItem>}
 */
export function getFinanceItems({
  range,
  expenses = [],
  trips = [],
  salaryDeposits = null,
  entries = [],
  workRecords = [],
  passengerNames = {},
}) {
  if (!range || !parseLocalDate(range.start) || !parseLocalDate(range.end)) return []
  /** @type {Array<FinanceItem>} */
  const items = []

  for (const occurrence of getExpenseOccurrences(expenses, range)) {
    const isLoss = occurrence.category === 'INVESTMENT_LOSS'
    items.push({
      sourceType: 'EXPENSE',
      sourceId: occurrence.sourceId,
      key: `EXPENSE:${occurrence.occurrenceId}`,
      date: occurrence.date,
      kind: isLoss ? 'INVESTMENT' : 'EXPENSE',
      basis: occurrence.status === 'PAID' ? 'ACTUAL' : 'PLANNED',
      audCents: occurrence.amountCents,
      original: { amountMinor: occurrence.amountCents, currency: 'AUD' },
      category: occurrence.category,
      title: occurrence.title || '',
      status: occurrence.status,
      detail: { group: occurrence.group, investmentLoss: isLoss },
    })
  }

  for (const trip of trips) {
    if (!trip || !isDateInRange(trip.date, range)) continue
    for (const charge of Array.isArray(trip.charges) ? trip.charges : []) {
      const amountCents = Number.isSafeInteger(charge.amountCents) ? charge.amountCents : 0
      const receivedCents = Math.min(amountCents, getChargeReceivedCents(charge))
      items.push({
        sourceType: 'TRIP_CHARGE',
        sourceId: trip.id,
        key: `TRIP_CHARGE:${trip.id}:${charge.passengerId}`,
        date: trip.date,
        kind: 'FARE',
        basis: receivedCents >= amountCents ? 'ACTUAL' : 'PLANNED',
        audCents: amountCents,
        original: { amountMinor: amountCents, currency: 'AUD' },
        category: trip.type || '',
        title: passengerNames[charge.passengerId] || '',
        status:
          receivedCents >= amountCents ? 'RECEIVED' : receivedCents > 0 ? 'PARTIAL' : 'UNPAID',
        detail: { passengerId: charge.passengerId, receivedCents },
      })
    }
  }

  for (const deposit of salaryDeposits || []) {
    if (!deposit || deposit.type === 'TRANSFER' || !Number.isSafeInteger(deposit.amountCents))
      continue
    if (!isDateInRange(deposit.paidAt, range)) continue
    items.push({
      sourceType: 'SALARY_DEPOSIT',
      sourceId: String(deposit.id),
      key: `SALARY_DEPOSIT:${deposit.id}`,
      date: deposit.paidAt,
      kind: 'INCOME',
      basis: 'ACTUAL',
      audCents: deposit.amountCents,
      original: { amountMinor: deposit.amountCents, currency: 'AUD' },
      category: 'SALARY',
      title: '',
      status: 'SETTLED',
    })
  }

  for (const entry of entries) {
    if (!entry || !isDateInRange(entry.date, range)) continue
    const kind =
      entry.type === ENTRY_TYPES.TRANSFER
        ? 'TRANSFER'
        : entry.classification === CLASSIFICATIONS.INVESTMENT_PNL
          ? 'INVESTMENT'
          : entry.type === ENTRY_TYPES.EXPENSE
            ? 'EXPENSE'
            : 'INCOME'
    items.push({
      sourceType: 'FINANCIAL_ENTRY',
      sourceId: entry.id,
      key: `FINANCIAL_ENTRY:${entry.id}`,
      date: entry.date,
      kind,
      basis: isSettled(entry) ? 'ACTUAL' : 'PLANNED',
      audCents: hasAud(entry) ? entry.convertedAudCents : null,
      original: { amountMinor: entry.amountMinor, currency: entry.currency },
      category: entry.category,
      title: entry.title || '',
      status: entry.status,
      detail: { classification: entry.classification, entry },
    })
  }

  for (const record of workRecords) {
    if (!record || record.shiftType === 'leave' || !isDateInRange(record.workDate, range)) continue
    const grossCents = dollarsToCents(record.grossPay) ?? 0
    items.push({
      sourceType: 'WORK_ESTIMATE',
      sourceId: String(record.id),
      key: `WORK_ESTIMATE:${record.id}`,
      date: record.workDate,
      kind: 'INCOME',
      basis: 'ESTIMATED',
      audCents: grossCents,
      original: { amountMinor: grossCents, currency: 'AUD' },
      category: 'WORK',
      title: '',
      status: 'ESTIMATED',
    })
  }

  return items.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key))
}

/**
 * 期間摘要。實際收支依「實際發生日」：車資看收款日、支出看付款日，所以不是單純加總 getFinanceItems。
 * @param {Parameters<typeof getFinanceItems>[0]} sources
 */
export function getFinanceSummary(sources) {
  const { range, expenses = [], trips = [], salaryDeposits = null, entries = [] } = sources
  const empty = {
    confirmedIncomeCents: 0,
    salaryIncomeCents: 0,
    fareIncomeCents: 0,
    otherIncomeCents: 0,
    paidExpenseCents: 0,
    netCents: 0,
    investment: { gainCents: 0, lossCents: 0, netCents: 0 },
    receivable: { fareCents: 0, plannedIncomeCents: 0, totalCents: 0 },
    plannedExpenseCents: 0,
    estimatedPayCents: 0,
    refundCents: 0,
    transferCount: 0,
    unconverted: /** @type {Array<{ currency: string, amountMinor: number, count: number }>} */ ([]),
  }
  if (!range || !parseLocalDate(range.start) || !parseLocalDate(range.end)) return empty
  const inRange = (/** @type {string} */ date) => isDateInRange(date, range)

  // 車資實收：依收款日（與首頁 getActualTransactions 相同規則）
  const fareIncomeCents = sumCents(
    trips.flatMap((trip) =>
      (trip?.charges || []).flatMap((/** @type {any} */ charge) => {
        if (Array.isArray(charge.payments))
          return charge.payments
            .filter((/** @type {any} */ payment) => inRange(payment.paidAt))
            .map((/** @type {any} */ payment) => payment.amountCents)
        return charge.paymentStatus === 'PAID' && inRange(charge.paidAt) ? [charge.amountCents] : []
      }),
    ),
  )
  const salaryIncomeCents = sumCents(
    (salaryDeposits || [])
      .filter((deposit) => deposit && deposit.type !== 'TRANSFER' && inRange(deposit.paidAt))
      .map((deposit) => deposit.amountCents),
  )
  const periodEntries = entries.filter((entry) => entry && inRange(entry.date))
  const settledAud = periodEntries.filter((entry) => isSettled(entry) && hasAud(entry))
  const audOf = (/** @type {Array<FinancialEntry>} */ list) =>
    sumCents(list.map((entry) => /** @type {number} */ (entry.convertedAudCents)))
  const otherIncomeCents = audOf(settledAud.filter(isNormalIncome))

  // 支出：依付款日；不含投資虧損
  const paidLegacyCents = sumCents(
    expenses.flatMap((expense) => {
      if (expense.category === 'INVESTMENT_LOSS') return []
      if (Array.isArray(expense.payments))
        return expense.payments
          .filter((/** @type {any} */ payment) => inRange(payment.paidAt))
          .map((/** @type {any} */ payment) => payment.amountCents)
      const dates =
        expense.frequency === 'NONE'
          ? expense.status === 'PAID'
            ? [expense.date]
            : []
          : expense.paidDates || []
      return dates.filter(inRange).map(() => expense.amountCents)
    }),
  )
  const paidForeignCents = audOf(settledAud.filter((entry) => entry.type === ENTRY_TYPES.EXPENSE))

  const occurrences = getExpenseOccurrences(expenses, range)
  const lossCents = sumCents(
    occurrences
      .filter((item) => item.category === 'INVESTMENT_LOSS' && item.status === 'PAID')
      .map((item) => item.amountCents),
  )
  const gainCents = audOf(settledAud.filter(isInvestmentGain))
  const plannedExpenseCents =
    sumCents(
      occurrences
        .filter((item) => item.category !== 'INVESTMENT_LOSS' && item.status !== 'PAID')
        .map((item) => item.amountCents),
    ) +
    audOf(
      periodEntries.filter(
        (entry) => entry.type === ENTRY_TYPES.EXPENSE && !isSettled(entry) && hasAud(entry),
      ),
    )

  const pendingFareCents = sumCents(
    trips
      .filter((trip) => trip && inRange(trip.date))
      .flatMap((trip) => trip.charges || [])
      .map((/** @type {any} */ charge) =>
        Math.max(0, charge.amountCents - getChargeReceivedCents(charge)),
      ),
  )
  const plannedIncomeCents = audOf(
    periodEntries.filter(
      (entry) =>
        entry.type === ENTRY_TYPES.INCOME &&
        entry.classification === CLASSIFICATIONS.NORMAL &&
        !isSettled(entry) &&
        hasAud(entry),
    ),
  )

  const estimatedPayCents = sumCents(
    (sources.workRecords || [])
      .filter((record) => record && record.shiftType !== 'leave' && inRange(record.workDate))
      .map((record) => dollarsToCents(record.grossPay) ?? 0),
  )

  /** @type {Map<string, { currency: string, amountMinor: number, count: number }>} */
  const unconverted = new Map()
  for (const entry of periodEntries) {
    if (hasAud(entry) || entry.type === ENTRY_TYPES.TRANSFER) continue
    const bucket = unconverted.get(entry.currency) || {
      currency: entry.currency,
      amountMinor: 0,
      count: 0,
    }
    bucket.amountMinor += entry.amountMinor
    bucket.count += 1
    unconverted.set(entry.currency, bucket)
  }

  const confirmedIncomeCents = salaryIncomeCents + fareIncomeCents + otherIncomeCents
  const paidExpenseCents = paidLegacyCents + paidForeignCents
  return {
    confirmedIncomeCents,
    salaryIncomeCents,
    fareIncomeCents,
    otherIncomeCents,
    paidExpenseCents,
    netCents: confirmedIncomeCents - paidExpenseCents,
    investment: { gainCents, lossCents, netCents: gainCents - lossCents },
    receivable: {
      fareCents: pendingFareCents,
      plannedIncomeCents,
      totalCents: pendingFareCents + plannedIncomeCents,
    },
    plannedExpenseCents,
    estimatedPayCents,
    refundCents: audOf(
      settledAud.filter(
        (entry) =>
          entry.type === ENTRY_TYPES.INCOME && entry.classification === CLASSIFICATIONS.REFUND,
      ),
    ),
    transferCount: periodEntries.filter((entry) => entry.type === ENTRY_TYPES.TRANSFER).length,
    unconverted: [...unconverted.values()],
  }
}

/**
 * 訪客資料合併到會員時，只送會員還沒有的紀錄（以 client id 比對；後端也是 upsert，重送不會重複）。
 * @template {{ id: string | number }} T
 * @param {Array<T>} guestItems
 * @param {Array<{ id: string | number }>} memberItems
 * @returns {Array<T>}
 */
export function missingById(guestItems, memberItems) {
  const ids = new Set(memberItems.map((item) => String(item.id)))
  return guestItems.filter((item) => !ids.has(String(item.id)))
}
