<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import * as XLSX from 'xlsx'
import { useShiftCalculator } from './composables/useShiftCalculator.js'
import {
  formatHours,
  formatMoney,
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
const editingRecordId = ref(null)
const records = ref([])

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

  const dayOfWeek = date.getDay()
  shiftType.value = 'normal'
  remark.value = '' // 全新的一天清空備註输入框

  if (dayOfWeek === 0) {
    startTime.value = '20:45'
    endTime.value = '05:45'
  } else if (dayOfWeek === 1) {
    startTime.value = '23:40'
    endTime.value = '06:00'
  } else if (dayOfWeek === 2) {
    startTime.value = '17:45'
    endTime.value = '00:00'
  } else if (dayOfWeek === 3 || dayOfWeek === 4) {
    startTime.value = '23:50'
    endTime.value = '06:00'
  } else if (dayOfWeek === 5) {
    startTime.value = '23:50'
    endTime.value = '07:00'
  } else if (dayOfWeek === 6) {
    shiftType.value = 'leave'
    startTime.value = '00:00'
    endTime.value = '00:00'
  }
}

const selectedHolidayLabel = computed(() => {
  if (!workDate.value) return ''
  return getNswPublicHolidayLabel(parseWorkDate(workDate.value))
})

// ✨ 日曆格式化：支援國定假日、清潔日、金額、備註特殊金底色堆疊
const holidayCalendarFormatter = (day) => {
  if (!day.date) return day

  const year = day.date.getFullYear()
  const month = String(day.date.getMonth() + 1).padStart(2, '0')
  const dayNum = String(day.date.getDate()).padStart(2, '0')
  const dateStr = `${year}-${month}-${dayNum}`

  const holidayLabel = getNswPublicHolidayShortLabel(day.date)
  const isTue = day.date.getDay() === 2

  let infoParts = []
  let isHoliday = false

  if (holidayLabel) {
    infoParts.push(holidayLabel)
    isHoliday = true
  } else if (isTue) {
    infoParts.push('清潔日')
  }

  const record = records.value.find((r) => r.workDate === dateStr)
  let classNames = []

  if (record) {
    if (record.shiftType === 'leave') {
      infoParts.push('休假')
    } else {
      const convertedPay = record.grossPay * currentExchangeRate.value
      infoParts.push(`+${currencySymbol.value}${formatMoney(convertedPay)}`)
    }
    classNames.push(record.shiftType === 'leave' ? 'record-leave-day' : 'record-work-day')
    
    // 💡 核心亮點：若該日期含有備註，塞入專屬的識別 class
    if (record.remark && record.remark.trim() !== '') {
      classNames.push('has-remark-day')
    }
  }

  day.bottomInfo = infoParts.join('\n')
  
  if (isHoliday) classNames.push('holiday-day')
  if (isTue) classNames.push('cleaning-day')
  
  day.className = `${day.className || ''} ${classNames.join(' ')}`.trim()
  return day
}

const updateRate = (targetRef, value, digits = 3) => {
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return
  targetRef.value = roundTo(parsed, digits)
}

// --- 費率設定 ---
const baseRate = ref(25.06)
const casualLoadingRate = ref(6.265)
const shiftLoadingRate = ref(6.265)
const saturdayOrdLoadingRate = ref(12.53)
const timeHalfRate = ref(37.59)
const doubleRate = ref(50.12)
const sundayLoadingRate = ref(18.795)
const ppeAllowance = ref(5.0)
const smokoMinutesPerBreak = ref(30)
const smokoCountOverride = ref(null)
const withholdingTaxRate = ref(0.12)

const handleStartTimeInput = (value) => { startTime.value = sanitizeTimeInput(value) }
const handleEndTimeInput = (value) => { endTime.value = sanitizeTimeInput(value) }
const handleStartTimeBlur = () => { startTime.value = normalizeTimeInput(startTime.value) }
const handleEndTimeBlur = () => { endTime.value = normalizeTimeInput(endTime.value) }

watch([workDate, startTime, endTime, shiftType], () => {
  smokoCountOverride.value = null
})

const displayedSmokoCount = computed(() => {
  if (smokoCountOverride.value !== null) return smokoCountOverride.value
  return workSummary.value?.smokoCount ?? 0
})

const effectiveStartTime = computed(() => shiftType.value === 'leave' ? '00:00' : startTime.value)
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
}

const cancelEditingRecord = () => {
  editingRecordId.value = null
  shiftType.value = 'normal'
  remark.value = ''
}

