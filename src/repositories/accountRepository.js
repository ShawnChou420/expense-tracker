import { apiRequest, authToken } from '../services/authSession.js'
import { normalizeNickname } from '../domain/account.js'

// 會員資料只存在後端；訪客模式沒有帳號資料，呼叫時直接拒絕。
function requireMember() {
  if (!authToken.value) throw new Error('請先登入')
}

export const accountRepository = {
  /** @returns {Promise<{ email: string, nickname: string | null, createdAt: string | null }>} */
  async get() {
    requireMember()
    return apiRequest('/account')
  },
  /** @param {string} nickname 空字串代表清除 */
  async saveNickname(nickname) {
    requireMember()
    return apiRequest('/account/profile', {
      method: 'PUT',
      body: { nickname: normalizeNickname(nickname) },
    })
  },
  /** 成功後後端會撤銷此會員其他裝置的登入，目前這個 token 保留。 */
  async changePassword(currentPassword, newPassword) {
    requireMember()
    return apiRequest('/account/password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    })
  },
}
