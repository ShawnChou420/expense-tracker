<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import * as XLSX from 'xlsx'
import TripTracker from './components/TripTracker.vue'
import ExpenseTracker from './components/ExpenseTracker.vue'
import ShoppingList from './components/ShoppingList.vue'
import DashboardPage from './components/DashboardPage.vue'
import AuthPanel from './components/AuthPanel.vue'
import { authEmail, authToken, signOut, clearSession, apiRequest } from './services/authSession.js'
import { useWorkRecordsPersistence } from './composables/useWorkRecordsPersistence.js'
import { getGuestLedgerSnapshot, notifyLedgerChanged, passengerRepository, tripRepository, expenseRepository } from './repositories/appRepositories.js'
import { dashboardSettingsRepository, getGuestDashboardSettings } from './repositories/inMemoryDashboardSettingsRepository.js'
import { leaveBlackoutRepository, getGuestLeaveBlackouts } from './repositories/leaveBlackoutRepository.js'
import { shoppingRepository, getGuestShoppingItems, notifyShoppingChanged } from './repositories/shoppingRepository.js'
import { removeLeaveBlackout, upsertLeaveBlackout } from './domain/leaveBlackouts.js'
import { formatCalendarAmount } from './utils/calendarMoney.js'
import { formatLocalDate, getCalendarDateRange, getMonthRange } from './domain/date.js'
import { applyPrepTime, PREP_MINUTES } from './domain/prepTime.js'
import { useShiftCalculator } from './composables/useShiftCalculator.js'
import {
  formatHours,
  formatRate,
  roundTo,
} from './utils/number.js'
import {
  getTodayDate,
  isValidTime,
  normalizeTimeInput,
  sanitizeTimeInput,
} from './utils/time.js'
import {
  getNswPublicHolidayLabel,
  getNswPublicHolidayShortLabel,
} from './utils/holidays.js'
import {
  createWorkRecord,
  normalizeWorkRecord,
} from './utils/workRecord.js'
import { clearRecordsInMonth, ensureUniqueRecordIds, getMissingScheduleDates, nextRecordId, recordsInMonth, upsertRecordForDate } from './utils/scheduleRecords.js'
import { showConfirmDialog, showToast } from 'vant'

// --- 💰 智慧幣別格式化工具 ---

// 1. 給明細列表用的（自動拔掉台幣/越南盾的小數點，並加上千分位）
const formatDisplayMoney = (amount) => {
  const val = Number(amount);
  if (isNaN(val)) return '0.00';
  // 判斷當前幣別是否為「不需要小數點」的國家
  const noDecimals = ['TWD', 'VND', 'KRW', 'JPY', 'THB'].includes(currentCurrency.value);
  return val.toLocaleString('en-US', {
    minimumFractionDigits: noDecimals ? 0 : 2,
    maximumFractionDigits: noDecimals ? 0 : 2
  });
};

// --- 狀態切換與清潔日 ---
const shiftType = ref('normal') // normal: 正常, leave: 請假
const isCleaningDay = ref(false)
const remark = ref('') // ✨ 新增：當日自訂備註狀態

// --- 控制時間選擇器彈出視窗的開關 ---
const showStartTimePicker = ref(false)
const showEndTimePicker = ref(false)

// --- 過濾器，讓分鐘只顯示 5 的倍數 ---
const filterTime = (type, options) => {
  if (type === 'minute') {
    return options.filter((option) => Number(option.value) % 5 === 0)
  }
  return options
}

const onStartTimeConfirm = ({ selectedValues }) => {
  startTime.value = selectedValues.join(':')
  showStartTimePicker.value = false
}

const onEndTimeConfirm = ({ selectedValues }) => {
  endTime.value = selectedValues.join(':')
  showEndTimePicker.value = false
}

// --- 幣別與匯率相關狀態 ---
const currentCurrency = ref('AUD')
const showCurrencyPicker = ref(false)
const exchangeRates = ref({ AUD: 1 })

const currencyColumns = [
  { text: '🇦🇺 澳幣 (AUD)', value: 'AUD' },
  { text: '🇹🇼 台幣 (TWD)', value: 'TWD' },
  { text: '🇳🇿 紐西蘭幣 (NZD)', value: 'NZD' },
  { text: '🇨🇳 人民幣 (CNY)', value: 'CNY' },
  { text: '🇰🇷 韓元 (KRW)', value: 'KRW' },
  { text: '🇹🇭 泰銖 (THB)', value: 'THB' },
  { text: '🇻🇳 越南盾 (VND)', value: 'VND' },
  { text: '🇺🇸 美金 (USD)', value: 'USD' },
  { text: '🇨🇦 加幣 (CAD)', value: 'CAD' }
]

const currencySymbol = computed(() => {
  const symbols = { AUD: '$', NZD: 'NZ$', TWD: 'NT$', CNY: '¥', KRW: '₩', THB: '฿', VND: '₫', USD: 'US$', CAD: 'CA$' }
  return symbols[currentCurrency.value] || '$'
})

const currencyFlag = computed(() => {
  const flags = { AUD: '🇦🇺', NZD: '🇳🇿', TWD: '🇹🇼', CNY: '🇨🇳', KRW: '🇰🇷', THB: '🇹🇭', VND: '🇻🇳', USD: '🇺🇸', CAD: '🇨🇦' }
  return flags[currentCurrency.value] || '🪙'
})

const currentExchangeRate = computed(() => {
  return exchangeRates.value[currentCurrency.value] || 1
})

const fetchExchangeRates = async () => {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/AUD')
    const data = await res.json()
    if (data && data.rates) {
      exchangeRates.value = data.rates
    }
  } catch (error) {
    console.error('無法取得匯率資料', error)
  }
}

onMounted(() => {
  fetchExchangeRates()
})

const onCurrencyConfirm = ({ selectedOptions }) => {
  currentCurrency.value = selectedOptions[0].value
  showCurrencyPicker.value = false
}

// --- 日期與時間基礎變數 ---
const workDate = ref(getTodayDate())
const startTime = ref('23:45')
const endTime = ref('06:00')
const dataManagementSections = ref([])
const scheduleSections = ref([])
const expandedRecordId = ref('')
const workInputSection = ref(null)
const records = ref([])
const leaveBlackouts = ref([])
const showBlackoutEditor = ref(false)
const blackoutReason = ref('')
const blackoutSaving = ref(false)
const authPanelOpen = ref(false)
const workPersistence = useWorkRecordsPersistence(records, (error) => showToast(error.message))
let switchingAccount = false
let rateWritePaused = false
let guestRates = { baseRate: 26.74, ppeAllowance: 5, withholdingTaxRate: 0.12 }
let guestCurrency = 'AUD'
async function restoreGuestSettings() {
  rateWritePaused = true
  baseRate.value = guestRates.baseRate
  ppeAllowance.value = guestRates.ppeAllowance
  withholdingTaxRate.value = guestRates.withholdingTaxRate
  currentCurrency.value = guestCurrency
  await nextTick()
  rateWritePaused = false
}

