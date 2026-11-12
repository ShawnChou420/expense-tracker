import { classifyPayItem } from './classify.js'

const MONEY = String.raw`-?\$?[\d,]+\.\d{2}`
const DATE = String.raw`\d{1,2}\/\d{1,2}\/\d{4}`

/** @param {string | undefined} text */
function toCents(text) {
  if (!text) return null
  const value = Number(text.replace(/[$,\s]/g, ''))
  return Number.isFinite(value) ? Math.round(Math.abs(value) * 100) : null
}

/** DD/MM/YYYY → YYYY-MM-DD */
function toIsoDate(/** @type {string | undefined} */ text) {
  if (!text) return null
  const [day, month, year] = text.split('/').map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 找到第一個符合的行，回傳 regex 結果 */
function findLine(/** @type {string[]} */ lines, /** @type {RegExp} */ pattern) {
  for (const line of lines) {
    const match = pattern.exec(line)
    if (match) return match
  }
  return null
}

const SECTION_END = /^\s*(Banking|Superannuation\b|Leave in|Item\s+This Pay|NET PAY|Deductions)/i
const HOURLY_ITEM = new RegExp(
  String.raw`^\s*(.*?[A-Za-z].*?)\s+(\d+(?:\.\d+)?)\s*(?:Hrs?|Hours|hrs?)?\s+(\d+\.\d{2,4})\s+(${MONEY})(?:\s+[A-Z*]{1,3})?\s*$`,
)
const FLAT_ITEM = new RegExp(String.raw`^\s*(.*?[A-Za-z].*?)\s{2,}(${MONEY})(?:\s+[A-Z*]{1,3})?\s*$`)

/**
 * 解析薪資單文字（一行一字串）。只做辨識，不做任何寫入。
 * 金額皆為 AUD cents，日期為 YYYY-MM-DD。
 *
 * @param {string[]} lines
 */
export function parsePayslipLines(lines) {
  /** @type {string[]} */
  const warnings = []

  const employer = findLine(lines, /^\s*Employer\s{1,}(.+?)(?:\s{2,}|$)/i)?.[1]?.trim() || ''
  const abn = findLine(lines, /\bABN\s*:?\s*(\d[\d ]{9,13}\d)/i)?.[1]?.replace(/\s/g, '') || ''
  const period = findLine(
    lines,
    new RegExp(String.raw`Period(?:\s+End)?\s*:?\s*(${DATE})\s*(?:-|–|to)\s*(${DATE})`, 'i'),
  )
  const payDate = findLine(lines, new RegExp(String.raw`Pay(?:ment)?\s+Date\s*:?\s*(${DATE})`, 'i'))

  const summary = (/** @type {string} */ label) =>
    findLine(lines, new RegExp(String.raw`^\s*${label}\s+(${MONEY})(?:\s+(${MONEY}))?`, 'i'))
  const gross = summary('Gross')
  const tax = summary('(?:Tax|PAYG(?: Withholding)?)')
  const net = summary('NET PAY')
  // Super 以「Superannuation 本期 YTD」這種摘要行為準；退休金基金那一行有三個數字（本期、期間、YTD）
  const superSummary = findLine(
    lines,
    new RegExp(String.raw`Superannuation\s+(${MONEY})\s+(${MONEY})\s*$`, 'i'),
  )
  const superFund = findLine(
    lines,
    new RegExp(String.raw`SUPER.*?\d+(?:\.\d+)?%\s+(${MONEY})\s+(${MONEY})\s+(${MONEY})`, 'i'),
  )

  // --- 薪資項目 ---
  /** @type {Array<{ rawName: string, hours: number | null, rate: number | null, amountCents: number | null }>} */
  const items = []
  const headerIndex = lines.findIndex((line) => /^\s*Item\s+Hours\s+Rate\s+Amount/i.test(line))
  if (headerIndex === -1) warnings.push('找不到薪資項目表頭（Item / Hours / Rate / Amount）')
  for (let index = headerIndex + 1; headerIndex !== -1 && index < lines.length; index += 1) {
    const line = lines[index]
    if (SECTION_END.test(line)) break
    if (/^\s*(Additions|Deductions Before Tax)\s*$/i.test(line) || !line.trim()) continue
    const hourly = HOURLY_ITEM.exec(line)
    if (hourly) {
      items.push({
        rawName: hourly[1].trim(),
        hours: Number(hourly[2]),
        rate: Number(hourly[3]),
        amountCents: toCents(hourly[4]),
      })
      continue
    }
    const flat = FLAT_ITEM.exec(line)
    if (flat) {
      items.push({ rawName: flat[1].trim(), hours: null, rate: null, amountCents: toCents(flat[2]) })
      continue
    }
    // 沒有金額的行：多半是上一個項目名稱太長換行（含「LEVEL」後的級數）；有金額但沒名稱的是小計，略過
    const previous = items.at(-1)
    const isNameContinuation = /[A-Za-z]/.test(line) || /^\s*\d{1,3}\s*$/.test(line)
    if (previous && isNameContinuation && !/\d+\.\d{2}/.test(line)) {
      previous.rawName = `${previous.rawName} ${line.trim()}`.replace(/\s+/g, ' ')
    }
  }

  const baseCandidate = items
    .filter((item) => item.hours !== null && classifyPayItem(item.rawName).type === 'UNKNOWN')
    .sort((a, b) => (b.hours ?? 0) - (a.hours ?? 0))[0]
  const baseRate = baseCandidate?.rate ?? null
  const classifiedItems = items.map((item) => ({
    ...item,
    ...classifyPayItem(item.rawName, {
      hours: item.hours,
      rate: item.rate,
      baseRate,
      isBase: item === baseCandidate,
    }),
    userConfirmed: false,
  }))

  const result = {
    employer: { name: employer, abn },
    periodStart: toIsoDate(period?.[1]),
    periodEnd: toIsoDate(period?.[2]),
    payDate: toIsoDate(payDate?.[1]),
    grossCents: toCents(gross?.[1]),
    taxCents: toCents(tax?.[1]),
    netCents: toCents(net?.[1]),
    superCents: toCents(superSummary?.[1] ?? superFund?.[1]),
    ytd: {
      grossCents: toCents(gross?.[2]),
      taxCents: toCents(tax?.[2]),
      superCents: toCents(superSummary?.[2] ?? superFund?.[3]),
    },
    baseRate,
    items: classifiedItems,
    warnings,
  }
  result.warnings.push(...validatePayslip(result))
  return result
}

/**
 * @typedef {object} PayslipCheckInput
 * @property {string | null} payDate
 * @property {string | null} periodStart
 * @property {string | null} periodEnd
 * @property {number | null} grossCents
 * @property {number | null} taxCents
 * @property {number | null} netCents
 * @property {Array<{ rawName: string, hours: number | null, rate: number | null, amountCents: number | null }>} items
 */

/**
 * 一致性檢查：項目加總＝Gross、Gross − Tax ＝ Net、工時 × 費率 ≈ 金額。
 * @param {PayslipCheckInput} payslip
 * @returns {string[]}
 */
export function validatePayslip(payslip) {
  const warnings = []
  if (!payslip.payDate) warnings.push('找不到付款日期（Pay Date）')
  if (!payslip.periodStart || !payslip.periodEnd) warnings.push('找不到薪資期間')
  if (payslip.grossCents === null) warnings.push('找不到稅前總額（Gross）')
  if (payslip.netCents === null) warnings.push('找不到實領金額（Net Pay）')
  if (payslip.taxCents === null) warnings.push('找不到扣稅金額（Tax / PAYG）')
  if (!payslip.items.length) warnings.push('沒有辨識到任何薪資項目')

  const itemTotal = payslip.items.reduce((total, item) => total + (item.amountCents ?? 0), 0)
  if (payslip.grossCents !== null && payslip.items.length && itemTotal !== payslip.grossCents) {
    warnings.push(
      `薪資項目加總 ${(itemTotal / 100).toFixed(2)} 與 Gross ${(payslip.grossCents / 100).toFixed(2)} 不一致`,
    )
  }
  if (payslip.grossCents !== null && payslip.taxCents !== null && payslip.netCents !== null) {
    const expectedNet = payslip.grossCents - payslip.taxCents
    if (expectedNet !== payslip.netCents) {
      warnings.push('Gross − Tax 與 Net Pay 不一致（可能有其他扣款），請確認實領金額')
    }
  }
  for (const item of payslip.items) {
    if (item.hours === null || item.rate === null || item.amountCents === null) continue
    if (Math.abs(Math.round(item.hours * item.rate * 100) - item.amountCents) > 2) {
      warnings.push(`「${item.rawName}」的工時 × 費率與金額不一致`)
    }
  }
  return warnings
}
