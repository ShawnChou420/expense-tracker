// 首頁「隱藏金額」：在公共場所或分享畫面時把金額換成 •••。
// 只是這台裝置的顯示偏好，存在 localStorage；讀寫失敗（私密模式等）時就只在這次開啟期間有效。
import { ref, watch } from 'vue'

const STORAGE_KEY = 'expense-tracker.hide-amounts'

function readSaved() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export const amountsHidden = ref(readSaved())

watch(amountsHidden, (hidden) => {
  try {
    if (hidden) globalThis.localStorage?.setItem(STORAGE_KEY, '1')
    else globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // 無法儲存時忽略，畫面仍依目前狀態顯示
  }
})

export function toggleAmountsHidden() {
  amountsHidden.value = !amountsHidden.value
}