async function handleSignedIn() {
  switchingAccount = true
  rateWritePaused = true
  try {
    guestRates = {
      baseRate: baseRate.value,
      ppeAllowance: ppeAllowance.value,
      withholdingTaxRate: withholdingTaxRate.value,
    }
    guestCurrency = currentCurrency.value
    const guestWork = workPersistence.getGuestRecords()
    const guestLedger = await getGuestLedgerSnapshot()
    const guestSettings = getGuestDashboardSettings()
    const guestBlackouts = getGuestLeaveBlackouts()
    const guestShopping = getGuestShoppingItems()
    const [memberWork, memberPassengers, memberTrips, memberExpenses, existingRates, memberSettings, memberBlackouts] = await Promise.all([
      apiRequest('/work-records'), passengerRepository.list(), tripRepository.list(), expenseRepository.list(),
      apiRequest('/salary-rates'), apiRequest('/dashboard-settings'), leaveBlackoutRepository.list(),
    ])
    let memberShopping = null
    try { memberShopping = await shoppingRepository.list() } catch { showToast('採買清單暫時無法讀取，請更新 Java 後端') }
    const hasGuestData = guestWork.length || guestLedger.passengers.length || guestLedger.trips.length ||
      guestLedger.expenses.length || guestSettings.savingGoal || guestSettings.workDayTarget || guestBlackouts.length || (memberShopping && guestShopping.length)
    const memberHasData = memberWork.length || memberPassengers.length || memberTrips.length || memberExpenses.length || memberBlackouts.length || memberShopping?.length
    if (hasGuestData) {
      try {
        await showConfirmDialog({
          title: '匯入本次訪客紀錄？',
          message: memberHasData
            ? '此會員已有紀錄。相同 ID 或同日期禁休會略過，但同一天不同 ID 的班表仍可能重複；請確認後再匯入。'
            : '將本次訪客的班表、禁休公告、採買清單、乘客、行程、支出與目標匯入此會員。',
          confirmButtonText: '匯入',
        })
        const missing = (guestItems, memberItems) => guestItems.filter(
          (item) => !memberItems.some((member) => String(member.id) === String(item.id)),
        )
        for (const passenger of missing(guestLedger.passengers, memberPassengers)) await passengerRepository.save(passenger)
        for (const trip of missing(guestLedger.trips, memberTrips)) await tripRepository.save(trip)
        for (const expense of missing(guestLedger.expenses, memberExpenses)) await expenseRepository.save(expense)
        for (const record of missing(guestWork, memberWork)) await apiRequest(`/work-records/${encodeURIComponent(record.id)}`, { method: 'PUT', body: record })
        for (const blackout of guestBlackouts.filter((item) =>
          !memberBlackouts.some((member) => member.date === item.date))) {
          await leaveBlackoutRepository.save(blackout)
        }
        if (memberShopping) {
          for (const item of guestShopping.filter((guest) =>
            !memberShopping.some((member) => member.id === guest.id))) {
            await shoppingRepository.save(item)
          }
        }
        if (guestSettings.savingGoal && !memberSettings.savingGoal) await dashboardSettingsRepository.saveSavingGoal(guestSettings.savingGoal)
        if (guestSettings.workDayTarget && !memberSettings.workDayTarget) await dashboardSettingsRepository.saveWorkDayTarget(guestSettings.workDayTarget)
        if (!Object.keys(existingRates).length) await apiRequest('/salary-rates', { method: 'PUT', body: guestRates })
      } catch (error) {
        if (error !== 'cancel') showToast(error.message || '匯入未完成，請檢查資料後重試')
      }
    }
    await workPersistence.loadMemberRecords()
    leaveBlackouts.value = await leaveBlackoutRepository.list()
    const memberRates = await apiRequest('/salary-rates')
    baseRate.value = Number(memberRates.baseRate ?? 26.74)
    ppeAllowance.value = Number(memberRates.ppeAllowance ?? 5)
    withholdingTaxRate.value = Number(memberRates.withholdingTaxRate ?? 0.12)
    currentCurrency.value = memberSettings.displayCurrency || 'AUD'
    notifyLedgerChanged()
    notifyShoppingChanged()
  } catch (error) {
    showToast(error.message)
    clearSession()
    await workPersistence.restoreGuestRecords()
    leaveBlackouts.value = getGuestLeaveBlackouts()
    await restoreGuestSettings()
  } finally {
    await nextTick()
    rateWritePaused = false
    switchingAccount = false
  }
}

async function handleSignOut() {
  switchingAccount = true
  try {
    try { await workPersistence.flush() } catch { /* Errors are shown by the persistence handler. */ }
    try { await signOut() } catch { showToast('登出請求失敗；本機登入狀態已清除') }
    await workPersistence.restoreGuestRecords()
    leaveBlackouts.value = getGuestLeaveBlackouts()
    await restoreGuestSettings()
    notifyLedgerChanged()
    notifyShoppingChanged()
  } finally {
    switchingAccount = false
  }
}

watch(authToken, async (token) => {
  if (!token && !switchingAccount) {
    await workPersistence.restoreGuestRecords()
    leaveBlackouts.value = getGuestLeaveBlackouts()
    await restoreGuestSettings()
    notifyLedgerChanged()
    notifyShoppingChanged()
  }
})
const activeTab = ref('dashboard')
const visibleMonth = ref(workDate.value.slice(0, 7))
const scheduleMonth = ref(visibleMonth.value)
const displayedMonthRange = computed(() => getMonthRange(visibleMonth.value))
const displayedMonthRecords = computed(() => recordsInMonth(records.value, visibleMonth.value))
const monthlyScheduleRecords = computed(() =>
  recordsInMonth(records.value, scheduleMonth.value).sort((a, b) =>
    a.workDate === b.workDate ? a.startTime.localeCompare(b.startTime) : a.workDate.localeCompare(b.workDate),
  ),
)
watch(visibleMonth, (month) => { scheduleMonth.value = month })

const onCalendarPanelChange = ({ date }) => {
  visibleMonth.value = formatLocalDate(date).slice(0, 7)
}

const moveScheduleMonth = (direction) => {
  const [year, month] = scheduleMonth.value.split('-').map(Number)
  scheduleMonth.value = formatLocalDate(new Date(year, month - 1 + direction, 1)).slice(0, 7)
}

const parseWorkDate = (dateText) => {
  const [year, month, day] = dateText.split('-').map(Number)
  return new Date(year, month - 1, day)
}

// 自動判定禮拜二為清潔日
watch(workDate, (newDate) => {
  if (newDate) {
    const d = parseWorkDate(newDate)
    isCleaningDay.value = (d.getDay() === 2)
  }
}, { immediate: true })

const calendarDefaultDate = computed(() => parseWorkDate(workDate.value))
// 日曆範圍隨今天往後滾動，並涵蓋目前選取日期與所有班表日期（不再固定停在 2027 年底）
const calendarRange = computed(() =>
  getCalendarDateRange({ dates: [workDate.value, ...records.value.map((record) => record.workDate)] }),
)
// 只在年份變動時產生新的 Date，避免每次編輯班表都觸發 van-calendar 重設
const calendarMinYear = computed(() => calendarRange.value.minDate.getFullYear())
const calendarMaxYear = computed(() => calendarRange.value.maxDate.getFullYear())
const calendarMinDate = computed(() => new Date(calendarMinYear.value, 0, 1))
const calendarMaxDate = computed(() => new Date(calendarMaxYear.value, 11, 31))
const selectedRecord = computed(() => records.value.find((record) => record.workDate === workDate.value))
const selectedLeaveBlackout = computed(() => leaveBlackouts.value.find((item) => item.date === workDate.value))

const openBlackoutEditor = () => {
  blackoutReason.value = selectedLeaveBlackout.value?.reason || ''
  showBlackoutEditor.value = true
}

const saveSelectedBlackout = async () => {
  if (blackoutSaving.value) return
  blackoutSaving.value = true
  try {
    const saved = await leaveBlackoutRepository.save({ date: workDate.value, reason: blackoutReason.value })
    leaveBlackouts.value = upsertLeaveBlackout(leaveBlackouts.value, saved)
    showBlackoutEditor.value = false
    showToast(`${workDate.value} 已標記禁休`)
  } catch (error) {
    showToast(error.message || '儲存禁休公告失敗')
  } finally {
    blackoutSaving.value = false
  }
}

const deleteSelectedBlackout = async () => {
  if (blackoutSaving.value) return
  blackoutSaving.value = true
  try {
    await leaveBlackoutRepository.remove(workDate.value)
    leaveBlackouts.value = removeLeaveBlackout(leaveBlackouts.value, workDate.value)
    showBlackoutEditor.value = false
    showToast(`${workDate.value} 已移除禁休標記`)
  } catch (error) {
    showToast(error.message || '移除禁休公告失敗')
  } finally {
    blackoutSaving.value = false
  }
}
const selectedDateHasDefaultShift = computed(() => {
  const defaults = getDefaultShiftForDate(parseWorkDate(workDate.value))
  return defaults.startTime !== defaults.endTime
})

const loadSelectedDate = () => {
  const existingRecord = selectedRecord.value

  if (existingRecord) {
    startTime.value = existingRecord.startTime
    endTime.value = existingRecord.endTime
    shiftType.value = existingRecord.shiftType || 'normal'
    isCleaningDay.value = existingRecord.isCleaningDay || false
    remark.value = existingRecord.remark || ''
    return
  }

  const defaults = getDefaultShiftForDate(parseWorkDate(workDate.value))
  startTime.value = defaults.startTime
  endTime.value = defaults.endTime
  shiftType.value = defaults.shiftType
  isCleaningDay.value = defaults.isCleaningDay
  remark.value = ''
}

// 點擊日曆上的某一天
const onDateSelect = (date) => {
  showBlackoutEditor.value = false
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  workDate.value = `${year}-${month}-${day}`
  visibleMonth.value = `${year}-${month}`
  loadSelectedDate()
}

// --- 批量填充輔助函數：取得特定星期的預設工時設定 ---
const getDefaultShiftForDate = (dateObj) => {
  const dayOfWeek = dateObj.getDay()
  let defaultStartTime = '00:00'
  let defaultEndTime = '00:00'
  let defaultShiftType = 'normal'
  const isCleaning = dayOfWeek === 2 // 星期二是清潔日

  if (dayOfWeek === 0) {
    defaultStartTime = '20:45'
    defaultEndTime = '05:45'
  } else if (dayOfWeek === 1) {
    defaultStartTime = '23:40'
    defaultEndTime = '06:00'
  } else if (dayOfWeek === 2) {
    defaultStartTime = '17:45'
    defaultEndTime = '00:00'
  } else if (dayOfWeek === 3 || dayOfWeek === 4) {
    defaultStartTime = '23:50'
    defaultEndTime = '06:00'
  } else if (dayOfWeek === 5) {
    defaultStartTime = '23:50'
    defaultEndTime = '07:00'
  } else if (dayOfWeek === 6) {
    defaultShiftType = 'leave' // 星期六預設請假
  }

  return {
    startTime: defaultStartTime,
    endTime: defaultEndTime,
    shiftType: defaultShiftType,
    isCleaningDay: isCleaning,
    remark: ''
  }
}
// --- 一鍵填滿本週 (以星期一到星期日為一個週期) ---
const fillCurrentWeek = () => {
  if (!workDate.value) return
  const current = parseWorkDate(workDate.value)
  const day = current.getDay()
  // 換算回星期一的日期
  const diffToMonday = current.getDate() - day + (day === 0 ? -6 : 1) 
  
  const monday = new Date(current.setDate(diffToMonday))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  
  bulkAddRecords(monday, sunday)
}

