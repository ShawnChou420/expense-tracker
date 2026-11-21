import { apiRequest } from '../services/authSession.js'

/**
 * 超市本週特價（公開資料，訪客與會員共用；資料由管理員以 CSV 匯入）。
 * @typedef {{ keyword?: string, category?: string, halfPriceOnly?: boolean, page?: number, size?: number, sort?: string }} SpecialsQuery
 */
function toQuery(params) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export const supermarketRepository = {
  /** @param {SpecialsQuery} query */
  specials: (query = {}) => apiRequest(`/supermarkets/specials${toQuery(query)}`),
  categories: () => apiRequest('/supermarkets/categories'),
  /** 最後同步時間、目前特價有效日期、是否可能過期 */
  status: () => apiRequest('/supermarkets/specials/status'),
  /** 管理員：上傳 CSV 同步（dryRun 為 true 時只預覽不寫入） */
  importCsv: (
    /** @type {{ csv: string, regionCode?: string, dryRun: boolean, sourceReference?: string }} */ body,
  ) => apiRequest('/admin/supermarkets/sync', { method: 'POST', body }),
  /** 管理員：立即從設定的資料源網址同步（SPECIALS_FEED_URL） */
  syncFeed: () => apiRequest('/admin/supermarkets/sync', { method: 'POST', body: {} }),
  importRuns: () => apiRequest('/admin/supermarkets/sync-logs'),
}