const deleteRecord = (recordId) => {
  records.value = records.value.filter((record) => record.id !== recordId)
  if (editingRecordId.value === recordId) editingRecordId.value = null
}
</script>

<template>
  <div class="page">
    
    <div class="header">
      <div class="header-main">
        <h1>薪資計算與排班預估</h1>
        <van-button size="small" plain type="primary" class="global-currency-btn" @click="showCurrencyPicker = true">
          {{ currencyFlag }} {{ currentCurrency }}
        </van-button>
      </div>
      <p>點擊日曆日期預填時間。可自由編輯請假、填寫自訂備註，所有數據全域即時換算。</p>
    </div>

    <div class="section calendar-section">
      <h2>1. 選擇或點擊日期</h2>
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

    <div class="section">
      <h2>2. 設定當日出勤狀態與時間</h2>
      
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
        <h2>3. 班表存檔操作</h2>
        <div class="section-card">
          <p class="section-note">確認完上述日期的時間、狀態與備註後，點擊下方按鈕排入班表，即時連動加總週薪明細。</p>
          <div class="weekly-actions">
            <van-button block type="primary" @click="addTodayRecordToList">
              {{ isEditingRecord ? '💾 儲存並更新修改內容' : '➕ 確定排入本週班表' }}
            </van-button>
            <van-button v-if="isEditingRecord" block plain type="default" @click="cancelEditingRecord">取消變更</van-button>
          </div>
        </div>
      </div>

      <div class="section" v-if="workSummary && shiftType !== 'leave'">
        <h2>4. 當日明細預估 ({{ currentCurrency }})</h2>
        <van-cell-group inset style="margin-bottom: 12px;">
          <van-cell title="實際計薪總工時" :value="`${formatHours(workSummary.paidMinutes)} 小時`" value-class="highlight-blue" />
          <van-cell title="夜班津貼判定" :value="isNightShift ? '有符合' : '無符合'" />
          <van-cell title="自動算 Smoko 次數" :value="`${workSummary.smokoCount} 次`" />
        </van-cell-group>
        <van-cell-group inset>
          <van-cell title="Base Pay (基本)" :value="`${currencySymbol}${formatMoney(payBreakdown.basePay * currentExchangeRate)}`" />
          <van-cell title="CASUAL LOADING 25%" :value="`${currencySymbol}${formatMoney(payBreakdown.casualPay * currentExchangeRate)}`" />
          <van-cell v-if="payBreakdown.shiftPay > 0" title="SHIFT 夜班 25%" :value="`${currencySymbol}${formatMoney(payBreakdown.shiftPay * currentExchangeRate)}`" />
          <van-cell v-if="payBreakdown.holidayPenaltyPay > 0" title="P/HOL 150%" :value="`${currencySymbol}${formatMoney(payBreakdown.holidayPenaltyPay * currentExchangeRate)}`" />
          <van-cell title="SAT ORD 50%" :value="`${currencySymbol}${formatMoney(payBreakdown.satOrdPay * currentExchangeRate)}`" />
          <van-cell title="T/Half (1.5倍)" :value="`${currencySymbol}${formatMoney(payBreakdown.timeHalfPay * currentExchangeRate)}`" />
          <van-cell title="Double (2倍)" :value="`${currencySymbol}${formatMoney(payBreakdown.doublePay * currentExchangeRate)}`" />
          <van-cell title="SUN ORD 75%" :value="`${currencySymbol}${formatMoney(payBreakdown.sunOrdPay * currentExchangeRate)}`" />
          <van-cell title="當日總薪資 (稅前)" :value="`${currencySymbol}${formatMoney(payBreakdown.grossPay * currentExchangeRate)}`" class="gross-cell" />
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
        <h2>本週排定班表明細 ({{ currentCurrency }})</h2>
        <div class="section-card section-card--tight">
          <div v-if="records.length === 0" class="empty-state">
            <div class="empty-state__title">目前無排程紀錄</div>
            <div class="empty-state__text">請在上方日曆選取日期、設定完工時後點擊「確定排入本週班表」。</div>
          </div>

          <div v-else>
            <div v-for="record in sortedRecords" :key="record.id" class="weekly-record">
              <div class="weekly-record__top">
                <div>
                  <div class="weekly-record__date">
                    {{ record.workDate }} ({{ getDayOfWeek(record.workDate) }})
                    <van-tag v-if="record.shiftType === 'leave'" type="danger" style="margin-left: 6px;">請假</van-tag>
                    <van-tag v-if="record.isCleaningDay" type="success" style="margin-left: 6px;">清潔日</van-tag>
                  </div>
                  <div class="weekly-record__time" v-if="record.shiftType !== 'leave'">
                    ⏱️ {{ record.startTime }} - {{ record.endTime }}
                  </div>
                  <div v-if="record.remark" style="font-size: 12px; color: #b45309; margin-top: 4px; font-weight: 500;">
                    📝 備註：{{ record.remark }}
                  </div>
                </div>
                <div class="weekly-record__pay">
                  {{ currencySymbol }}{{ formatMoney(record.grossPay * currentExchangeRate) }}
                </div>
              </div>
              <div class="weekly-record__meta" v-if="record.shiftType !== 'leave'">
                <span>計薪 {{ formatHours(record.paidMinutes) }} 小時</span>
                <span v-if="record.shiftPay > 0">夜班</span>
              </div>
              <div class="weekly-record__actions">
                <van-button size="small" plain type="primary" @click="editRecord(record)">修改工時</van-button>
                <van-button size="small" plain type="danger" @click="deleteRecord(record.id)">移除</van-button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>本週整體財務預估總結</h2>
        <div class="section-card weekly-summary-card">
          <div class="weekly-summary__row">
            <span class="weekly-summary__label">本週班表薪資小計 ({{ currentCurrency }})</span>
            <span class="weekly-summary__value">{{ currencySymbol }}{{ formatMoney(weeklySubtotal * currentExchangeRate) }}</span>
          </div>
          <div class="weekly-summary__row">
            <span class="weekly-summary__label">PPE 工具補助津貼 ({{ currentCurrency }})</span>
            <span class="weekly-summary__value">{{ currencySymbol }}{{ formatMoney(weeklyPPE * currentExchangeRate) }}</span>
          </div>
          <div class="weekly-summary__row" style="margin-top: 8px; border-top: 1px dashed #ebedf0; padding-top: 8px;">
            <span class="weekly-summary__label" style="font-size: 13px; color: #646566;">本週預估總薪資（稅前）({{ currentCurrency }})</span>
            <span class="weekly-summary__value" style="font-size: 14px; color: #646566; font-weight: 500;">{{ currencySymbol }}{{ formatMoney(weeklyTotal * currentExchangeRate) }}</span>
          </div>
          <div class="weekly-summary__row weekly-summary__row--tax" style="margin-bottom: 8px;">
            <span class="weekly-summary__label">預估扣稅扣繳 12% ({{ currentCurrency }})</span>
            <span class="weekly-summary__value weekly-summary__value--tax">-${{ currencySymbol }}{{ formatMoney(weeklyTaxEstimate * currentExchangeRate) }}</span>
          </div>
          <div class="weekly-summary__total weekly-summary__total--net">
            <div class="weekly-summary__total-label">本週實領預估（稅後淨所得）</div>
            <div class="weekly-summary__total-value weekly-summary__total-value--net">
              <span style="margin-right: 4px;">{{ currencyFlag }}</span>
              {{ currencySymbol }}{{ formatMoney(convertedNetTotal) }}
              <span style="font-size: 14px; font-weight: normal; color: #15803d; margin-left: 2px;">{{ currentCurrency }}</span>
            </div>
            <div v-if="currentCurrency !== 'AUD'" style="font-size: 12px; color: #15803d; margin-top: 6px; font-weight: normal; text-align: right; opacity: 0.8;">
              匯率即時參考: 1 AUD = {{ exchangeRates[currentCurrency] }} {{ currentCurrency }}
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>資料備份與傳輸管理</h2>
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
  </div>

  <van-popup v-model:show="showCurrencyPicker" position="bottom" round>
    <van-picker title="選擇全域對照外幣" :columns="currencyColumns" @confirm="onCurrencyConfirm" @cancel="showCurrencyPicker = false" />
  </van-popup>
