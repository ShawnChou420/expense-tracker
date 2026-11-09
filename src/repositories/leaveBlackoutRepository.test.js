import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  token: /** @type {{ value: string | null }} */ ({ value: null }),
  request: vi.fn(),
}))
vi.mock('../services/authSession.js', () => ({
  authToken: auth.token,
  apiRequest: auth.request,
}))

import { leaveBlackoutRepository } from './leaveBlackoutRepository.js'

describe('leave blackout repository', () => {
  beforeEach(() => {
    auth.token.value = null
    auth.request.mockReset()
  })

  it('keeps guest announcements separate from member API data', async () => {
    await leaveBlackoutRepository.save({ date: '2026-10-07', reason: '訪客標記' })
    auth.token.value = 'test-token'
    auth.request.mockResolvedValueOnce([{ date: '2026-10-08', reason: '會員標記' }])
    expect(await leaveBlackoutRepository.list()).toEqual([
      { date: '2026-10-08', reason: '會員標記' },
    ])
    auth.token.value = null
    expect(await leaveBlackoutRepository.list()).toContainEqual({
      date: '2026-10-07',
      reason: '訪客標記',
    })
  })

  it('does not change guest data when a member API save fails', async () => {
    auth.token.value = 'test-token'
    auth.request.mockRejectedValueOnce(new Error('server error'))
    await expect(leaveBlackoutRepository.save({ date: '2026-10-09', reason: '' })).rejects.toThrow()
    auth.token.value = null
    expect(await leaveBlackoutRepository.list()).not.toContainEqual({
      date: '2026-10-09',
      reason: '',
    })
  })
})
