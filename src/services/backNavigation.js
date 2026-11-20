/**
 * 返回鍵（瀏覽器返回、Android 實體返回鍵、iOS 邊緣滑動返回）的行為，讓它像原生 App：
 *
 * 1. 有彈窗開著 → 關閉最上層的彈窗
 * 2. 在子頁面（例如採買清單）→ 回到上一層
 * 3. 在首頁以外的分頁 → 回到首頁
 * 4. 已經在首頁、沒有彈窗 → 照常離開
 *
 * 做法：只要有「可以返回」的東西，就在瀏覽器歷史上方保持「一筆」守門紀錄。使用者按返回時，
 * 瀏覽器移除這筆紀錄並觸發 popstate，我們處理一件事；如果還有可以返回的東西，再補回守門紀錄。
 * 關閉彈窗時不主動操作歷史，避免非同步的 history.back() 和新開的彈窗互相干擾。
 *
 * Capacitor Android 在沒有 @capacitor/app 外掛時，返回鍵會讓 WebView 回上一頁，所以同樣適用。
 */

const GUARD = 'expense-tracker-back'
/** @type {Array<{ id: number, close: () => void | Promise<void> }>} */
const overlays = []
let nextId = 1
/** @type {() => boolean} 由 App 提供：處理分頁返回，回傳 true 表示有處理 */
let pageBack = () => false
/** @type {() => boolean} 由 App 提供：目前是否在可以返回的頁面（非首頁或子頁面） */
let pageCanGoBack = () => false
let installed = false
/** 推入守門紀錄時，下面那一筆的網址；按返回回到這個網址才是「離開守門紀錄」 */
let guardBaseUrl = /** @type {string | null} */ (null)

const hasWindow = typeof window !== 'undefined' && typeof history !== 'undefined'

function guardActive() {
  return Boolean(history.state && history.state[GUARD])
}

/** 有可以返回的東西時，確保歷史上有一筆守門紀錄 */
export function ensureBackGuard() {
  if (!hasWindow || guardActive()) return
  if (!overlays.length && !pageCanGoBack()) return
  guardBaseUrl = location.href
  history.pushState({ ...(history.state || {}), [GUARD]: true }, '')
}

function onPopState() {
  // 回到（或前進到）守門紀錄本身：不用處理
  if (guardActive()) return
  // 不是離開我們的守門紀錄（例如網址 hash 改成 #/admin、或沒有守門時的返回）：交給瀏覽器
  if (guardBaseUrl === null || location.href !== guardBaseUrl) {
    guardBaseUrl = null
    return
  }
  guardBaseUrl = null
  // Vant 的確認視窗（showConfirmDialog）會自己在 popstate 時關閉，這次就只關它
  const dialogOpen = [...document.querySelectorAll('.van-dialog')].some(
    (el) => /** @type {HTMLElement} */ (el).offsetParent !== null,
  )
  if (dialogOpen) {
    ensureBackGuard()
    return
  }
  const top = overlays.pop()
  if (top) {
    top.close()
  } else if (!pageBack()) {
    // 沒有任何東西可以返回：繼續往前一頁（離開 App），不吃掉使用者的返回
    history.back()
    return
  }
  // 等關閉、切頁的狀態更新後，若還有可以返回的東西，再補回守門紀錄
  setTimeout(ensureBackGuard, 0)
}

/**
 * @param {{ back: () => boolean, canGoBack: () => boolean }} handlers
 */
export function registerPageBack({ back, canGoBack }) {
  pageBack = back
  pageCanGoBack = canGoBack
}

/** 所有 van-popup（包含 ActionSheet、Picker 外層）開關時自動登記，不需要每個元件各自處理 */
const popupMixin = {
  mounted() {
    // @ts-ignore Vue options API this
    const vm = this
    if (vm.$options?.name !== 'van-popup') return
    vm.$watch(
      () => vm.$props.show,
      (/** @type {boolean} */ show) => {
        if (show) {
          const id = nextId++
          vm.__backEntryId = id
          const entry = {
            id,
            // 彈窗有 before-close（例如當天面板的未儲存提醒）時先問；取消就把它放回去
            close: async () => {
              const beforeClose = vm.$props.beforeClose
              if (beforeClose && !(await beforeClose())) {
                if (vm.$props.show && !overlays.includes(entry)) overlays.push(entry)
                ensureBackGuard()
                return
              }
              vm.$emit('update:show', false)
            },
          }
          overlays.push(entry)
          ensureBackGuard()
        } else if (vm.__backEntryId) {
          const index = overlays.findIndex((entry) => entry.id === vm.__backEntryId)
          if (index >= 0) overlays.splice(index, 1)
          vm.__backEntryId = null
        }
      },
      { immediate: true },
    )
  },
  beforeUnmount() {
    // @ts-ignore Vue options API this
    const vm = this
    if (!vm.__backEntryId) return
    const index = overlays.findIndex((entry) => entry.id === vm.__backEntryId)
    if (index >= 0) overlays.splice(index, 1)
  },
}

/** @param {import('vue').App} app */
export function installBackNavigation(app) {
  if (!hasWindow || installed) return
  installed = true
  // 重新整理後歷史上可能還留著上次的守門紀錄；拿掉旗標，避免第一次返回沒有反應
  if (guardActive()) {
    const { [GUARD]: _stale, ...rest } = history.state
    history.replaceState(Object.keys(rest).length ? rest : null, '')
  }
  app.mixin(popupMixin)
  window.addEventListener('popstate', onPopState)
}