// --- 一鍵填滿本月 ---
const fillCurrentMonth = () => {
  const range = displayedMonthRange.value
  if (!range) return
  bulkAddRecords(parseWorkDate(range.start), parseWorkDate(range.end))
}

const clearCurrentMonth = async () => {
  const count = displayedMonthRecords.value.length
  if (!count) return showToast(`${visibleMonth.value} 沒有班表可清除`)
  const markedCount = displayedMonthRecords.value.filter((record) => record.designatedWork).length
  try {
    await showConfirmDialog({
      title: `清除 ${visibleMonth.value} 班表？`,
      message: `將刪除 ${displayedMonthRange.value.start} 至 ${displayedMonthRange.value.end} 的 ${count} 筆班表（含休假、備註及 ${markedCount} 筆指定工作標記）。該月薪資預估與工作進度會同步減少；禁休公告、其他月份、車資及支出不會刪除。`,
      confirmButtonText: '清除班表',
      confirmButtonColor: '#ee0a24',
    })
    records.value = clearRecordsInMonth(records.value, visibleMonth.value)
    if (workDate.value.startsWith(visibleMonth.value)) loadSelectedDate()
    showToast(`已清除 ${count} 筆班表`)
  } catch {
    // The user cancelled the destructive action.
  }
}

// --- 核心批量寫入引擎 ---
const bulkAddRecords = (startDate, endDate) => {
  const newRecords = []
  let nextId = nextRecordId(records.value)

  for (const dateStr of getMissingScheduleDates(records.value, {
    start: formatLocalDate(startDate),
    end: formatLocalDate(endDate),
  })) {
    const defaultShift = getDefaultShiftForDate(parseWorkDate(dateStr))
    const record = buildWorkRecordFromInputs({
      id: nextId++,
      workDate: dateStr,
      startTime: defaultShift.startTime,
      endTime: defaultShift.endTime,
      smokoCountOverride: null,
      shiftType: defaultShift.shiftType,
      isCleaningDay: defaultShift.isCleaningDay,
      remark: defaultShift.remark,
      prepMinutes: currentPrepMinutes.value,
    })
    if (record) newRecords.push(record)
  }

  if (newRecords.length > 0) {
    records.value = ensureUniqueRecordIds([...records.value, ...newRecords])
    showToast(`成功加入 ${newRecords.length} 筆班表`)
  } else {
    showToast('該區間內的班表已排滿，無新增項目')
  }
}

const selectedHolidayLabel = computed(() => {
  if (!workDate.value) return ''
  return getNswPublicHolidayLabel(parseWorkDate(workDate.value))
})

// ✨ 日曆格式化：上方放假日/清潔日，下方放金額
const holidayCalendarFormatter = (day) => {
  if (!day.date) return day

  const year = day.date.getFullYear()
  const month = String(day.date.getMonth() + 1).padStart(2, '0')
  const dayNum = String(day.date.getDate()).padStart(2, '0')
  const dateStr = `${year}-${month}-${dayNum}`

  const holidayLabel = getNswPublicHolidayShortLabel(day.date)
  const isTue = day.date.getDay() === 2
  const isBlackout = leaveBlackouts.value.some((item) => item.date === dateStr)

  // 1. 處理上方標籤 (國定假日 / 清潔日)
  if (holidayLabel) {
    day.topInfo = holidayLabel
    day.className = `${day.className || ''} holiday-day`.trim()
  } else if (isBlackout) {
    day.topInfo = '禁休'
  } else if (isTue) {
    day.topInfo = '清潔日'
    day.className = `${day.className || ''} cleaning-day`.trim()
  }
  if (isBlackout) day.className = `${day.className || ''} leave-blackout-day`.trim()

  // 2. 處理下方標籤 (金額 / 請假狀態)
  const record = records.value.find((r) => r.workDate === dateStr)
  let classNames = []
  
  if (record) {
    if (record.shiftType === 'leave') {
      day.bottomInfo = '休假'
    } else {
      const convertedPay = record.grossPay * currentExchangeRate.value
      day.bottomInfo = `+${formatCalendarAmount(convertedPay)}`
    }
    
    classNames.push(record.shiftType === 'leave' ? 'record-leave-day' : 'record-work-day')
    
    if (record.remark && record.remark.trim() !== '') {
      classNames.push('has-remark-day')
    }
  }

  day.className = `${day.className || ''} ${classNames.join(' ')}`.trim()
  return day
}

const updateRate = (targetRef, value, digits = 3) => {
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return
  targetRef.value = roundTo(parsed, digits)
}

// --- 費率設定 ---
// 1. 將 baseRate 改為你目前最新的 Level 5 費率
const baseRate = ref(26.74) 

// 2. 將其他依賴 Base Rate 的費率改為 computed 動態計算
const casualLoadingRate = computed(() => baseRate.value * 0.25)     // 臨時工加給 25%
const shiftLoadingRate = computed(() => baseRate.value * 0.25)      // 輪班加給 25%
const saturdayOrdLoadingRate = computed(() => baseRate.value * 0.5) // 週六加給 50%
const timeHalfRate = computed(() => baseRate.value * 1.5)           // 加班 1.5 倍
const doubleRate = computed(() => baseRate.value * 2.0)             // 加班 2 倍
const sundayLoadingRate = computed(() => baseRate.value * 0.75)     // 週日加給 75%

const ratePreviewItems = computed(() => [
  { label: '基本時薪', value: baseRate.value, unit: '／小時' },
  { label: 'Casual 25%', value: casualLoadingRate.value, unit: '／小時' },
  { label: '夜班 25%', value: shiftLoadingRate.value, unit: '／小時' },
  { label: 'Sat ORD 50%', value: saturdayOrdLoadingRate.value, unit: '／小時' },
  { label: 'T/Half', value: timeHalfRate.value, unit: '／小時' },
  { label: 'Double', value: doubleRate.value, unit: '／小時' },
  { label: '星期日 75%', value: sundayLoadingRate.value, unit: '／小時' },
  { label: 'PPE 每週津貼', value: ppeAllowance.value, unit: '／週' },
])
const hasCurrentExchangeRate = computed(() => currentCurrency.value === 'AUD' || Number.isFinite(exchangeRates.value[currentCurrency.value]))

// 3. 獨立且固定的參數維持 ref 即可
const ppeAllowance = ref(5.0)
const smokoMinutesPerBreak = ref(30)
const smokoCountOverride = ref(null)

// 備註：你這邊寫 withholdingTaxRate，但薪資單上的 12% 其實是退休金 (Superannuation)。
// 如果這是用來算退休金的，數值 0.12 沒問題；若是算所得稅，澳洲稅金通常是看級距查表的喔！
const withholdingTaxRate = ref(0.12)
watch(currentCurrency, async (currency) => {
  if (!authToken.value || rateWritePaused) return
  try {
    await apiRequest('/dashboard-settings/display-currency', { method: 'PUT', body: { currency } })
  } catch (error) { showToast(error.message) }
})
watch([baseRate, ppeAllowance, withholdingTaxRate], async () => {
  if (!authToken.value || rateWritePaused) return
  try {
    await apiRequest('/salary-rates', {
      method: 'PUT',
      body: {
        baseRate: baseRate.value,
        ppeAllowance: ppeAllowance.value,
        withholdingTaxRate: withholdingTaxRate.value,
      },
    })
  } catch (error) { showToast(error.message) }
})

watch([workDate, startTime, endTime, shiftType], () => {
  smokoCountOverride.value = null
})

const displayedSmokoCount = computed(() => {
  if (smokoCountOverride.value !== null) return smokoCountOverride.value
  return workSummary.value?.smokoCount ?? 0
})

// --- 5. 新增：提早換裝 5 分鐘打卡開關 ---
const enablePrepTime = ref(true) // 預設開啟

// 換裝時間計薪：預覽與儲存都使用同一個實際計薪起點（見 src/domain/prepTime.js）
const currentPrepMinutes = computed(() => (enablePrepTime.value ? PREP_MINUTES : 0))
const effectiveShiftStart = computed(() => {
  if (shiftType.value === 'leave') return { workDate: workDate.value, startTime: '00:00' }
  return (
    applyPrepTime(workDate.value, startTime.value, currentPrepMinutes.value) ?? {
      workDate: workDate.value,
      startTime: startTime.value,
    }
  )
})
const effectiveWorkDate = computed(() => effectiveShiftStart.value.workDate)
const effectiveStartTime = computed(() => effectiveShiftStart.value.startTime)

// 原本的 effectiveEndTime 維持不變
const effectiveEndTime = computed(() => shiftType.value === 'leave' ? '00:00' : endTime.value)

