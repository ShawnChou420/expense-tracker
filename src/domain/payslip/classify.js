/**
 * 薪資項目分類。名稱只決定「是哪一種加成」；「怎麼計算」由費率與基本時薪的比例判斷：
 * - FULL_RATE：費率本身就是完整時薪（例如 T/Half = 1.5 倍基本時薪）
 * - ADDITIONAL：在基本時薪之外額外加的金額（例如 Casual 25% = 0.25 倍）
 * - FLAT：沒有工時，只有固定金額（例如 PPE 津貼）
 */
const RULES = [
  { type: 'CASUAL_LOADING', pattern: /CASUAL\s*LOAD/i },
  { type: 'PUBLIC_HOLIDAY', pattern: /PUBLIC\s*HOL|P\s*\/\s*HOL|HOLIDAY/i },
  { type: 'OVERTIME_2_0', pattern: /DOUBLE|\bDT\b|OT\s*2(\.0)?\b|200\s*%/i },
  { type: 'OVERTIME_1_5', pattern: /T\s*\/\s*HALF|TIME\s*(AND|&)\s*A?\s*HALF|OT\s*1\.5|150\s*%/i },
  { type: 'SATURDAY_LOADING', pattern: /\bSAT/i },
  { type: 'SUNDAY_LOADING', pattern: /\bSUN/i },
  { type: 'SHIFT_LOADING', pattern: /SHIFT|NIGHT|AFTERNOON/i },
  { type: 'PPE_ALLOWANCE', pattern: /PPE|TOOL|UNIFORM|LAUNDRY/i },
]

export const PAY_ITEM_LABELS = {
  BASE_PAY: '基本時薪',
  CASUAL_LOADING: 'Casual 加給',
  SHIFT_LOADING: '夜班／輪班加給',
  SATURDAY_LOADING: '週六加給',
  SUNDAY_LOADING: '週日加給',
  OVERTIME_1_5: '加班 1.5 倍',
  OVERTIME_2_0: '加班 2 倍',
  PUBLIC_HOLIDAY: '國定假日',
  PPE_ALLOWANCE: 'PPE／工具津貼',
  OTHER_ALLOWANCE: '其他津貼',
  UNKNOWN: '未知項目',
}

/**
 * @param {string} rawName
 * @param {{ hours?: number | null, rate?: number | null, baseRate?: number | null, isBase?: boolean }} [context]
 */
export function classifyPayItem(rawName, context = {}) {
  const { hours = null, rate = null, baseRate = null, isBase = false } = context
  const rule = RULES.find((candidate) => candidate.pattern.test(rawName))
  let type = isBase ? 'BASE_PAY' : rule?.type || 'UNKNOWN'

  let calcMethod = hours === null ? 'FLAT' : 'HOURLY'
  let ratio = null
  if (hours !== null && rate !== null && baseRate) {
    ratio = Math.round((rate / baseRate) * 1000) / 1000
    if (type === 'BASE_PAY') calcMethod = 'FULL_RATE'
    else if (ratio >= 1) calcMethod = 'FULL_RATE'
    else calcMethod = 'ADDITIONAL'
  }

  let confidence = rule || isBase ? 'HIGH' : 'LOW'
  // 名稱與比例互相矛盾時降低信心，例如名稱像加班但比例不是 1.5
  if (type === 'OVERTIME_1_5' && ratio !== null && Math.abs(ratio - 1.5) > 0.01) {
    confidence = 'LOW'
  }
  if (type === 'OVERTIME_2_0' && ratio !== null && Math.abs(ratio - 2) > 0.01) confidence = 'LOW'
  return { type, calcMethod, ratio, confidence }
}
