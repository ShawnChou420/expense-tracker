// 把 domain 驗證或後端回傳的繁中錯誤訊息轉成目前語系。
// domain 與後端仍以繁中為唯一來源（既有測試不變）；這裡用 errors.* 的繁中原文反查 key。
// 查不到的訊息原樣顯示，不會丟失資訊。
import zhTW from '../locales/zh-TW.json'
import { t } from './index.js'

const exact = new Map(
  Object.entries(zhTW.errors)
    .filter(([, text]) => !text.includes('{'))
    .map(([key, text]) => [text, `errors.${key}`]),
)

const patterns = [
  { regex: /^密碼最多 (\d+) 個字元$/, key: 'errors.passwordTooLong', params: (m) => ({ max: m[1] }) },
  { regex: /^顯示名稱最多 (\d+) 個字$/, key: 'errors.nicknameTooLong', params: (m) => ({ max: m[1] }) },
  { regex: /^操作失敗（(\d+)）$/, key: 'errors.httpFailed', params: (m) => ({ status: m[1] }) },
]

/** @param {unknown} message */
export function localizeMessage(message) {
  if (typeof message !== 'string' || !message) return message
  const key = exact.get(message)
  if (key) return t(key)
  for (const pattern of patterns) {
    const match = pattern.regex.exec(message)
    if (match) return t(pattern.key, pattern.params(match))
  }
  return message
}