const {
  workSummary,
  isNightShift,
  holidaySummary,
  paidSegmentedMinutes,
  saturdayRuleBreakdown,
  payBreakdown,
} = useShiftCalculator({
  workDate: effectiveWorkDate,
  startTime: effectiveStartTime,
  endTime: effectiveEndTime,
  smokoMinutesPerBreak,
  smokoCountOverride,
  baseRate,
  casualLoadingRate,
  shiftLoadingRate,
  saturdayOrdLoadingRate,
  timeHalfRate,
  doubleRate,
  sundayLoadingRate,
})

// 🐛 BUG 完美修復：當狀態為請假時，100% 寫死生成 0 元數據，斬草除根
const buildWorkRecordFromInputs = ({
  id,
  workDate: inputWorkDate,
  startTime: inputStartTime,
  endTime: inputEndTime,
  smokoCountOverride: inputSmokoCountOverride = null,
  shiftType: inputShiftType = 'normal',
  isCleaningDay: inputIsCleaningDay = false,
  remark: inputRemark = '',
  designatedWork: inputDesignatedWork = false,
  prepMinutes: inputPrepMinutes = 0,
}) => {
  
  if (inputShiftType === 'leave') {
    const record = createWorkRecord({
      id,
      workDate: inputWorkDate,
      startTime: '00:00',
      endTime: '00:00',
      workSummary: { totalMinutes: 0, paidMinutes: 0, smokoCount: 0, crossesMidnight: false, smokoDeductMinutes: 0 },
      paidSegmentedMinutes: { weekdayPaidMinutes: 0, sundayPaidMinutes: 0, saturdayPaidMinutes: 0, holidayPaidMinutes: 0 },
      saturdayRuleBreakdown: { satOrdMinutes: 0, timeHalfMinutes: 0, doubleMinutes: 0 },
      payBreakdown: { basePay: 0, casualPay: 0, shiftPay: 0, holidayPenaltyPay: 0, satOrdPay: 0, timeHalfPay: 0, doublePay: 0, sunOrdPay: 0, grossPay: 0, holidayPenaltyRate: 0 },
    })
    record.shiftType = 'leave'
    record.isCleaningDay = false
    record.remark = inputRemark
    record.designatedWork = false
    record.prepMinutes = 0
    return record
  }

  // 薪資用套用換裝時間後的起點計算；紀錄仍保存使用者輸入的上班時間
  const paidStart = applyPrepTime(inputWorkDate, inputStartTime, inputPrepMinutes) ?? {
    workDate: inputWorkDate,
    startTime: inputStartTime,
  }
  const tempWorkDate = ref(paidStart.workDate)
  const tempStartTime = ref(paidStart.startTime)
  const tempEndTime = ref(inputEndTime)
  const tempSmokoCountOverride = ref(inputSmokoCountOverride)

  const {
    workSummary: tempWorkSummary,
    paidSegmentedMinutes: tempPaidSegmentedMinutes,
    saturdayRuleBreakdown: tempSaturdayRuleBreakdown,
    payBreakdown: tempPayBreakdown,
  } = useShiftCalculator({
    workDate: tempWorkDate,
    startTime: tempStartTime,
    endTime: tempEndTime,
    smokoMinutesPerBreak,
    smokoCountOverride: tempSmokoCountOverride,
    baseRate,
    casualLoadingRate,
    shiftLoadingRate,
    saturdayOrdLoadingRate,
    timeHalfRate,
    doubleRate,
    sundayLoadingRate,
  })

  if (!tempWorkSummary.value || !tempPayBreakdown.value) return null

  const record = createWorkRecord({
    id,
    workDate: inputWorkDate,
    startTime: inputStartTime,
    endTime: inputEndTime,
    workSummary: tempWorkSummary.value,
    paidSegmentedMinutes: tempPaidSegmentedMinutes.value,
    saturdayRuleBreakdown: tempSaturdayRuleBreakdown.value,
    payBreakdown: tempPayBreakdown.value,
  })
  
  record.shiftType = inputShiftType
  record.isCleaningDay = inputIsCleaningDay
  record.remark = inputRemark
  record.designatedWork = inputDesignatedWork
  record.prepMinutes = paidStart.startTime === inputStartTime ? 0 : inputPrepMinutes
  return record
}

const markSelectedDateAsLeave = () => {
  const record = buildWorkRecordFromInputs({
    id: selectedRecord.value?.id ?? nextRecordId(records.value),
    workDate: workDate.value,
    startTime: '00:00',
    endTime: '00:00',
    shiftType: 'leave',
    remark: selectedRecord.value?.remark || '',
  })
  records.value = upsertRecordForDate(records.value, record)
  loadSelectedDate()
  showToast(`${workDate.value} 已設為休假`)
}

const restoreSelectedDateShift = () => {
  const defaults = getDefaultShiftForDate(parseWorkDate(workDate.value))
  if (!selectedDateHasDefaultShift.value) {
    shiftType.value = 'normal'
    openSelectedDateEditor()
    showToast('這天沒有預設工時，請先選擇上下班時間')
    return
  }
  // 恢復出勤使用本月填滿的預設班別；休假紀錄不保存先前的個人工時。
  const record = buildWorkRecordFromInputs({
    id: selectedRecord.value?.id ?? nextRecordId(records.value),
    workDate: workDate.value,
    startTime: defaults.startTime,
    endTime: defaults.endTime,
    shiftType: 'normal',
    isCleaningDay: defaults.isCleaningDay,
    remark: selectedRecord.value?.remark || '',
    prepMinutes: currentPrepMinutes.value,
  })
  if (!record) return
  records.value = upsertRecordForDate(records.value, record)
  loadSelectedDate()
  showToast(`${workDate.value} 已恢復預設出勤`)
}

