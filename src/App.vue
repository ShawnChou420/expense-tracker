<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import * as XLSX from 'xlsx'
import TripTracker from './components/TripTracker.vue'
import ExpenseTracker from './components/ExpenseTracker.vue'
import { formatCalendarAmount } from './utils/calendarMoney.js'
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
import { showToast } from 'vant'

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
const editingRecordId = ref(null)
const records = ref([])
const activeTab = ref('payroll')

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
const calendarMinDate = new Date(2025, 0, 1)
const calendarMaxDate = new Date(2027, 11, 31)

// 點擊日曆上的某一天
const onDateSelect = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  workDate.value = `${year}-${month}-${day}`

  const existingRecord = records.value.find(r => r.workDate === workDate.value)
  if (existingRecord) {
    startTime.value = existingRecord.startTime
    endTime.value = existingRecord.endTime
    shiftType.value = existingRecord.shiftType || 'normal'
    isCleaningDay.value = existingRecord.isCleaningDay || false
    remark.value = existingRecord.remark || '' // 精準回填歷史備註
    return
  }
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
  if (!workDate.value) return
  const current = parseWorkDate(workDate.value)
  const year = current.getFullYear()
  const month = current.getMonth()
  
  // 抓取本月的第一天與最後一天
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  
  bulkAddRecords(firstDay, lastDay)
}

// --- 核心批量寫入引擎 ---
const bulkAddRecords = (startDate, endDate) => {
  const newRecords = []
  let currentDate = new Date(startDate)

  while (currentDate <= endDate) {
    const year = currentDate.getFullYear()
    const month = String(currentDate.getMonth() + 1).padStart(2, '0')
    const day = String(currentDate.getDate()).padStart(2, '0')
    const dateStr = `${year}-${month}-${day}`

    // 檢查這一天是否已經在班表中，如果已經有了就跳過（保護已編輯的資料）
    const exists = records.value.some(r => r.workDate === dateStr)
    
    if (!exists) {
      const defaultShift = getDefaultShiftForDate(currentDate)
      
      // 直接呼叫你原本寫好的生成函數
      const record = buildWorkRecordFromInputs({
        workDate: dateStr,
        startTime: defaultShift.startTime,
        endTime: defaultShift.endTime,
        smokoCountOverride: null, 
        shiftType: defaultShift.shiftType,
        isCleaningDay: defaultShift.isCleaningDay,
        remark: defaultShift.remark
      })
      
      if (record) newRecords.push(record)
    }
    // 推進到下一天
    currentDate.setDate(currentDate.getDate() + 1)
  }

  if (newRecords.length > 0) {
    records.value = [...records.value, ...newRecords]
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

  // 1. 處理上方標籤 (國定假日 / 清潔日)
  if (holidayLabel) {
    day.topInfo = holidayLabel
    day.className = `${day.className || ''} holiday-day`.trim()
  } else if (isTue) {
    day.topInfo = '清潔日'
    day.className = `${day.className || ''} cleaning-day`.trim()
  }

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

// 3. 獨立且固定的參數維持 ref 即可
const ppeAllowance = ref(5.0)
const smokoMinutesPerBreak = ref(30)
const smokoCountOverride = ref(null)

// 備註：你這邊寫 withholdingTaxRate，但薪資單上的 12% 其實是退休金 (Superannuation)。
// 如果這是用來算退休金的，數值 0.12 沒問題；若是算所得稅，澳洲稅金通常是看級距查表的喔！
const withholdingTaxRate = ref(0.12)

watch([workDate, startTime, endTime, shiftType], () => {
  smokoCountOverride.value = null
})

const displayedSmokoCount = computed(() => {
  if (smokoCountOverride.value !== null) return smokoCountOverride.value
  return workSummary.value?.smokoCount ?? 0
})

// --- 5. 新增：提早換裝 5 分鐘打卡開關 ---
const enablePrepTime = ref(true) // 預設開啟

// 修改原本的 effectiveStartTime，加入自動減去 5 分鐘的邏輯
const effectiveStartTime = computed(() => {
  if (shiftType.value === 'leave') return '00:00'
  
  let timeToCalculate = startTime.value
  
  if (enablePrepTime.value) {
    let [hours, minutes] = startTime.value.split(':').map(Number)
    minutes -= 5
    if (minutes < 0) {
      minutes += 60
      hours = (hours - 1 + 24) % 24 // 處理跨日退回前一天的小時
    }
    timeToCalculate = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  }
  
  return timeToCalculate
})

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
  workDate,
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
  remark: inputRemark = ''
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
    return record
  }

  const tempWorkDate = ref(inputWorkDate)
  const tempStartTime = ref(inputStartTime)
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
  return record
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

const isEditingRecord = computed(() => editingRecordId.value !== null)

const sortedRecords = computed(() => {
  return [...records.value].sort((a, b) => {
    if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate)
    return a.startTime.localeCompare(b.startTime)
  })
})

