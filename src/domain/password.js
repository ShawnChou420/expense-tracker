// 註冊密碼規則，必須與後端 AuthController.meetsPasswordPolicy 一致。
// 登入時不套用，避免規則變更前註冊的帳號無法登入。

export const PASSWORD_RULE_TEXT = '密碼須為 8 個字元以上，且包含大寫字母、小寫字母、數字與特殊符號'

export const PASSWORD_MAX_LENGTH = 128

/** 各項條件的檢查結果，供註冊畫面逐項顯示。 */
export function passwordChecks(password = '') {
  return [
    { key: 'length', label: '8 個字元以上', ok: password.length >= 8 },
    { key: 'upper', label: '大寫字母', ok: /[A-Z]/.test(password) },
    { key: 'lower', label: '小寫字母', ok: /[a-z]/.test(password) },
    { key: 'digit', label: '數字', ok: /[0-9]/.test(password) },
    // 特殊符號：英數字與空白以外的任何字元
    { key: 'symbol', label: '特殊符號', ok: /[^A-Za-z0-9\s]/.test(password) },
  ]
}

/** 符合註冊規則時回傳空字串，否則回傳要顯示的錯誤訊息。 */
export function passwordPolicyError(password = '') {
  if (password.length > PASSWORD_MAX_LENGTH) return `密碼最多 ${PASSWORD_MAX_LENGTH} 個字元`
  return passwordChecks(password).every((check) => check.ok) ? '' : PASSWORD_RULE_TEXT
}
