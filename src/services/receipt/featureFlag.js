// 收據掃描在 Sprint 1–2 還是 PoC：merge 到 main 會自動部署，所以入口先隱藏。
// 開發環境一律顯示；正式環境要在網址加上 ?receipt=1 才會出現（同一個分頁內記住）。
const STORAGE_KEY = 'receipt-scan-preview'

export function isReceiptScanEnabled() {
  if (import.meta.env.DEV) return true
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('receipt') === '1') sessionStorage.setItem(STORAGE_KEY, '1')
    if (params.get('receipt') === '0') sessionStorage.removeItem(STORAGE_KEY)
    return sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}