// ======= 備份控制中心與 Excel 生成引擎 =======
const exportTodayJson = () => {
  if (!workSummary.value || !payBreakdown.value) return
  const todayRecord = buildWorkRecordFromInputs({ workDate: workDate.value, startTime: startTime.value, endTime: endTime.value, smokoCountOverride: smokoCountOverride.value, shiftType: shiftType.value, isCleaningDay: isCleaningDay.value, remark: remark.value })
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
      importedRecords.push(...jsonData.map((record) => normalizeWorkRecord(record)).map((record) => { return buildWorkRecordFromInputs({ id: record.id, workDate: record.workDate, startTime: record.startTime, endTime: record.endTime, shiftType: record.shiftType || 'normal', isCleaningDay: record.isCleaningDay || false, remark: record.remark || '' }) ?? record }))
      continue
    }
    const normalizedRecord = normalizeWorkRecord(jsonData)
    importedRecords.push(buildWorkRecordFromInputs({ id: normalizedRecord.id, workDate: normalizedRecord.workDate, startTime: normalizedRecord.startTime, endTime: normalizedRecord.endTime, shiftType: normalizedRecord.shiftType || 'normal', isCleaningDay: normalizedRecord.isCleaningDay || false, remark: normalizedRecord.remark || '' }) ?? normalizedRecord)
  }
  records.value = importedRecords.sort((a, b) => { if (a.workDate === b.workDate) return b.startTime.localeCompare(a.startTime); return b.workDate.localeCompare(a.workDate) })
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

  if (!isEditingRecord.value) {
    const duplicated = records.value.some((r) => r.workDate === workDate.value)
    if (duplicated) {
      editingRecordId.value = records.value.find((r) => r.workDate === workDate.value).id
    }
  }

  const todayRecord = buildWorkRecordFromInputs({
    workDate: workDate.value,
    startTime: startTime.value,
    endTime: endTime.value,
    smokoCountOverride: smokoCountOverride.value,
    shiftType: shiftType.value,
    isCleaningDay: isCleaningDay.value,
    remark: remark.value
  })

  if (!todayRecord) return

  if (isEditingRecord.value) {
    records.value = records.value.map((record) => record.id !== editingRecordId.value ? record : { ...todayRecord, id: record.id })
    editingRecordId.value = null
    return
  }

  records.value.unshift(todayRecord)
  showToast('成功加入排班列表')
}

