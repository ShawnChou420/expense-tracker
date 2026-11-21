/**
 * 首頁自訂（UI 2.0 Sprint 2）：兩種預設模式、模組開關與上下排序。
 * 只決定「畫面顯示什麼、什麼順序」，隱藏模組不會刪除任何資料。
 * 儲存格式只有模組 ID 與是否顯示（不存顯示文字），未知的 ID 會被忽略，新加入的模組依模式預設補在後面。
 */

/** @typedef {'PAY' | 'LIFE'} DashboardMode */
/** @typedef {{ id: string, visible: boolean }} DashboardModule */
/** @typedef {{ mode: DashboardMode, modules: DashboardModule[] }} DashboardLayout */
/** @typedef {{ hasVisa?: boolean }} DashboardContext hasVisa：集簽進度是否適用（選了「目前不集簽」時為 false） */

/** 全部模組（順序即「其餘模組」的預設順序） */
export const DASHBOARD_MODULES = [
  { id: 'weekly-pay', label: '本週預估薪資' },
  { id: 'latest-payslip', label: '最近一期薪資單' },
  { id: 'today-shift', label: '今日班表' },
  { id: 'fuel-prices', label: '附近油價' },
  { id: 'savings-goal', label: '存款目標' },
  { id: 'today-tasks', label: '今日待辦' },
  { id: 'daily-quote', label: '每日小語' },
  { id: 'mood-journal', label: '心情與備註' },
  { id: 'quick-actions', label: '快捷操作' },
  { id: 'weekly-balance', label: '本週收支' },
  { id: 'pending-fares', label: '車資待收' },
  { id: 'visa-progress', label: '集簽進度' },
  { id: 'tax-progress', label: '年度稅務追蹤' },
  { id: 'advanced', label: '進階統計' },
]

export const DASHBOARD_MODES = [
  { id: 'PAY', label: '薪資優先' },
  { id: 'LIFE', label: '生活優先' },
]

/**
 * 各模式預設顯示的模組與順序；不在清單裡的模組預設隱藏。
 * 薪資優先只放「班與班之間看一眼」需要的模組；待辦、每日小語可在自訂首頁打開（生活優先預設就有）。
 */
const PRESETS = {
  PAY: [
    'weekly-pay',
    'today-shift',
    'quick-actions',
    'latest-payslip',
    'savings-goal',
    'fuel-prices',
    'visa-progress',
    'advanced',
  ],
  LIFE: [
    'today-shift',
    'today-tasks',
    'daily-quote',
    'mood-journal',
    'weekly-pay',
    'fuel-prices',
    'quick-actions',
    'visa-progress',
    'advanced',
  ],
}

const KNOWN = new Set(DASHBOARD_MODULES.map((module) => module.id))

/** @param {unknown} mode @returns {DashboardMode} */
function asMode(mode) {
  return mode === 'LIFE' ? 'LIFE' : 'PAY'
}

/**
 * 某模式的預設版面：預設模組在前（依模式順序），其餘模組隱藏、依全部模組的順序排在後面。
 * 集簽進度在版面上預設開啟，選了「目前不集簽」的使用者不會看到（見 isModuleAvailable）。
 * @param {DashboardMode} mode
 * @returns {DashboardLayout}
 */
export function getDefaultLayout(mode) {
  const preset = PRESETS[asMode(mode)]
  const rest = DASHBOARD_MODULES.map((module) => module.id).filter((id) => !preset.includes(id))
  return {
    mode: asMode(mode),
    modules: [
      ...preset.map((id) => ({ id, visible: true })),
      ...rest.map((id) => ({ id, visible: false })),
    ],
  }
}

/**
 * 把儲存的版面整理成可用的版面：沒有設定就用薪資優先預設；忽略未知、重複的模組；
 * 之後新增的模組依該模式的預設補在最後。
 * @param {unknown} saved
 * @returns {DashboardLayout}
 */