const openSelectedDateEditor = () => {
  nextTick(() => workInputSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

// --- 本週總結加總 ---
const weeklySubtotal = computed(() => {
  return roundTo(records.value.reduce((sum, record) => sum + record.grossPay, 0), 2)
})

const weeklyPPE = computed(() => {
  const hasValidShift = records.value.some(r => r.shiftType !== 'leave')
  return hasValidShift ? roundTo(ppeAllowance.value, 2) : 0
})

const weeklyTotal = computed(() => roundTo(weeklySubtotal.value + weeklyPPE.value, 2))
const weeklyTaxEstimate = computed(() => roundTo(weeklyTotal.value * withholdingTaxRate.value, 2))
const weeklyNetTotal = computed(() => roundTo(weeklyTotal.value - weeklyTaxEstimate.value, 2))
const convertedNetTotal = computed(() => roundTo(weeklyNetTotal.value * currentExchangeRate.value, 2))

const isEditingRecord = computed(() => Boolean(selectedRecord.value))

// ======= 備份控制中心與 Excel 生成引擎 =======
const exportTodayJson = () => {
  if (!workSummary.value || !payBreakdown.value) return
  const todayRecord = buildWorkRecordFromInputs({ workDate: workDate.value, startTime: startTime.value, endTime: endTime.value, smokoCountOverride: smokoCountOverride.value, shiftType: shiftType.value, isCleaningDay: isCleaningDay.value, remark: remark.value, designatedWork: selectedRecord.value?.designatedWork === true, prepMinutes: currentPrepMinutes.value })
  if (!todayRecord) return
  const blob = new Blob([JSON.stringify(todayRecord, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = `${workDate.value}.json`; link.click(); URL.revokeObjectURL(url)
}

const exportWeeklyJson = () => {
  if (records.value.length === 0) return
  const blob = new Blob([JSON.stringify(records.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'weekly-records.json'; link.click(); URL.revokeObjectURL(url)
}

const importJsonFiles = async (payload) => {
  const uploaderFiles = Array.isArray(payload) ? payload : [payload]
  const eventFiles = Array.from(payload?.target?.files || [])
  const files = eventFiles.length > 0 ? eventFiles : uploaderFiles.map((item) => item?.file || item).filter(Boolean)
  const importedRecords = []
  for (const file of files) {
    const text = await file.text(); const jsonData = JSON.parse(text)
    if (Array.isArray(jsonData)) {
      importedRecords.push(...jsonData.map((record) => normalizeWorkRecord(record)).map((record) => { return buildWorkRecordFromInputs({ id: record.id, workDate: record.workDate, startTime: record.startTime, endTime: record.endTime, shiftType: record.shiftType || 'normal', isCleaningDay: record.isCleaningDay || false, remark: record.remark || '', designatedWork: record.designatedWork, prepMinutes: Number(record.prepMinutes) || 0 }) ?? record }))
      continue
    }
    const normalizedRecord = normalizeWorkRecord(jsonData)
    importedRecords.push(buildWorkRecordFromInputs({ id: normalizedRecord.id, workDate: normalizedRecord.workDate, startTime: normalizedRecord.startTime, endTime: normalizedRecord.endTime, shiftType: normalizedRecord.shiftType || 'normal', isCleaningDay: normalizedRecord.isCleaningDay || false, remark: normalizedRecord.remark || '', designatedWork: normalizedRecord.designatedWork, prepMinutes: Number(normalizedRecord.prepMinutes) || 0 }) ?? normalizedRecord)
  }
  records.value = ensureUniqueRecordIds(importedRecords.sort((a, b) => { if (a.workDate === b.workDate) return b.startTime.localeCompare(a.startTime); return b.workDate.localeCompare(a.workDate) }))
}

const exportWeeklyXlsx = () => {
  if (records.value.length === 0) return
  const sortedExportRecords = [...records.value].sort((a, b) => { if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate); return a.startTime.localeCompare(b.startTime) })
  let cumulativePaidHours = 0
  const totalRawMinutes = sortedExportRecords.reduce((sum, record) => sum + record.totalMinutes, 0)
  const totalSmokoCount = sortedExportRecords.reduce((sum, record) => sum + record.smokoCount, 0)
  const totalSmokoDeductMinutes = sortedExportRecords.reduce((sum, record) => sum + record.smokoDeductMinutes, 0)
  const totalPaidMinutes = sortedExportRecords.reduce((sum, record) => sum + record.paidMinutes, 0)
  const totalBasePay = roundTo(sortedExportRecords.reduce((sum, record) => sum + record.basePay, 0), 2)
  const totalCasualPay = roundTo(sortedExportRecords.reduce((sum, record) => sum + record.casualPay, 0), 2)
  const totalShiftPay = roundTo(sortedExportRecords.reduce((sum, record) => sum + record.shiftPay, 0), 2)
  const totalGrossPay = roundTo(sortedExportRecords.reduce((sum, record) => sum + record.grossPay, 0), 2)
  const totalPaidHours = roundTo(totalPaidMinutes / 60, 4)
  const totalBaseHours = roundTo((totalPaidMinutes - sortedExportRecords.reduce((sum, r) => sum + r.timeHalfMinutes + r.doubleMinutes, 0)) / 60, 4)

  const exportRows = sortedExportRecords.map((record) => {
    cumulativePaidHours = roundTo(cumulativePaidHours + record.paidMinutes / 60, 4)
    return ({ 日期: record.workDate, 開始時間: record.startTime, 結束時間: record.endTime, 計薪工時分鐘: record.paidMinutes, 當日總薪資: record.grossPay, 加總工時: cumulativePaidHours, 備註事項: record.remark || '' })
  })
  exportRows.push({ 日期: '合計', 開始時間: '', 結束時間: '', 計薪工時分鐘: totalPaidMinutes, 當日總薪資: totalGrossPay, 加總工時: totalPaidHours, 備註事項: '' })
  const ws = XLSX.utils.json_to_sheet(exportRows); const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Weekly Summary'); XLSX.writeFile(wb, 'weekly-summary.xlsx')
}
// =============================================================

const getDayOfWeek = (dateStr) => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const [y, m, d] = dateStr.split('-').map(Number)
  return days[new Date(y, m - 1, d).getDay()]
}

const addTodayRecordToList = () => {
  if (shiftType.value !== 'leave' && (!isValidTime(startTime.value) || !isValidTime(endTime.value))) return

  const todayRecord = buildWorkRecordFromInputs({
    id: selectedRecord.value?.id ?? nextRecordId(records.value),
    workDate: workDate.value,
    startTime: startTime.value,
    endTime: endTime.value,
    smokoCountOverride: smokoCountOverride.value,
    shiftType: shiftType.value,
    isCleaningDay: isCleaningDay.value,
    remark: remark.value,
    designatedWork: selectedRecord.value?.designatedWork === true,
    prepMinutes: currentPrepMinutes.value,
  })

  if (!todayRecord) return
  const wasExisting = Boolean(selectedRecord.value)
  records.value = upsertRecordForDate(records.value, todayRecord)
  showToast(wasExisting ? '已更新當天班表' : '成功加入排班列表')
}

const editRecord = (record) => {
  workDate.value = record.workDate
  loadSelectedDate()
  scheduleSections.value = []
  expandedRecordId.value = ''
  nextTick(() => workInputSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

const cancelEditingRecord = () => {
  loadSelectedDate()
  showToast('已還原未儲存變更')
}

const deleteRecord = (recordId) => {
  records.value = records.value.filter((record) => record.id !== recordId)
  if (expandedRecordId.value === recordId) expandedRecordId.value = ''
  loadSelectedDate()
}

const markDesignatedWorkDate = ({ date, marked }) => {
  records.value = records.value.map((record) =>
    record.workDate === date && record.shiftType !== 'leave' && record.paidMinutes > 0
      ? { ...record, designatedWork: marked }
      : record,
  )
}
</script>

<template>
  <div class="page">
    <div class="account-shell">
      <div class="account-card" :class="{ 'account-card--shopping-guest': !authToken && activeTab === 'shopping' }">
        <span class="account-card__avatar" aria-hidden="true">
          <van-icon :name="authToken ? 'user-circle-o' : 'user-o'" />
        </span>
        <div class="account-card__identity">
          <strong>{{ authToken ? '已登入' : activeTab === 'shopping' ? '訪客模式' : '訪客試算' }}</strong>
          <span :title="authToken ? authEmail : undefined">
            {{ authToken ? authEmail : activeTab === 'shopping' ? '清單不會永久保存，重整後消失' : '登入後可保存私人紀錄' }}
          </span>
        </div>
        <van-button size="small" plain type="primary" class="account-card__action"
          @click="authToken ? handleSignOut() : authPanelOpen = true">
          {{ authToken ? '登出' : '登入／註冊' }}
        </van-button>
      </div>
    </div>
    <AuthPanel v-model:show="authPanelOpen" @signed-in="handleSignedIn" />
    <DashboardPage
      v-show="activeTab === 'dashboard'"
      :work-records="records"
      :active="activeTab === 'dashboard'"
      @mark-work-date="markDesignatedWorkDate"
      @navigate="activeTab = $event"
    />
    <section v-show="activeTab === 'payroll'" class="payroll-page app-page">
    <div class="header app-page__header">
      <div class="header-main">
        <h1>薪資預估</h1>
        <van-button size="small" plain type="primary" class="global-currency-btn" @click="showCurrencyPicker = true">
          {{ currencyFlag }} {{ currentCurrency }}
        </van-button>
      </div>
      <p>記錄班表，預估薪資。</p>
    </div>

    <div class="section calendar-section">
      <div class="calendar-intro">
        <p class="calendar-help">點日期可設休假、記禁休或編輯工時</p>
      </div>
      <div class="calendar-month-actions">
        <span>目前顯示 {{ visibleMonth }}</span>
        <van-button size="small" plain type="primary" @click="fillCurrentMonth">填滿此月</van-button>
        <van-button size="small" plain type="danger" :disabled="displayedMonthRecords.length === 0" @click="clearCurrentMonth">清除此月班表</van-button>
      </div>
      <div class="calendar-wrapper">
        <van-calendar
          :poppable="false"
          :show-confirm="false"
          :default-date="calendarDefaultDate"
          :min-date="calendarMinDate"
          :max-date="calendarMaxDate"
          :formatter="holidayCalendarFormatter"
          switch-mode="year-month"
          @select="onDateSelect"
          @panel-change="onCalendarPanelChange"
        />
      </div>
      <div class="calendar-day-actions">
        <div class="calendar-day-actions__heading">
          <div>
            <strong>{{ workDate }} <small>{{ getDayOfWeek(workDate) }}</small></strong>
            <p v-if="selectedRecord?.shiftType === 'leave'">已標記休假，不計工時與薪資</p>
            <p v-else-if="selectedRecord">已排班 · {{ selectedRecord.startTime }}–{{ selectedRecord.endTime }}</p>
            <p v-else>尚未加入班表</p>
            <p v-if="selectedLeaveBlackout" class="calendar-day-actions__blackout">
              禁休公告{{ selectedLeaveBlackout.reason ? `：${selectedLeaveBlackout.reason}` : '' }}
            </p>
          </div>
          <strong v-if="selectedRecord && selectedRecord.shiftType !== 'leave'" class="calendar-day-actions__pay">
            {{ currencySymbol }}{{ formatDisplayMoney(selectedRecord.grossPay * currentExchangeRate) }}
          </strong>
        </div>
        <div class="calendar-day-actions__buttons">
          <van-button v-if="selectedRecord?.shiftType === 'leave'" block plain type="primary" @click="restoreSelectedDateShift">{{ selectedDateHasDefaultShift ? '恢復預設出勤' : '設定出勤時間' }}</van-button>
          <van-button v-else block plain type="danger" @click="markSelectedDateAsLeave">設為休假</van-button>
          <van-button block plain type="default" @click="openSelectedDateEditor">{{ selectedRecord ? '編輯當天工時' : '新增當天班表' }}</van-button>
          <van-button block plain type="warning" class="calendar-day-actions__blackout-button" @click="openBlackoutEditor">
            {{ selectedLeaveBlackout ? '編輯禁休公告' : '新增禁休' }}
          </van-button>
        </div>
        <p v-if="selectedRecord?.shiftType === 'leave'" class="calendar-day-actions__hint">{{ selectedDateHasDefaultShift ? '恢復時會套用填滿本月的預設時間；如需不同工時，請再編輯。' : '這天沒有預設工時，請設定上下班時間後儲存。' }}</p>
        <p class="calendar-day-actions__hint">禁休只用來提醒主管公告，不會變更班表、休假或薪資。</p>
      </div>
    </div>

    <van-popup v-model:show="showBlackoutEditor" position="bottom" round>
      <div class="blackout-editor">
        <div class="blackout-editor__heading">
          <strong>{{ selectedLeaveBlackout ? '編輯禁休公告' : '新增禁休' }}</strong>
          <span>{{ workDate }}</span>
        </div>
        <p>記下主管公告的原因，之後排休時不用再找訊息。這只是個人提醒，不代表系統會阻止請假。</p>
        <van-field v-model="blackoutReason" type="textarea" rows="2" autosize maxlength="240" show-word-limit
          label="公告說明" placeholder="選填，例如：人手不足、旺季不得請假" />
        <div class="blackout-editor__actions">
          <van-button v-if="selectedLeaveBlackout" block plain type="danger" :loading="blackoutSaving" @click="deleteSelectedBlackout">移除標記</van-button>
          <van-button block type="primary" :loading="blackoutSaving" @click="saveSelectedBlackout">儲存禁休</van-button>
        </div>
      </div>
    </van-popup>

    <div ref="workInputSection" class="section">
      <h2>出勤與時間</h2>
      
      <van-cell-group inset style="margin-bottom: 12px;">
        <div style="padding: 14px 16px;">
          <div style="font-size: 14px; color: #646566; margin-bottom: 12px; font-weight: bold;">當日出勤狀態：</div>
          <van-radio-group v-model="shiftType" direction="horizontal">
            <van-radio name="normal">正常出勤</van-radio>
            <van-radio name="leave">請假休假</van-radio>
          </van-radio-group>
        </div>
      </van-cell-group>

      <van-cell-group inset>
        <van-cell title="當前選取日期" :value="`${workDate} (${getDayOfWeek(workDate)})`" size="large" title-style="font-weight: bold;" />
        <van-cell v-if="selectedHolidayLabel" title="🔥 澳洲國定假日" :value="selectedHolidayLabel" value-class="holiday-text" />
        <van-cell v-if="isCleaningDay" title="✨ 每週例行狀態" value="固定清潔日費率" value-class="cleaning-text" />
        
<!-- 找到這個區塊，在 endTime 下方加入開關 -->
        <template v-if="shiftType !== 'leave'">
          <van-field
            v-model="startTime"
            is-link
            readonly
            label="預估上班時間"
            placeholder="請選擇時間"
            input-align="right"
            @click="showStartTimePicker = true"
          />
          <van-field
            v-model="endTime"
            is-link
            readonly
            label="預估下班時間"
            placeholder="請選擇時間"
            input-align="right"
            @click="showEndTimePicker = true"
          />
          <!-- 這裡放入新的換裝時間開關 -->
          <van-cell center title="提早 5 分鐘換裝打卡">
            <template #right-icon>
              <van-switch v-model="enablePrepTime" size="20px" />
            </template>
          </van-cell>
        </template>

        <van-cell v-else>
          <template #title>
            <div style="color: #ee0a24; text-align: center; font-size: 14px; padding: 10px 0; font-weight: bold;">
              🏖️ 當日排定為「請假休假」，工時與薪資為 0。
            </div>
          </template>
        </van-cell>

        <van-field
          v-model="remark"
          label="自訂備註說明"
          placeholder="選填（如：今天提早下班、感冒等）"
          input-align="right"
          clearable
        />
      </van-cell-group>
    </div>

    <van-popup v-model:show="showStartTimePicker" position="bottom" round>
      <van-time-picker title="預估上班時間" :filter="filterTime" @confirm="onStartTimeConfirm" @cancel="showStartTimePicker = false" />
    </van-popup>
    <van-popup v-model:show="showEndTimePicker" position="bottom" round>
      <van-time-picker title="預估下班時間" :filter="filterTime" @confirm="onEndTimeConfirm" @cancel="showEndTimePicker = false" />
    </van-popup>

    <div class="workflow">
      
      <div class="section">
        <h2>儲存班表</h2>
        <div class="section-card">
          <p class="section-note">日曆可直接設休假；需要調整時間或備註時，在這裡儲存當天班表。</p>
          <div class="weekly-actions">
            <!-- 單日儲存按鈕 -->
            <van-button block type="primary" :icon="isEditingRecord ? 'edit' : 'plus'" @click="addTodayRecordToList">
              {{ isEditingRecord ? '儲存修改' : '加入本週班表' }}
            </van-button>
            
            <van-button block plain type="primary" @click="fillCurrentWeek">填滿本週</van-button>
            
            <van-button v-if="isEditingRecord" block plain type="default" @click="cancelEditingRecord">還原未儲存變更</van-button>
          </div>
        </div>
      </div>

      <div class="section" v-if="workSummary && shiftType !== 'leave'">
        <h2>當日薪資預估 ({{ currentCurrency }})</h2>
        <van-cell-group inset style="margin-bottom: 12px;">
          <van-cell title="實際計薪總工時" :value="`${formatHours(workSummary.paidMinutes)} 小時`" value-class="highlight-blue" />
          <van-cell title="夜班津貼判定" :value="isNightShift ? '有符合' : '無符合'" />
          <van-cell title="自動算 Smoko 次數" :value="`${workSummary.smokoCount} 次`" />
        </van-cell-group>
        <van-cell-group inset>
          <van-cell title="Base Pay (基本)" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.basePay * currentExchangeRate)}`" />
          <van-cell title="CASUAL LOADING 25%" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.casualPay * currentExchangeRate)}`" />
          <van-cell v-if="payBreakdown.shiftPay > 0" title="SHIFT 夜班 25%" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.shiftPay * currentExchangeRate)}`" />
          <van-cell v-if="payBreakdown.holidayPenaltyPay > 0" title="P/HOL 150%" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.holidayPenaltyPay * currentExchangeRate)}`" />
          <van-cell title="SAT ORD 50%" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.satOrdPay * currentExchangeRate)}`" />
          <van-cell title="T/Half (1.5倍)" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.timeHalfPay * currentExchangeRate)}`" />
          <van-cell title="Double (2倍)" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.doublePay * currentExchangeRate)}`" />
          <van-cell title="SUN ORD 75%" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.sunOrdPay * currentExchangeRate)}`" />
          <van-cell title="當日總薪資 (稅前)" :value="`${currencySymbol}${formatDisplayMoney(payBreakdown.grossPay * currentExchangeRate)}`" class="gross-cell" />
        </van-cell-group>
      </div>

      <div class="section">
        <h2>基本費率 · {{ currentCurrency }}{{ currentCurrency === 'AUD' ? '' : ' 參考換算' }}</h2>
        <p v-if="!hasCurrentExchangeRate" class="section-note">尚未取得 {{ currentCurrency }} 匯率，暫不顯示參考換算。</p>
        <div v-else class="rate-preview section-card">
          <div v-for="rate in ratePreviewItems" :key="rate.label" class="rate-preview__row">
            <span>{{ rate.label }}</span>
            <strong>{{ currencySymbol }}{{ formatDisplayMoney(rate.value * currentExchangeRate) }} {{ currentCurrency }}{{ rate.unit }}</strong>
          </div>
        </div>
        <p class="section-note rate-input-note">下方以 AUD 輸入原始費率；切換顯示幣別不會改動計薪參數或已存班表。</p>
        <van-cell-group inset>
          <van-cell title="Smoko 次數" center>
            <template #right-icon>
              <van-stepper :model-value="displayedSmokoCount" :min="0" :max="3" integer theme="round" button-size="28px" disable-input @change="(val) => { smokoCountOverride = Number(val) }" />
            </template>
          </van-cell>
          <van-field :model-value="formatRate(baseRate)" label="基本時薪 AUD" type="number" input-align="right" @update:model-value="(val) => updateRate(baseRate, val, 3)" />
          <van-cell title="Casual 25% · AUD" :value="formatRate(casualLoadingRate)" />
          <van-cell title="夜班 25% · AUD" :value="formatRate(shiftLoadingRate)" />
          <van-cell title="Sat ORD 50% · AUD" :value="formatRate(saturdayOrdLoadingRate)" />
          <van-cell title="T/Half · AUD" :value="formatRate(timeHalfRate)" />
          <van-cell title="Double · AUD" :value="formatRate(doubleRate)" />
          <van-cell title="星期日 75% · AUD" :value="formatRate(sundayLoadingRate)" />
          <van-field :model-value="formatRate(ppeAllowance)" label="PPE 每週 AUD" type="number" input-align="right" @update:model-value="(val) => updateRate(ppeAllowance, val, 2)" />
        </van-cell-group>
      </div>

      <div class="section">
        <h2>班表明細</h2>
        <div class="schedule-month-nav" aria-label="班表月份">
          <button type="button" aria-label="班表上月" @click="moveScheduleMonth(-1)"><van-icon name="arrow-left" /></button>
          <strong>{{ scheduleMonth }} · {{ monthlyScheduleRecords.length }} 筆</strong>
          <button type="button" aria-label="班表下月" @click="moveScheduleMonth(1)"><van-icon name="arrow" /></button>
        </div>
        <div v-if="monthlyScheduleRecords.length === 0" class="section-card empty-state">
          <div class="empty-state__title">{{ scheduleMonth }} 沒有班表紀錄</div>
          <div class="empty-state__text">可切換月份查看，或回到日曆填滿此月。</div>
        </div>
        <van-collapse v-else v-model="scheduleSections" class="schedule-collapse">
          <van-collapse-item name="records">
            <template #title>
              <div class="schedule-overview">
                <strong>查看 {{ scheduleMonth }} · {{ monthlyScheduleRecords.length }} 筆班表</strong>
                <small>依日期排列，點選單筆查看明細</small>
              </div>
            </template>
            <van-collapse v-model="expandedRecordId" accordion class="record-collapse">
              <van-collapse-item v-for="record in monthlyScheduleRecords" :key="record.id" :name="record.id">
                <template #title>
                  <span class="schedule-date">{{ record.workDate }} <small>{{ getDayOfWeek(record.workDate) }}</small></span>
                </template>
                <template #value>
                  <strong class="schedule-pay">{{ currencySymbol }}{{ formatDisplayMoney(record.grossPay * currentExchangeRate) }}</strong>
                </template>
                <div class="schedule-detail">
                  <div class="schedule-detail__tags">
                    <van-tag v-if="record.shiftType === 'leave'" type="danger">請假</van-tag>
                    <van-tag v-if="record.isCleaningDay" type="success">清潔日</van-tag>
                    <van-tag v-if="record.shiftPay > 0" plain type="primary">夜班</van-tag>
                  </div>
                  <p v-if="record.shiftType !== 'leave'">{{ record.startTime }} – {{ record.endTime }} · 計薪 {{ formatHours(record.paidMinutes) }} 小時 · smoko {{ record.smokoCount }} 次</p>
                  <p v-if="record.remark">備註：{{ record.remark }}</p>
                  <div class="schedule-detail__actions">
                    <van-button size="small" plain type="primary" @click="editRecord(record)">修改工時</van-button>
                    <van-button size="small" plain type="danger" @click="deleteRecord(record.id)">移除</van-button>
                  </div>
                </div>
              </van-collapse-item>
            </van-collapse>
          </van-collapse-item>
        </van-collapse>
      </div>

      <div class="section">
        <h2>本週結算預估</h2>
        <div class="section-card weekly-summary-card">
          <div class="weekly-summary__row">
            <span class="weekly-summary__label">本週班表薪資小計 ({{ currentCurrency }})</span>
            <span class="weekly-summary__value">{{ currencySymbol }}{{ formatDisplayMoney(weeklySubtotal * currentExchangeRate) }}</span>
          </div>
          <div class="weekly-summary__row">
            <span class="weekly-summary__label">PPE 工具補助津貼 ({{ currentCurrency }})</span>
            <span class="weekly-summary__value">{{ currencySymbol }}{{ formatDisplayMoney(weeklyPPE * currentExchangeRate) }}</span>
          </div>
          <div class="weekly-summary__row" style="margin-top: 8px; border-top: 1px dashed #ebedf0; padding-top: 8px;">
            <span class="weekly-summary__label" style="font-size: 13px; color: #646566;">本週預估總薪資（稅前）({{ currentCurrency }})</span>
            <span class="weekly-summary__value" style="font-size: 14px; color: #646566; font-weight: 500;">{{ currencySymbol }}{{ formatDisplayMoney(weeklyTotal * currentExchangeRate) }}</span>
          </div>
          <div class="weekly-summary__row weekly-summary__row--tax" style="margin-bottom: 8px;">
            <span class="weekly-summary__label">預估扣稅扣繳 12% ({{ currentCurrency }})</span>
            <span class="weekly-summary__value weekly-summary__value--tax">-{{ currencySymbol }}{{ formatDisplayMoney(weeklyTaxEstimate * currentExchangeRate) }}</span>
          </div>
          <div class="weekly-summary__total weekly-summary__total--net">
            <div class="weekly-summary__total-label">本週實領預估（稅後淨所得）</div>
            <div class="weekly-summary__total-value weekly-summary__total-value--net">
              <span style="margin-right: 4px;">{{ currencyFlag }}</span>
              {{ currencySymbol }}{{ formatDisplayMoney(convertedNetTotal) }}
              <span style="font-size: 14px; font-weight: normal; color: #15803d; margin-left: 2px;">{{ currentCurrency }}</span>
            </div>
            <div v-if="currentCurrency !== 'AUD'" style="font-size: 12px; color: #15803d; margin-top: 6px; font-weight: normal; text-align: right; opacity: 0.8;">
              匯率即時參考: 1 AUD = {{ exchangeRates[currentCurrency] }} {{ currentCurrency }}
            </div>
          </div>
        </div>
      </div>


      <div class="section">
        <h2>資料管理</h2>
        <van-collapse v-model="dataManagementSections" class="data-management-collapse">
          <van-collapse-item name="data-management" title="打開 匯入 / 匯出 備份操作區">
            <div class="button-group">
              <p class="section-note section-note--compact">您可以將資料安全地備份為標準 JSON 檔，或匯出為自動排版的 Excel 薪資對帳單。</p>
              <van-button block plain type="default" @click="exportTodayJson">匯出今日單日 JSON</van-button>
              <div class="import-export-row">
                <van-button block plain type="primary" :disabled="records.length === 0" @click="exportWeeklyJson">匯出本週 JSON</van-button>
                <van-uploader class="import-uploader" :after-read="importJsonFiles" accept=".json,application/json" multiple>
                  <van-button block plain type="danger" class="import-button">匯入備份 JSON</van-button>
                </van-uploader>
              </div>
              <van-button block plain type="success" style="margin-top: 12px" :disabled="records.length === 0" @click="exportWeeklyXlsx">📊 匯出每週 XLSX (Excel 對帳單)</van-button>
            </div>
          </van-collapse-item>
        </van-collapse>
      </div>

    </div>
    <van-popup v-model:show="showCurrencyPicker" position="bottom" round>
      <van-picker title="選擇全域對照外幣" :columns="currencyColumns" @confirm="onCurrencyConfirm" @cancel="showCurrencyPicker = false" />
    </van-popup>
    </section>

    <TripTracker v-show="activeTab === 'trips'" />
    <ShoppingList v-show="activeTab === 'shopping'" :active="activeTab === 'shopping'" @navigate="activeTab = $event" />
    <ExpenseTracker v-show="activeTab === 'expenses'" />

    <van-tabbar v-model="activeTab" fixed safe-area-inset-bottom>
      <van-tabbar-item name="dashboard" icon="home-o">首頁</van-tabbar-item>
      <van-tabbar-item name="payroll" icon="balance-o">薪資</van-tabbar-item>
      <van-tabbar-item name="trips" icon="friends-o">車資</van-tabbar-item>
      <van-tabbar-item name="shopping" icon="cart-o">採買</van-tabbar-item>
      <van-tabbar-item name="expenses" icon="records">支出</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<style scoped>
