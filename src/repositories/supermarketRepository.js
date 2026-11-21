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
  /** 管理員：匯入 CSV（dryRun 預設 true，只預覽不寫入） */
  importCsv: (
    /** @type {{ csv: string, regionCode?: string, dryRun: boolean, sourceReference?: string }} */ body,
  ) => apiRequest('/admin/supermarkets/import', { method: 'POST', body }),
  importRuns: () => apiRequest('/admin/supermarkets/import-runs'),
}
