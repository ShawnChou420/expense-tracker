/**
 * 把薪資單辨識出的項目轉成 App 的費率設定，並和目前設定比對。
 *
 * App 的費率慣例：
 * - 基本時薪、T/Half、Double 是「完整時薪」
 * - Casual、夜班、週六、週日是「額外加給（每小時加多少）」
 * 薪資單若用另一種寫法（例如週日寫成 1.75 倍完整時薪），會先換算成 App 的慣例，不直接相加。
 */
export const RATE_FIELDS = [
  {
    key: 'baseRate',
    type: 'BASE_PAY',
    label: '基本時薪',
    unit: '／小時',
    mode: 'FULL',
    multiplier: 1,
  },
  {
    key: 'casualLoadingRate',
    type: 'CASUAL_LOADING',
    label: 'Casual 加給',
    unit: '／小時',
    mode: 'ADDITIONAL',
    multiplier: 0.25,
  },
  {
    key: 'shiftLoadingRate',
    type: 'SHIFT_LOADING',
    label: '夜班加給',
    unit: '／小時',
    mode: 'ADDITIONAL',
    multiplier: 0.25,
  },
  {
    key: 'saturdayOrdLoadingRate',
    type: 'SATURDAY_LOADING',
    label: '週六加給',
    unit: '／小時',
    mode: 'ADDITIONAL',
    multiplier: 0.5,
  },
  {
    key: 'sundayLoadingRate',
    type: 'SUNDAY_LOADING',
    label: '週日加給',
    unit: '／小時',
    mode: 'ADDITIONAL',
    multiplier: 0.75,
  },
  {
    key: 'timeHalfRate',
    type: 'OVERTIME_1_5',
    label: '加班 1.5 倍',
    unit: '／小時',
    mode: 'FULL',
    multiplier: 1.5,
  },
  {
    key: 'doubleRate',
    type: 'OVERTIME_2_0',
    label: '加班 2 倍',
    unit: '／小時',
    mode: 'FULL',
    multiplier: 2,
  },
  {
    key: 'ppeAllowance',
    type: 'PPE_ALLOWANCE',
    label: 'PPE 津貼',
    unit: '／週',
    mode: 'FLAT',
    multiplier: null,
  },
]

/** 依基本時薪 × 預設倍率得到的費率（尚未從薪資單確認時使用） */
export function getDefaultDerivedRate(/** @type {string} */ key, /** @type {number} */ baseRate) {
  const field = RATE_FIELDS.find((candidate) => candidate.key === key)
  if (!field || field.multiplier === null || key === 'baseRate') return null
  return Math.round(baseRate * field.multiplier * 10000) / 10000
}

const round4 = (/** @type {number} */ value) => Math.round(value * 10000) / 10000

/**
 * @param {{ items: Array<{ rawName: string, type: string, calcMethod: string, rate: number | null, hours: number | null, amountCents: number | null }>, baseRate: number | null, grossCents: number | null, taxCents: number | null, periodStart?: string | null, periodEnd?: string | null }} payslip
 * @param {Record<string, number>} currentRates App 目前的費率
 * @param {Record<string, string>} [currentSources] 每項費率目前的來源：'payslip' 或 'default'
 */
export function getRateProposals(payslip, currentRates, currentSources = {}) {
  const base = payslip.baseRate
  const rows = RATE_FIELDS.map((field) => {
    const matches = payslip.items.filter((item) => item.type === field.type)
    const item = matches[0]
    /** @type {number | null} */
    let proposed = null
    if (item && field.mode === 'FLAT') {
      proposed = item.amountCents === null ? null : item.amountCents / 100
    } else if (item && item.rate !== null) {
      let value = item.rate
      if (base && field.mode === 'ADDITIONAL' && item.calcMethod === 'FULL_RATE') {
        value = item.rate - base
      } else if (base && field.mode === 'FULL' && item.calcMethod === 'ADDITIONAL') {
        value = item.rate + base
      }
      proposed = round4(value)
    }
    const current = Number(currentRates[field.key])
    const conflicting =
      matches.length > 1 && matches.some((other) => other.rate !== null && other.rate !== item?.rate)
    // 相同數值＝SAME；不同時，若目前是預設倍率＝NEW（新發現），若已由薪資單確認過＝CHANGED
    let status = 'NOT_OBSERVED'
    if (proposed !== null) {
      if (Number.isFinite(current) && Math.abs(current - proposed) < 0.00005) status = 'SAME'
      else status = currentSources[field.key] === 'payslip' ? 'CHANGED' : 'NEW'
    }
    return {
      key: field.key,
      label: field.label,
      unit: field.unit,
      sourceName: item?.rawName ?? null,
      current: Number.isFinite(current) ? current : null,
      proposed,
      status,
      warning: conflicting ? '薪資單上同類項目有不同費率，請確認' : null,
    }
  })

  // 扣稅比率：本次 Tax ÷ Gross（WHM 為級距制，這只是本次實際比例）
  if (payslip.grossCents && payslip.taxCents !== null) {
    const proposed = round4(payslip.taxCents / payslip.grossCents)
    const current = Number(currentRates.withholdingTaxRate)
    rows.push({
      key: 'withholdingTaxRate',
      label: '扣稅比率',
      unit: '',
      sourceName: 'Tax ÷ Gross',
      current: Number.isFinite(current) ? current : null,
      proposed,
      status: Math.abs(current - proposed) < 0.00005 ? 'SAME' : 'CHANGED',
      warning: null,
    })
  }
  return rows
}

/** 只回傳要套用的費率：有辨識到且不是 NOT_OBSERVED 的項目；未出現的費率保持原值。 */
export function getRatesToApply(/** @type {ReturnType<typeof getRateProposals>} */ proposals) {
  /** @type {Record<string, number>} */
  const result = {}
  for (const row of proposals) {
    if (row.status !== 'NOT_OBSERVED' && row.proposed !== null) result[row.key] = row.proposed
  }
  return result
}

/**
 * 從後端儲存的費率中，找出「不是預設倍率」的加成費率，視為已由薪資單確認。
 * （若薪資單上的費率剛好等於預設倍率，數值相同，沒有覆寫的必要。）
 * @param {Record<string, unknown>} stored
 */
export function getStoredRateOverrides(stored) {
  const baseRate = Number(stored.baseRate)
  /** @type {Record<string, number>} */
  const overrides = {}
  if (!Number.isFinite(baseRate)) return overrides
  for (const field of RATE_FIELDS) {
    const defaultRate = getDefaultDerivedRate(field.key, baseRate)
    const value = Number(stored[field.key])
    if (defaultRate === null || stored[field.key] == null || !Number.isFinite(value)) continue
    if (Math.abs(value - defaultRate) >= 0.00005) overrides[field.key] = value
  }
  return overrides
}