.page { min-height: 100vh; background: #f5f7fa; }
.account-shell { max-width: 820px; margin-inline: auto; padding: calc(10px + env(safe-area-inset-top, 0px)) max(var(--page-inset), env(safe-area-inset-right, 0px)) 0 max(var(--page-inset), env(safe-area-inset-left, 0px)); }
.account-card { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 58px; padding: 8px 10px; box-sizing: border-box; border: 1px solid var(--color-border); border-radius: 16px; background: var(--color-surface); box-shadow: 0 6px 18px rgba(29, 66, 106, .05); }
.account-card__avatar { display: grid; flex: none; place-items: center; width: 38px; height: 38px; border-radius: 12px; background: #eaf3fe; color: #166dd1; font-size: 20px; }
.account-card__identity { display: grid; gap: 2px; flex: 1; min-width: 0; }
.account-card__identity strong { color: var(--color-heading); font-size: 13px; font-weight: 800; line-height: 1.2; }
.account-card__identity span { overflow: hidden; color: var(--color-muted); font-size: 12px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.account-card--shopping-guest .account-card__identity span { overflow: visible; white-space: normal; }
.account-card__action { flex: none; min-height: 38px; padding-inline: 12px; border-radius: 11px; font-weight: 700; }
.page :deep(.app-page) { padding-top: 12px; }
.payroll-page { max-width: 820px; margin: 0 auto; }
.header { flex-wrap: wrap; }
.header-main { display: flex; justify-content: space-between; align-items: center; gap: 12px; width: 100%; }
.header p { width: 100%; }
.global-currency-btn { flex: none; min-height: 38px; font-weight: 700; border-radius: 12px; background: #fff; box-shadow: 0 2px 8px rgba(29, 66, 106, .06); }

.section { margin-top: var(--page-section-gap); }
.section h2 { font-size: var(--font-heading); font-weight: 800; color: #1b2a3b; margin: 0 0 12px; letter-spacing: -.02em; }
.calendar-section { margin-top: 8px; }
.calendar-intro { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.calendar-intro :deep(.van-button) { flex: none; min-height: 40px; border-radius: 11px; }
.calendar-help { margin: 0; color: #657588; font-size: 13px; line-height: 1.4; }
.calendar-month-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 12px; }
.calendar-month-actions span { flex: 1 1 100%; color: #657588; font-size: 13px; font-weight: 700; }
.calendar-month-actions :deep(.van-button) { min-height: 40px; border-radius: 11px; }
.rate-preview { display: grid; gap: 0; margin-bottom: 10px; }
.rate-preview__row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 5px 12px; padding: 7px 0; font-size: 13px; border-bottom: 1px solid #edf1f5; }
.rate-preview__row:last-child { border-bottom: 0; }
.rate-preview__row strong { color: #166dd1; margin-left: auto; font-variant-numeric: tabular-nums; }
.rate-input-note { margin-top: 10px; }
.schedule-month-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; padding: 4px; border-radius: 14px; background: #eaf3fe; }
.schedule-month-nav button { width: 40px; height: 40px; border: 0; border-radius: 10px; background: #fff; color: #166dd1; }
.schedule-month-nav strong { font-size: 14px; text-align: center; }

.calendar-wrapper { border-radius: var(--page-card-radius); overflow: hidden; box-shadow: 0 12px 28px rgba(29, 66, 106, .07); background: #fff; border: 1px solid #e6edf5; }
.calendar-day-actions { margin: 12px 0 0; padding: 15px 16px; border: 1px solid #e6edf5; border-radius: 18px; background: #fff; box-shadow: 0 6px 18px rgba(29, 66, 106, .05); }
.calendar-day-actions__heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 10px; }
.calendar-day-actions__heading strong { color: #1b2a3b; font-size: 15px; }
.calendar-day-actions__heading small { color: #8290a0; font-size: 11px; }
.calendar-day-actions__heading p { margin: 4px 0 0; color: #657588; font-size: 12px; }
.calendar-day-actions__heading .calendar-day-actions__blackout { color: #a95a0c; font-weight: 700; overflow-wrap: anywhere; }
.calendar-day-actions__pay { margin-left: auto; color: #166dd1 !important; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.calendar-day-actions__buttons { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 13px; }
.calendar-day-actions__buttons :deep(.van-button) { min-height: 42px; padding: 0 8px; border-radius: 11px; font-size: 13px; }
.calendar-day-actions__blackout-button { grid-column: 1 / -1; }
.calendar-day-actions__hint { margin: 10px 0 0; color: #8290a0; font-size: 11px; line-height: 1.4; }
.blackout-editor { max-height: 90dvh; overflow-y: auto; padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); }
.blackout-editor__heading { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; color: #1b2a3b; }
.blackout-editor__heading strong { font-size: 18px; }
.blackout-editor__heading span { color: #657588; font-size: 13px; }
.blackout-editor p { color: #657588; font-size: 13px; line-height: 1.5; }
.blackout-editor__actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 18px; }
.blackout-editor__actions :deep(.van-button) { min-height: 46px; border-radius: 12px; }
.blackout-editor__actions :deep(.van-button:only-child) { grid-column: 1 / -1; }
.bulk-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
:deep(.van-calendar) { height: auto !important; }
:deep(.van-calendar__body) { padding-bottom: 12px; }
:deep(.van-calendar__day) {
  height: max(68px, 4.4rem) !important;
  position: relative !important;
  padding-top: 8px !important;
  align-items: flex-start !important;
}
:deep(.van-calendar__top-info) {
  position: absolute !important;
  top: 29px !important;
  left: 3px;
  right: 3px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 9px !important;
  line-height: 1.2;
  text-align: center;
}
:deep(.holiday-day .van-calendar__top-info) { color: #ef4444 !important; font-weight: 700; }
:deep(.cleaning-day .van-calendar__top-info) { color: #f97316 !important; font-weight: 700; }
:deep(.leave-blackout-day) { box-shadow: inset 0 0 0 2px #f7b060; border-radius: 8px; }
:deep(.leave-blackout-day .van-calendar__top-info) { color: #a95a0c !important; font-weight: 800; }
:deep(.van-calendar__bottom-info) {
  position: absolute !important;
  bottom: 7px !important;
  left: 3px;
  right: 3px;
  overflow: hidden;
  padding: 3px 0;
  border-radius: 6px;
  white-space: nowrap;
  font-size: 11px !important;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  text-align: center;
}
:deep(.record-work-day .van-calendar__bottom-info) { color: #167c58 !important; background: #eaf7f0; }
:deep(.record-leave-day .van-calendar__bottom-info) { color: #8290a0 !important; background: #f1f4f8; }
:deep(.has-remark-day) {
  background-color: #fffbeb !important;
  border: 1px dashed #fef3c7 !important;
  border-radius: 6px;
}
:deep(.van-calendar__selected-day) {
  position: absolute;
  top: 3px;
  display: flex !important;
  flex-direction: column !important;
  justify-content: flex-start !important;
  width: calc(100% - 6px) !important;
  height: calc(100% - 6px) !important;
  padding-top: 6px !important;
  border-radius: 10px !important;
  box-sizing: border-box !important;
}
:deep(.van-calendar__selected-day .van-calendar__top-info) { color: #fff !important; }
:deep(.leave-blackout-day .van-calendar__selected-day .van-calendar__top-info) { color: #fff !important; }
:deep(.van-calendar__selected-day .van-calendar__bottom-info) { color: #fff !important; background: rgba(255, 255, 255, .2) !important; }

.workflow { margin-top: 4px; }
.section-card { padding: 18px; border-radius: var(--page-card-radius); background: #fff; box-shadow: 0 12px 28px rgba(29, 66, 106, .07); }
.section-note { margin: 0 0 14px; font-size: 13px; line-height: 1.5; color: #646566; }
:deep(.gross-cell .van-cell__value) { font-weight: 700; color: #1989fa; font-size: 16px; }

.weekly-actions { display: grid; gap: 12px; }
.weekly-actions :deep(.van-button--primary) { min-height: 50px; font-size: 15px; font-weight: 800; box-shadow: 0 8px 20px rgba(25, 137, 250, 0.2); border-radius: 15px; }
.weekly-actions :deep(.van-button--plain) { min-height: 42px; border-radius: 12px; box-shadow: none; }
.empty-state { padding: 30px 16px; text-align: center; }
.empty-state__title { font-size: 14px; font-weight: 700; color: #4b5563; }
.empty-state__text { margin-top: 6px; font-size: 12px; line-height: 1.5; color: #9ca3af; }
.schedule-collapse { overflow: hidden; border: 1px solid #e6edf5; border-radius: 20px; background: #fff; box-shadow: 0 12px 28px rgba(29, 66, 106, .07); }
:deep(.schedule-collapse > .van-collapse-item > .van-cell) { min-height: 62px; padding: 12px 18px; }
.schedule-overview { display: grid; gap: 2px; }
.schedule-overview strong { color: #1b2a3b; font-size: 14px; font-weight: 800; }
.schedule-overview small { color: #8290a0; font-size: 11px; }
:deep(.schedule-collapse > .van-collapse-item > .van-collapse-item__wrapper .van-collapse-item__content) { padding: 0 12px 12px; }
.record-collapse { overflow: hidden; border: 1px solid #e6edf5; border-radius: 13px; }
:deep(.record-collapse .van-cell) { min-height: 48px; padding: 10px 12px; }
:deep(.record-collapse .van-cell__title) { min-width: 0; }
:deep(.record-collapse .van-cell__value) { flex: 0 1 auto; max-width: 50%; margin-left: 8px; }
.schedule-date { color: #1b2a3b; font-size: 13px; font-weight: 800; white-space: nowrap; }
.schedule-date small { margin-left: 3px; color: #8290a0; font-size: 11px; }
.schedule-pay { color: #166dd1; font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
.schedule-detail { padding: 2px 0; }
.schedule-detail__tags { display: flex; flex-wrap: wrap; gap: 6px; }
.schedule-detail p { margin: 8px 0 0; color: #657588; font-size: 12px; line-height: 1.5; }
.schedule-detail__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.schedule-detail__actions :deep(.van-button) { min-height: 34px; border-radius: 9px; }
.weekly-summary-card { padding: 14px 16px 16px; }
.weekly-summary__row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; padding: 6px 0; }
.weekly-summary__label { font-size: 13px; color: #4b5563; }
.weekly-summary__value { margin-left: auto; font-size: 14px; font-weight: 600; color: #1f2937; overflow-wrap: anywhere; }
.weekly-summary__row--tax { padding-top: 12px; margin-top: 8px; border-top: 1px dashed #e5e7eb; }
.weekly-summary__value--tax { color: #b45309; font-weight: bold; }
.weekly-summary__total--net { margin-top: 12px; padding: 16px; border-radius: 14px; background: linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%); border: 1px solid #bbf7d0; }
.weekly-summary__total-label { font-size: 13px; color: #166534; font-weight: bold; }
.weekly-summary__total-value--net { color: #15803d; font-size: 26px; font-weight: 800; margin-top: 4px; overflow-wrap: anywhere; }
.import-export-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
.import-uploader { display: block; }
.import-uploader :deep(.van-uploader__wrapper) { display: block; }
.import-button { border-style: dashed; background: #fef2f2; }
.data-management-collapse { overflow: hidden; border-radius: 16px; background: #fff; box-shadow: 0 4px 14px rgba(15, 23, 42, 0.04); border: 1px solid #ebedf0; }
:deep(.data-management-collapse .van-cell) { padding: 14px 16px; font-weight: bold; }
:deep(.data-management-collapse .van-collapse-item__content) { padding: 14px 16px; background: #fafafa; }
</style>
