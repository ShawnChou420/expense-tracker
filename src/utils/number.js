/**
 * 四捨五入到指定位數，避免 JS 浮點數誤差
 */
export function roundTo(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor
}

/**
 * 費率顯示：最多 3 位，不要一堆尾數
 * 例如：
 * 25.06 -> 25.06
 * 6.265 -> 6.265
 * 5.000 -> 5
 */
export function formatRate(value) {
  return String(roundTo(value, 3)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

/**
 * 將分鐘格式化成小時字串
 * 例如：345 -> 5.75
 */
export function formatHours(minutes) {
  return (minutes / 60).toFixed(2)
}

/**
 * 將金額格式化成小數點後兩位
 */
export function formatMoney(value) {
  return roundTo(value, 2).toFixed(2)
}