const editRecord = (record) => {
  editingRecordId.value = record.id
  workDate.value = record.workDate
  startTime.value = record.startTime
  endTime.value = record.endTime
  shiftType.value = record.shiftType || 'normal'
  isCleaningDay.value = record.isCleaningDay || false
  remark.value = record.remark || ''
  scheduleSections.value = []
  expandedRecordId.value = ''
  nextTick(() => workInputSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

const cancelEditingRecord = () => {
  editingRecordId.value = null
  shiftType.value = 'normal'
  remark.value = ''
}

const deleteRecord = (recordId) => {
  records.value = records.value.filter((record) => record.id !== recordId)
  if (editingRecordId.value === recordId) editingRecordId.value = null
  if (expandedRecordId.value === recordId) expandedRecordId.value = ''
}
</script>

<template>
  <div class="page">
    <section v-show="activeTab === 'payroll'" class="payroll-page">
    <div class="header">
      <p class="eyebrow">PAYROLL ESTIMATE</p>
      <div class="header-main">
        <h1>薪資預估</h1>
        <van-button size="small" plain type="primary" class="global-currency-btn" @click="showCurrencyPicker = true">
          {{ currencyFlag }} {{ currentCurrency }}
        </van-button>
      </div>
      <p>選擇工作日期、記錄班表，掌握每週薪資。</p>
    </div>

    <div class="section calendar-section">
      <h2>選擇工作日期</h2>
      <p class="calendar-help">已存班表約值（{{ currentCurrency }}）；精確金額見本週班表</p>
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
        />
      </div>
    </div>

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
          <p class="section-note">確認完上述日期的時間、狀態與備註後，點擊下方按鈕排入班表，即時連動加總週薪明細。</p>
          <div class="weekly-actions">
            <!-- 單日儲存按鈕 -->
            <van-button block type="primary" :icon="isEditingRecord ? 'edit' : 'plus'" @click="addTodayRecordToList">
              {{ isEditingRecord ? '儲存修改' : '加入本週班表' }}
            </van-button>
            
            <!-- 新增：一鍵批次按鈕群 (只有在非編輯模式下才會顯示) -->
            <div style="display: flex; gap: 12px;" v-if="!isEditingRecord">
              <van-button block plain type="primary" @click="fillCurrentWeek">填滿本週</van-button>
              <van-button block plain type="primary" @click="fillCurrentMonth">填滿本月</van-button>
            </div>
            
            <van-button v-if="isEditingRecord" block plain type="default" @click="cancelEditingRecord">取消變更</van-button>
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
        <h2>基本費率設定 (AUD)</h2>
        <van-cell-group inset>
          <van-cell title="Smoko 次數" center>
            <template #right-icon>
              <van-stepper :model-value="displayedSmokoCount" :min="0" :max="3" integer theme="round" button-size="28px" disable-input @change="(val) => { smokoCountOverride = Number(val) }" />
            </template>
          </van-cell>
          <van-field :model-value="formatRate(baseRate)" label="基本時薪" type="number" input-align="right" @update:model-value="(val) => updateRate(baseRate, val, 3)" />
          <van-field :model-value="formatRate(casualLoadingRate)" label="Casual 25%" type="number" input-align="right" @update:model-value="(val) => updateRate(casualLoadingRate, val, 3)" />
          <van-field :model-value="formatRate(shiftLoadingRate)" label="夜班 25%" type="number" input-align="right" @update:model-value="(val) => updateRate(shiftLoadingRate, val, 3)" />
          <van-field :model-value="formatRate(saturdayOrdLoadingRate)" label="Sat ORD 50%" type="number" input-align="right" @update:model-value="(val) => updateRate(saturdayOrdLoadingRate, val, 3)" />
          <van-field :model-value="formatRate(timeHalfRate)" label="T/Half" type="number" input-align="right" @update:model-value="(val) => updateRate(timeHalfRate, val, 3)" />
          <van-field :model-value="formatRate(doubleRate)" label="Double" type="number" input-align="right" @update:model-value="(val) => updateRate(doubleRate, val, 3)" />
          <van-field :model-value="formatRate(sundayLoadingRate)" label="星期日 75%" type="number" input-align="right" @update:model-value="(val) => updateRate(sundayLoadingRate, val, 3)" />
          <van-field :model-value="formatRate(ppeAllowance)" label="PPE 每週津貼" type="number" input-align="right" @update:model-value="(val) => updateRate(ppeAllowance, val, 2)" />
        </van-cell-group>
      </div>

      <div class="section">
        <h2>班表明細</h2>
        <div v-if="records.length === 0" class="section-card empty-state">
          <div class="empty-state__title">目前無排程紀錄</div>
          <div class="empty-state__text">請在上方日曆選取日期、設定完工時後點擊「加入本週班表」。</div>
        </div>
        <van-collapse v-else v-model="scheduleSections" class="schedule-collapse">
          <van-collapse-item name="records">
            <template #title>
              <div class="schedule-overview">
                <strong>查看 {{ records.length }} 筆班表</strong>
                <small>依日期排列，點選單筆查看明細</small>
              </div>
            </template>
            <van-collapse v-model="expandedRecordId" accordion class="record-collapse">
              <van-collapse-item v-for="record in sortedRecords" :key="record.id" :name="record.id">
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
    <ExpenseTracker v-show="activeTab === 'expenses'" />

    <van-tabbar v-model="activeTab" fixed placeholder safe-area-inset-bottom>
      <van-tabbar-item name="payroll" icon="balance-o">薪資</van-tabbar-item>
      <van-tabbar-item name="trips" icon="friends-o">車資</van-tabbar-item>
      <van-tabbar-item name="expenses" icon="records">支出</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<style scoped>
.page { min-height: 100vh; background: #f5f7fa; }
.payroll-page { max-width: 820px; min-height: 100vh; margin: 0 auto; padding: 20px 0 calc(92px + env(safe-area-inset-bottom)); background: radial-gradient(circle at 12% 0, #e8f4ff 0, transparent 260px), #f5f7fa; }
.header { padding: 0 18px 12px; }
.header .eyebrow { margin: 0 0 5px; color: #6883a1; font-size: 10px; font-weight: 800; letter-spacing: .14em; }
.header-main { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 8px; }
.header h1 { margin: 0; font-size: 29px; line-height: 1.2; font-weight: 800; color: #1b2a3b; }
.header p:not(.eyebrow) { margin: 0; color: #657588; font-size: 13px; line-height: 1.4; }
.global-currency-btn { flex: none; min-height: 38px; font-weight: 700; border-radius: 12px; background: #fff; box-shadow: 0 2px 8px rgba(29, 66, 106, .06); }

.section { margin-top: 28px; }
.section h2 { font-size: 19px; font-weight: 800; color: #1b2a3b; margin: 0 0 12px; padding: 0 18px; letter-spacing: -.02em; }
.calendar-section { margin-top: 16px; }
.calendar-help { margin: -4px 18px 12px; color: #657588; font-size: 11px; line-height: 1.4; }

.calendar-wrapper { margin: 0 16px; border-radius: 22px; overflow: hidden; box-shadow: 0 12px 28px rgba(29, 66, 106, .07); background: #fff; border: 1px solid #e6edf5; }
:deep(.van-calendar) { height: auto !important; }
:deep(.van-calendar__body) { padding-bottom: 12px; }
:deep(.van-calendar__day) {
  height: 78px !important;
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
:deep(.van-calendar__selected-day .van-calendar__bottom-info) { color: #fff !important; background: rgba(255, 255, 255, .2) !important; }

.workflow { margin-top: 4px; }
.section-card { margin: 0 16px; padding: 18px; border-radius: 22px; background: #fff; box-shadow: 0 12px 28px rgba(29, 66, 106, .07); }
.section-note { margin: 0 0 14px; font-size: 13px; line-height: 1.5; color: #646566; }
:deep(.gross-cell .van-cell__value) { font-weight: 700; color: #1989fa; font-size: 16px; }

.weekly-actions { display: grid; gap: 12px; }
.weekly-actions :deep(.van-button--primary) { min-height: 50px; font-size: 15px; font-weight: 800; box-shadow: 0 8px 20px rgba(25, 137, 250, 0.2); border-radius: 15px; }
.weekly-actions :deep(.van-button--plain) { min-height: 42px; border-radius: 12px; box-shadow: none; }
.empty-state { padding: 30px 16px; text-align: center; }
.empty-state__title { font-size: 14px; font-weight: 700; color: #4b5563; }
.empty-state__text { margin-top: 6px; font-size: 12px; line-height: 1.5; color: #9ca3af; }
.schedule-collapse { margin: 0 16px; overflow: hidden; border: 1px solid #e6edf5; border-radius: 20px; background: #fff; box-shadow: 0 12px 28px rgba(29, 66, 106, .07); }
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
.weekly-summary__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 0; }
.weekly-summary__label { font-size: 13px; color: #4b5563; }
.weekly-summary__value { font-size: 14px; font-weight: 600; color: #1f2937; }
.weekly-summary__row--tax { padding-top: 12px; margin-top: 8px; border-top: 1px dashed #e5e7eb; }
.weekly-summary__value--tax { color: #b45309; font-weight: bold; }
.weekly-summary__total--net { margin-top: 12px; padding: 16px; border-radius: 14px; background: linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%); border: 1px solid #bbf7d0; }
.weekly-summary__total-label { font-size: 13px; color: #166534; font-weight: bold; }
.weekly-summary__total-value--net { color: #15803d; font-size: 26px; font-weight: 800; margin-top: 4px; }
.import-export-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
.import-uploader { display: block; }
.import-uploader :deep(.van-uploader__wrapper) { display: block; }
.import-button { border-style: dashed; background: #fef2f2; }
.data-management-collapse { margin: 0 16px; overflow: hidden; border-radius: 16px; background: #fff; box-shadow: 0 4px 14px rgba(15, 23, 42, 0.04); border: 1px solid #ebedf0; }
:deep(.data-management-collapse .van-cell) { padding: 14px 16px; font-weight: bold; }
:deep(.data-management-collapse .van-collapse-item__content) { padding: 14px 16px; background: #fafafa; }
</style>
