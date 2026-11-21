import { describe, expect, it } from 'vitest'
import { normalizeLocale, resolveInitialLocale } from './locale.js'

describe('normalizeLocale', () => {
  it('對應支援語系與常見變體', () => {
    expect(normalizeLocale('zh-TW')).toBe('zh-TW')
    expect(normalizeLocale('zh-Hant-HK')).toBe('zh-TW')
    expect(normalizeLocale('zh_tw')).toBe('zh-TW')
    expect(normalizeLocale('en-US')).toBe('en-AU')
    expect(normalizeLocale('en')).toBe('en-AU')
    expect(normalizeLocale('ja-JP')).toBe('ja')
    expect(normalizeLocale('ko-KR')).toBe('ko')
  })

  it('不支援的語系回傳 null', () => {
    expect(normalizeLocale('zh-CN')).toBeNull()
    expect(normalizeLocale('fr-FR')).toBeNull()
    expect(normalizeLocale('')).toBeNull()
    expect(normalizeLocale(undefined)).toBeNull()
  })
})

describe('resolveInitialLocale', () => {
  it('已儲存的選擇優先於瀏覽器語言', () => {
    expect(resolveInitialLocale({ saved: 'ko', browserLanguages: ['ja-JP'] })).toBe('ko')
  })

  it('沒有儲存時採用第一個支援的瀏覽器語言', () => {
    expect(resolveInitialLocale({ browserLanguages: ['fr-FR', 'ja-JP', 'en-AU'] })).toBe('ja')
  })

  it('儲存值無效或瀏覽器語言都不支援時用繁體中文', () => {
    expect(resolveInitialLocale({ saved: 'xx', browserLanguages: ['fr-FR', 'zh-CN'] })).toBe('zh-TW')
    expect(resolveInitialLocale()).toBe('zh-TW')
  })
})
