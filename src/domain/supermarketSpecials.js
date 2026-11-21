/**
 * 超市本週特價（目前只有 Woolworths）。資料來自管理員匯入的 CSV，不是自動擷取：
 * Woolworths 網站條款禁止以 robot／spider 擷取網站內容。
 * 金額一律為整數 cents；日期為本地 YYYY-MM-DD。
 */
import { parseLocalDate } from './date.js'

export const PROMOTION_TYPE_LABELS = {
  HALF_PRICE: '半價',
  PRICE_DROP: '降價',
  MULTI_BUY: '多件優惠',
  OTHER: '特價',
}

export const SPECIAL_SORTS = [
  { id: 'discount', label: '折扣最多' },
  { id: 'price', label: '價格最低' },
  { id: 'ending', label: '即將截止' },
  { id: 'name', label: '名稱' },
]

/** @param {{ regularPriceCents?: number | null, salePriceCents: number }} special */
export function savingsCents(special) {
  const regular = special.regularPriceCents
  if (typeof regular !== 'number' || regular <= special.salePriceCents) return null
  return regular - special.salePriceCents
}

/** 折扣百分比（四捨五入到整數）；沒有原價時為 null */
export function discountPercent(special) {
  const saved = savingsCents(special)
  if (saved === null || !special.regularPriceCents) return null
  return Math.round((saved / special.regularPriceCents) * 100)
}

/**
 * 半價：標記為 HALF_PRICE，或特價 × 2 ≤ 原價 + 1 分（容許四捨五入，例如 $4.99 → $2.50）。
 * 與後端 SupermarketService.HALF_PRICE_SQL 一致。
 */
export function isHalfPrice(special) {
  if (special.promotionType === 'HALF_PRICE') return true
  const regular = special.regularPriceCents
  return typeof regular === 'number' && special.salePriceCents * 2 <= regular + 1
}

/** @param {{ promotionStart: string, promotionEnd: string }} special @param {string} today */
export function isPromotionActive(special, today) {
  return special.promotionStart <= today && today <= special.promotionEnd
}

/** 距離截止還有幾天（截止當天為 0）；日期無效時為 null */
export function daysUntilEnd(special, today) {
  const end = parseLocalDate(special.promotionEnd)
  const now = parseLocalDate(today)
  if (!end || !now) return null
  return Math.round((end.getTime() - now.getTime()) / 86_400_000)
}

export function promotionEndLabel(special, today) {
  const days = daysUntilEnd(special, today)
  if (days === null) return ''
  if (days < 0) return '特價已結束'
  if (days === 0) return '今天截止'
  if (days === 1) return '明天截止'
  const [, month, day] = special.promotionEnd.split('-')
  return `${Number(month)}/${Number(day)} 截止 · 還剩 ${days} 天`
}

/** 品名旁顯示的規格與品牌，例如「Arnott's · 200g」 */
export function specialSubtitle(special) {
  return [special.brand, special.packageSize].filter(Boolean).join(' · ')
}

/**
 * 加入採買清單的品項（名稱、規格、價格快照）。登入時後端會以資料庫的快照為準；
 * 訪客模式直接用這份資料。
 */
export function specialToShoppingItem(special, id) {
  return {
    id,
    name: special.name,
    quantity: 1,
    purchasedQuantity: 0,
    unit: '件',
    priority: 'NORMAL',
    bucket: 'NOW',
    store: 'WOOLWORTHS',
    note: '',
    promotionId: special.id,
    packageSize: special.packageSize || null,
    estimatedUnitPriceCents: special.salePriceCents,
    actualUnitPriceCents: null,
  }
}

/**
 * 最後匯入狀態的提示文字。沒有資料或匯入失敗時 warning 為 true，讓 UI 提醒資料可能不是最新。
 * @param {{ status: string, finishedAt: string | null } | null | undefined} lastImport
 */
export function describeLastImport(lastImport) {
  if (!lastImport) return { text: '還沒有匯入本週特價資料', warning: true }
  const when = lastImport.finishedAt ? formatImportTime(lastImport.finishedAt) : ''
  if (lastImport.status === 'FAILED')
    return {
      text: `最近一次更新失敗${when ? `（${when}）` : ''}，顯示的是先前的資料`,
      warning: true,
    }
  if (lastImport.status === 'PARTIAL')
    return { text: `最後更新 ${when}（部分資料有誤未匯入）`, warning: true }
  return { text: `最後更新 ${when}`, warning: false }
}

function formatImportTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (/** @type {number} */ value) => String(value).padStart(2, '0')
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 「11/26–12/2」這種活動期間文字；沒有資料時為空字串 */
export function formatPromotionPeriod(validFrom, validTo) {
  if (!validFrom || !validTo) return ''
  const short = (/** @type {string} */ text) => {
    const [, month, day] = text.split('-')
    return `${Number(month)}/${Number(day)}`
  }
  return validFrom === validTo ? short(validFrom) : `${short(validFrom)}–${short(validTo)}`
}

/**
 * 同步狀態（GET /api/supermarkets/specials/status）的顯示文字。
 * stale：沒有成功同步過、超過 8 天沒更新、最近一次失敗，或目前沒有有效特價 → 提醒資料可能過期。
 * @param {{ regionCode: string, lastSuccessAt: string | null, validFrom: string | null, validTo: string | null,
 *   stale: boolean, lastRun: { status: string } | null } | null | undefined} status
 */
export function describeSyncStatus(status) {
  if (!status) return { period: '', updated: '', warning: '', region: '' }
  const period = formatPromotionPeriod(status.validFrom, status.validTo)
  const updated = status.lastSuccessAt ? `更新於 ${formatImportTime(status.lastSuccessAt)}` : ''
  let warning = ''
  if (!status.lastSuccessAt) warning = '還沒有本週特價資料'
  else if (status.lastRun?.status === 'FAILED') warning = '最近一次更新失敗，價格可能已過期'
  else if (status.stale) warning = '資料超過一週沒更新，價格可能已過期'
  return { period, updated, warning, region: status.regionCode }
}
