import { apiRequest } from '../services/authSession.js'

/** 把查詢條件轉成 URL 參數（空值不送） @param {Record<string, unknown>} params */
export function toQuery(params) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  }
  const text = query.toString()
  return text ? `?${text}` : ''
}

// 管理後台 API；權限一律由後端驗證（不是 SUPER_ADMIN 會收到 403）
export const adminRepository = {
  overview: () => apiRequest('/admin/overview'),
  /** @param {{ q?: string, status?: string, page?: number, size?: number }} params */
  users: (params = {}) => apiRequest(`/admin/users${toQuery(params)}`),
  /** @param {number} seq */
  user: (seq) => apiRequest(`/admin/users/${encodeURIComponent(seq)}`),
  /** @param {number} seq @param {number} [page] */
  userEvents: (seq, page = 0) =>
    apiRequest(`/admin/users/${encodeURIComponent(seq)}/events${toQuery({ page })}`),
  /** @param {{ from?: string, to?: string, userSeq?: string | number, type?: string, status?: string, category?: string, page?: number }} params */
  events: (params = {}) => apiRequest(`/admin/events${toQuery(params)}`),
  /** @param {{ targetSeq?: number, page?: number }} params */
  audit: (params = {}) => apiRequest(`/admin/audit${toQuery(params)}`),
  /** @param {number} seq @param {{ nickname: string | null, reason: string }} body */
  updateProfile: (seq, body) =>
    apiRequest(`/admin/users/${encodeURIComponent(seq)}/profile`, { method: 'PUT', body }),
  /** @param {number} seq @param {boolean} active @param {{ reason: string, password: string }} body */
  setActive: (seq, active, body) =>
    apiRequest(`/admin/users/${encodeURIComponent(seq)}/${active ? 'enable' : 'disable'}`, {
      method: 'POST',
      body,
    }),
  /** @param {number} seq @param {{ superAdmin: boolean, reason: string, password: string }} body */
  setRole: (seq, body) =>
    apiRequest(`/admin/users/${encodeURIComponent(seq)}/role`, { method: 'PUT', body }),
  /** @param {number} seq @param {{ reason: string, password: string, confirmEmail: string }} body */
  remove: (seq, body) =>
    apiRequest(`/admin/users/${encodeURIComponent(seq)}/delete`, { method: 'POST', body }),
}
