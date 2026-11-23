/**
 * 一鍵導航：產生 Google 地圖「路線規劃」網址（Universal link）。
 * 手機有安裝 Google 地圖會直接開 App，沒有就開網頁版；iPhone 的瀏覽器也能開。
 * 只把目的地文字放進網址，不帶使用者的目前位置。
 */

const MAX_DESTINATION_LENGTH = 200

/**
 * @param {string | null | undefined} destination 地點名稱或地址，例如「Baiada Pendle Hill」
 * @returns {string | null} 目的地空白時回傳 null
 */
export function buildDirectionsUrl(destination) {
  const text = String(destination ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DESTINATION_LENGTH)
  if (!text) return null
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(text)}`
}

/**
 * 加油站的導航目的地：名稱加地址，地圖比較不會找錯分店。
 * @param {{ name?: string | null, address?: string | null }} station
 */
export function stationDestination(station) {
  return [station?.name, station?.address].filter((part) => part && String(part).trim()).join(', ')
}