</template>

<style scoped>
.page { min-height: 100vh; background: #f7f8fa; padding: 20px 0 40px; }
.header { padding: 0 16px 12px; }
.header-main { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.header h1 { margin: 0; font-size: 24px; font-weight: 800; color: #1f2937; }
.header p { margin: 0; color: #6b7280; font-size: 13px; line-height: 1.4; }
.global-currency-btn { font-weight: bold; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }

.section { margin-top: 20px; }
.section h2 { font-size: 14px; font-weight: bold; color: #4b5563; margin: 0 0 8px; padding: 0 16px; text-transform: uppercase; letter-spacing: 0.5px; }
.calendar-section { margin-top: 10px; }

/* 🌟 日曆 UI 終極鎖定：徹底阻斷選中時位移往左跑的 BUG */
.calendar-wrapper { margin: 0 16px; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 14px rgba(15, 23, 42, 0.05); background: #fff; border: 1px solid #ebedf0; }
:deep(.van-calendar) { height: auto !important; }
:deep(.van-calendar__body) { padding-bottom: 12px; }

:deep(.van-calendar__day) { 
  height: 82px !important; /* 稍微再調高一點，留給備註與堆疊充足的空間 */
  display: flex !important;
  flex-direction: column !important;
  justify-content: flex-start !important;
  align-items: center !important;
  padding-top: 8px !important; 
  box-sizing: border-box !important; /* 強制盒子計算包含內邊距，防止點擊時抖動 */
}

:deep(.van-calendar__bottom-info) { 
  position: relative !important; /* 捨棄絕對定位 */
  bottom: auto !important;
  margin-top: 4px;
  white-space: pre-wrap !important; /* 完美解讀 \n 換行 */
  line-height: 1.3 !important; 
  font-size: 9px !important; 
  font-weight: 700;
  text-align: center;
}

/* ✨ 新增：當含有自訂備註時，日曆格染上極具質感的奶油香檳金底色 */
:deep(.has-remark-day) {
  background-color: #fffbeb !important; 
  border: 1px dashed #fef3c7 !important;
  border-radius: 6px;
}

.workflow { margin-top: 4px; }
.section-card { margin: 0 16px; padding: 16px; border-radius: 16px; background: #fff; box-shadow: 0 6px 20px rgba(15, 23, 42, 0.05); }
.section-card--tight { padding: 0; overflow: hidden; background: #fff; }
.section-note { margin: 0 0 14px; font-size: 13px; line-height: 1.5; color: #646566; }
:deep(.gross-cell .van-cell__value) { font-weight: 700; color: #1989fa; font-size: 16px; }

/* 日曆狀態配色客製化 */
:deep(.holiday-day) { color: #ee0a24 !important; font-weight: bold; }
:deep(.holiday-day .van-calendar__bottom-info) { color: #ee0a24; }
:deep(.cleaning-day) { color: #b45309 !important; }
:deep(.cleaning-day .van-calendar__bottom-info) { color: #b45309; }
:deep(.record-work-day .van-calendar__bottom-info) { color: #16a34a !important; } 
:deep(.record-leave-day .van-calendar__bottom-info) { color: #9ca3af !important; }

.holiday-text { color: #ee0a24 !important; font-weight: bold; }
.cleaning-text { color: #b45309 !important; font-weight: bold; }
:deep(.highlight-blue) { color: #1989fa !important; font-weight: bold; }

.weekly-actions { display: grid; gap: 12px; }
.weekly-actions :deep(.van-button--primary) { min-height: 46px; font-size: 15px; font-weight: 700; box-shadow: 0 8px 20px rgba(25, 137, 250, 0.2); border-radius: 12px; }
.empty-state { padding: 30px 16px; text-align: center; }
.empty-state__title { font-size: 14px; font-weight: 700; color: #4b5563; }
.empty-state__text { margin-top: 6px; font-size: 12px; line-height: 1.5; color: #9ca3af; }
.weekly-record { margin: 12px; padding: 14px; border-radius: 14px; background: #ffffff; border: 1px solid #eef2f7; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.03); }
.weekly-record__top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.weekly-record__date { font-size: 14px; font-weight: 700; color: #1f2937; display: flex; align-items: center; }
.weekly-record__pay { font-size: 20px; font-weight: 800; color: #1989fa; }
.weekly-record__time { margin-top: 6px; font-size: 13px; color: #4b5563; }
.weekly-record__meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.weekly-record__meta span { padding: 4px 8px; border-radius: 999px; background: #f3f4f6; font-size: 11px; font-weight: 600; color: #4b5563; }
.weekly-record__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
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
/* ========== 修正藍色選取框爆版問題 ========== */

/* 1. 強制讓選中時的藍色方塊撐滿我們自訂的格子高度，並將文字靠上對齊 */
:deep(.van-calendar__selected-day) {
  width: calc(100% - 6px) !important;
  height: calc(100% - 6px) !important;
  border-radius: 8px !important;
  display: flex !important;
  flex-direction: column !important;
  justify-content: flex-start !important;
  padding-top: 6px !important;
  box-sizing: border-box !important;
}

/* 2. 當處於選中狀態（藍色底）時，確保底下所有的金額、備註字體都變成白色，避免對比度不佳看不清楚 */
:deep(.van-calendar__selected-day .van-calendar__bottom-info) {
  color: #ffffff !important;
}
</style>