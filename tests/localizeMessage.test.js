import { afterEach, describe, expect, it } from 'vitest'
import { applyLocale } from '../src/i18n/index.js'
import { localizeMessage } from '../src/i18n/messages.js'
import { nicknameError, passwordChangeError } from '../src/domain/account.js'

afterEach(() => applyLocale('zh-TW', { persist: false }))

describe('localizeMessage', () => {
  it('繁中維持原文', () => {
    applyLocale('zh-TW', { persist: false })
    expect(localizeMessage('請先登入')).toBe('請先登入')
  })

  it('domain 驗證訊息會轉成目前語系', () => {
    applyLocale('en-AU', { persist: false })
    expect(localizeMessage(passwordChangeError({}))).toBe('Enter your current password')
    expect(localizeMessage(nicknameError('x'.repeat(100)))).toMatch(/^Display names can be at most \d+ characters$/)
    expect(localizeMessage('操作失敗（503）')).toBe('Request failed (503)')
  })

  it('不認得的訊息原樣回傳', () => {
    applyLocale('ja', { persist: false })
    expect(localizeMessage('某個未知錯誤')).toBe('某個未知錯誤')
    expect(localizeMessage('')).toBe('')
  })
})
