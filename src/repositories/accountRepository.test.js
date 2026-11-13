import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  token: /** @type {{ value: string | null }} */ ({ value: null }),
  request: vi.fn(),
}))
vi.mock('../services/authSession.js', () => ({
  authToken: auth.token,
  apiRequest: auth.request,
}))

import { accountRepository } from './accountRepository.js'

describe('會員資料 repository', () => {
  beforeEach(() => {
    auth.token.value = null
    auth.request.mockReset()
  })

  it('訪客模式不呼叫 API', async () => {
    await expect(accountRepository.get()).rejects.toThrow('請先登入')
    await expect(accountRepository.changePassword('a', 'b')).rejects.toThrow('請先登入')
    await expect(accountRepository.deleteAccount('a')).rejects.toThrow('請先登入')
    expect(auth.request).not.toHaveBeenCalled()
  })

  it('請求不帶 user ID，顯示名稱先去除空白', async () => {
    auth.token.value = 'test-token'
    auth.request.mockResolvedValue({})
    await accountRepository.saveNickname('  小周 ')
    expect(auth.request).toHaveBeenCalledWith('/account/profile', {
      method: 'PUT',
      body: { nickname: '小周' },
    })
    await accountRepository.changePassword('Old#Pass1', 'New#Pass1')
    expect(auth.request).toHaveBeenLastCalledWith('/account/password', {
      method: 'POST',
      body: { currentPassword: 'Old#Pass1', newPassword: 'New#Pass1' },
    })
    await accountRepository.deleteAccount('Old#Pass1')
    expect(auth.request).toHaveBeenLastCalledWith('/account/delete', {
      method: 'POST',
      body: { password: 'Old#Pass1' },
    })
  })
})
