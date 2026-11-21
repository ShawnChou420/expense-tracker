/**
 * 首頁「附近油價」：NSW FuelCheck 油價（後端 /api/fuel-prices/nearby，伺服器端快取）。
 * 油價單位是「每公升幾分（c/L）」，後端以 0.1 分的整數（priceTenths）傳來，例如 1899 → 189.9 c/L。
 * 偏好（油種、位置方式、郵遞區號）只存在這台裝置。
 */

export const FUEL_TYPE_OPTIONS = [
  { id: 'E10', label: 'E10' },
  { id: 'U91', label: '91' },
  { id: 'P95', label: '95' },
  { id: 'P98', label: '98' },
  { id: 'DL', label: '柴油' },
]

const FUEL_IDS = new Set(FUEL_TYPE_OPTIONS.map((option) => option.id))

/** @typedef {{ fuelType: string, mode: 'POSTCODE' | 'GPS', postcode: string }} FuelPrefs */

/** @returns {FuelPrefs} */
export function defaultFuelPrefs() {
  return { fuelType: 'E10', mode: 'POSTCODE', postcode: '' }
}

/**
 * @param {unknown} saved
 * @returns {FuelPrefs}
 */
export function normalizeFuelPrefs(saved) {
  const raw = /** @type {Record<string, unknown>} */ (
    saved && typeof saved === 'object' ? saved : {}
  )
  const fallback = defaultFuelPrefs()
  return {
    fuelType:
      typeof raw.fuelType === 'string' && FUEL_IDS.has(raw.fuelType)
        ? raw.fuelType
        : fallback.fuelType,
    mode: raw.mode === 'GPS' ? 'GPS' : 'POSTCODE',
    postcode: isValidPostcode(raw.postcode) ? String(raw.postcode) : '',
  }
}

/** 澳洲郵遞區號：4 位數字 */
export function isValidPostcode(/** @type {unknown} */ value) {
  return typeof value === 'string' && /^\d{4}$/.test(value)
}

/**
 * 後端查詢路徑。座標只取到小數第 3 位（約 100 公尺），不需要更精確的位置。
 * @param {{ fuelType: string, postcode?: string, latitude?: number, longitude?: number }} query
 * @returns {string | null} 參數不足時為 null
 */
export function buildFuelQueryPath({ fuelType, postcode, latitude, longitude }) {
  const params = new URLSearchParams({ fuelType: FUEL_IDS.has(fuelType) ? fuelType : 'E10' })
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    params.set('lat', Number(latitude).toFixed(3))
    params.set('lng', Number(longitude).toFixed(3))
  } else if (isValidPostcode(postcode)) {
    params.set('postcode', String(postcode))
  } else {
    return null
  }
  params.set('limit', '3')
  return `/fuel-prices/nearby?${params.toString()}`
}

/** 1899 → '189.9' */
export function formatFuelPrice(/** @type {number} */ priceTenths) {
  const value = Number(priceTenths)
  if (!Number.isFinite(value) || value <= 0) return '—'
  return (value / 10).toFixed(1)
}

/**
 * 最便宜與第二名的差價（c/L），用來提示「比第二名便宜 x.x」。不足兩站時為 null。
 * @param {Array<{ priceTenths: number }>} stations 已依價格排序
 */
export function getCheapestGap(stations) {
  if (!Array.isArray(stations) || stations.length < 2) return null
  const gap = stations[1].priceTenths - stations[0].priceTenths
  return gap > 0 ? (gap / 10).toFixed(1) : null
}

/**
 * 「12 分鐘前更新」「2 小時前更新」
 * @param {string | null | undefined} fetchedAt ISO 時間
 * @param {Date} now
 */
export function describeFuelFreshness(fetchedAt, now) {
  const time = fetchedAt ? new Date(fetchedAt).getTime() : NaN
  if (!Number.isFinite(time)) return ''
  const minutes = Math.max(0, Math.round((now.getTime() - time) / 60000))
  if (minutes < 1) return '剛剛更新'
  if (minutes < 60) return `${minutes} 分鐘前更新`
  return `${Math.round(minutes / 60)} 小時前更新`
}