export function normalizeLayout(saved) {
  const raw = /** @type {{ mode?: unknown, modules?: unknown } | null} */ (
    saved && typeof saved === 'object' ? saved : null
  )
  if (!raw || !Array.isArray(raw.modules)) return getDefaultLayout('PAY')
  const mode = asMode(raw.mode)
  const seen = new Set()
  /** @type {DashboardModule[]} */
  const modules = []
  for (const item of raw.modules) {
    const id = item && typeof item === 'object' ? item.id : null
    if (typeof id !== 'string' || !KNOWN.has(id) || seen.has(id)) continue
    seen.add(id)
    modules.push({ id, visible: item.visible === true })
  }
  const defaults = getDefaultLayout(mode)
  for (const module of defaults.modules) if (!seen.has(module.id)) modules.push({ ...module })
  return { mode, modules }
}

/**
 * 目前要顯示的模組 ID（依順序）。選了「目前不集簽」的使用者不顯示集簽進度。
 * @param {DashboardLayout} layout
 * @param {DashboardContext} [context]
 */
export function getVisibleModuleIds(layout, context = {}) {
  return layout.modules
    .filter((module) => module.visible && isModuleAvailable(module.id, context))
    .map((module) => module.id)
}

/**
 * 實際顯示順序：今天有班時，今日班表移到最前面（不改使用者儲存的版面）。
 * @param {string[]} visibleIds getVisibleModuleIds 的結果
 * @param {{ hasShiftToday?: boolean }} [today]
 * @returns {string[]}
 */
export function getDisplayOrder(visibleIds, today = {}) {
  if (!today.hasShiftToday || !visibleIds.includes('today-shift')) return [...visibleIds]
  return ['today-shift', ...visibleIds.filter((id) => id !== 'today-shift')]
}

/**
 * 固定提示卡（薪資單入口、下一步）的位置：放在一般模組之後、進階統計之前，不再擠在首屏。
 * 回傳 CSS order 用的基準值（模組 order 為 index × 10）。
 * @param {string[]} orderedIds getDisplayOrder 的結果
 */
export function getPromptOrder(orderedIds) {
  const advanced = orderedIds.indexOf('advanced')
  const slot = advanced < 0 ? orderedIds.length : advanced
  return slot * 10 - 5
}

/**
 * 在自訂清單中是否列出（不集簽時不列集簽進度）
 * @param {string} id
 * @param {DashboardContext} [context]
 */
export function isModuleAvailable(id, context = {}) {
  return id !== 'visa-progress' || Boolean(context.hasVisa)
}

/**
 * @param {DashboardLayout} layout
 * @param {string} id
 * @param {boolean} visible
 * @returns {DashboardLayout}
 */
export function setModuleVisible(layout, id, visible) {
  return {
    ...layout,
    modules: layout.modules.map((module) => (module.id === id ? { ...module, visible } : module)),
  }
}

/**
 * 上移（-1）或下移（+1）；在可見的清單中移動，跳過不適用的模組（例如沒有集簽時的集簽進度）。
 * @param {DashboardLayout} layout
 * @param {string} id
 * @param {-1 | 1} direction
 * @param {DashboardContext} [context]
 * @returns {DashboardLayout}
 */
export function moveModule(layout, id, direction, context = {}) {
  const modules = [...layout.modules]
  const from = modules.findIndex((module) => module.id === id)
  if (from < 0) return layout
  let to = from + direction
  while (to >= 0 && to < modules.length && !isModuleAvailable(modules[to].id, context))
    to += direction
  if (to < 0 || to >= modules.length) return layout
  const [moved] = modules.splice(from, 1)
  modules.splice(to, 0, moved)
  return { ...layout, modules }
}

/** 兩份版面是否相同（用來判斷要不要儲存） */
export function isSameLayout(/** @type {DashboardLayout} */ a, /** @type {DashboardLayout} */ b) {
  return JSON.stringify(a) === JSON.stringify(b)
}
