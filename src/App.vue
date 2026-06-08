<script setup>
import { ref, computed } from 'vue'
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
import { onMounted } from 'vue'

// --- 新增：控制時間選擇器彈出視窗的開關 ---
const showStartTimePicker = ref(false)
const showEndTimePicker = ref(false)

// --- 新增：過濾器，讓分鐘只顯示 5 的倍數 ---
const filterTime = (type, options) => {
  if (type === 'minute') {
    return options.filter((option) => Number(option.value) % 5 === 0)
  }
  return options
}

// 當使用者在選擇器按下確認時的處理
const onStartTimeConfirm = ({ selectedValues }) => {
  startTime.value = selectedValues.join(':') // 把 ['08', '05'] 變成 '08:05'
  showStartTimePicker.value = false
}

const onEndTimeConfirm = ({ selectedValues }) => {
  endTime.value = selectedValues.join(':')
  showEndTimePicker.value = false
  }

// --- 新增幣別與匯率相關狀態 ---
const currentCurrency = ref('AUD')
const showCurrencyPicker = ref(false)
const exchangeRates = ref({ AUD: 1 }) // 預設澳幣為 1

// 幣別選單
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

// 擴充所有幣別的貨幣符號對照表
const currencySymbol = computed(() => {
  const symbols = { 
    AUD: '$', 
    NZD: 'NZ$', 
    TWD: 'NT$', 
    CNY: '¥', 
    KRW: '₩', 
    THB: '฿', 
    VND: '₫', 
    USD: 'US$', 
    CAD: 'CA$' 
  }
  return symbols[currentCurrency.value] || '$'
})

// ✨ 新增：自動根據當前幣別抓取國旗 Emoji
const currencyFlag = computed(() => {
  const flags = {
    AUD: '🇦🇺',
    NZD: '🇳🇿',
    TWD: '🇹🇼',
    CNY: '🇨🇳',
    KRW: '🇰🇷',
    THB: '🇹🇭',
    VND: '🇻🇳',
    USD: '🇺🇸',
    CAD: '🇨🇦'
  }
  return flags[currentCurrency.value] || '🪙'
})

// 取得公開的即時匯率
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

// 元件載入時去抓匯率
onMounted(() => {
  fetchExchangeRates()
})

const onCurrencyConfirm = ({ selectedOptions }) => {
  currentCurrency.value = selectedOptions[0].value
  showCurrencyPicker.value = false
}

// --- 計算換算後的最終金額 ---
const convertedNetTotal = computed(() => {
  const rate = exchangeRates.value[currentCurrency.value] || 1
  return roundTo(weeklyNetTotal.value * rate, 2)
})

const workDate = ref(getTodayDate())
const startTime = ref('23:45')
const endTime = ref('06:00')
const showDatePicker = ref(false)
const dataManagementSections = ref([])
const editingRecordId = ref(null)
const records = ref([])

const confirmDate = (selectedDate) => {
  const year = selectedDate.getFullYear()
  const month = String(selectedDate.getMonth() + 1).padStart(2, '0')
  const day = String(selectedDate.getDate()).padStart(2, '0')

  workDate.value = `${year}-${month}-${day}`
  showDatePicker.value = false
}

const parseWorkDate = (dateText) => {
  const [year, month, day] = dateText.split('-').map(Number)
  return new Date(year, month - 1, day)
}

const calendarDefaultDate = computed(() => parseWorkDate(workDate.value))
const calendarMinDate = new Date(2025, 0, 1)
const calendarMaxDate = new Date(2027, 11, 31)

const selectedHolidayLabel = computed(() => {
  if (!workDate.value) return ''
  return getNswPublicHolidayLabel(parseWorkDate(workDate.value))
})

const holidayCalendarFormatter = (day) => {
  if (!day.date) return day

  const holidayLabel = getNswPublicHolidayShortLabel(day.date)

  if (!holidayLabel) return day

  return {
    ...day,
    className: `${day.className || ''} holiday-day`.trim(),
    bottomInfo: holidayLabel,
  }
}

const updateRate = (targetRef, value, digits = 3) => {
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return
  targetRef.value = roundTo(parsed, digits)
}

const baseRate = ref(25.06)
const casualLoadingRate = ref(6.265)
const shiftLoadingRate = ref(6.265)
const saturdayOrdLoadingRate = ref(12.53)
const timeHalfRate = ref(37.59)
const doubleRate = ref(50.12)
const sundayLoadingRate = ref(18.795)
const ppeAllowance = ref(5.0)
const smokoMinutesPerBreak = ref(30)
const withholdingTaxRate = ref(0.12)

const handleStartTimeInput = (value) => {
  startTime.value = sanitizeTimeInput(value)
}

const handleEndTimeInput = (value) => {
  endTime.value = sanitizeTimeInput(value)
}

const handleStartTimeBlur = () => {
  startTime.value = normalizeTimeInput(startTime.value)
}

const handleEndTimeBlur = () => {
  endTime.value = normalizeTimeInput(endTime.value)
}

const startTimeError = computed(() => {
  if (!startTime.value) return ''
  return isValidTime(startTime.value) ? '' : '請輸入合法時間，例如 21:43'
})

const endTimeError = computed(() => {
  if (!endTime.value) return ''
  return isValidTime(endTime.value) ? '' : '請輸入合法時間，例如 03:42'
})

const {
  workSummary,
  isNightShift,
  holidaySummary,
  paidSegmentedMinutes,
  saturdayRuleBreakdown,
  payBreakdown,
} = useShiftCalculator({
  workDate,
  startTime,
  endTime,
  smokoMinutesPerBreak,
  baseRate,
  casualLoadingRate,
  shiftLoadingRate,
  saturdayOrdLoadingRate,
  timeHalfRate,
  doubleRate,
  sundayLoadingRate,
})

const buildWorkRecordFromInputs = ({
  id,
  workDate: inputWorkDate,
  startTime: inputStartTime,
  endTime: inputEndTime,
}) => {
  const tempWorkDate = ref(inputWorkDate)
  const tempStartTime = ref(inputStartTime)
  const tempEndTime = ref(inputEndTime)

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
    baseRate,
    casualLoadingRate,
    shiftLoadingRate,
    saturdayOrdLoadingRate,
    timeHalfRate,
    doubleRate,
    sundayLoadingRate,
  })

  if (!tempWorkSummary.value || !tempPayBreakdown.value) return null

  return createWorkRecord({
    id,
    workDate: inputWorkDate,
    startTime: inputStartTime,
    endTime: inputEndTime,
    workSummary: tempWorkSummary.value,
    paidSegmentedMinutes: tempPaidSegmentedMinutes.value,
    saturdayRuleBreakdown: tempSaturdayRuleBreakdown.value,
    payBreakdown: tempPayBreakdown.value,
  })
}

/**
 * 本週薪資小計
 * 目前仍依 records 直接加總，不額外做週別切分。
 *
 * 假設：
 * - 「本週列表」以使用者手動加入或匯入的內容為準。
 * - 不根據日期自動判斷 payroll week，避免默默改變你的薪資規則。
 */
const weeklySubtotal = computed(() => {
  return roundTo(
    records.value.reduce((sum, record) => sum + record.grossPay, 0),
    2,
  )
})

/**
 * PPE 為每週一次。
 *
 * 假設：
 * - 只要本週列表中至少有一筆 WorkRecord，就加一次 PPE。
 * - 目前不依日期拆不同週次，維持你原本的規則。
 */
const weeklyPPE = computed(() => {
  return records.value.length > 0 ? roundTo(ppeAllowance.value, 2) : 0
})

const weeklyTotal = computed(() => {
  return roundTo(weeklySubtotal.value + weeklyPPE.value, 2)
})

/**
 * 預扣稅估算
 *
 * 假設：
 * - 目前先依使用者這期 payslip 的 12% 扣稅比例估算。
 * - 這是週總結層級的預估值，不回推到單日 WorkRecord。
 * - 未納入澳洲實際 withholding table、super 或其他稅務調整。
 */
const weeklyTaxEstimate = computed(() => {
  return roundTo(weeklyTotal.value * withholdingTaxRate.value, 2)
})

const weeklyNetTotal = computed(() => {
  return roundTo(weeklyTotal.value - weeklyTaxEstimate.value, 2)
})

const isEditingRecord = computed(() => editingRecordId.value !== null)

/**
 * 本週列表顯示順序：
 * - 日期由早到晚
 * - 同一天再依開始時間由早到晚
 *
 * 這裡只調整 UI 顯示順序，不改 records 原本保存的資料內容。
 */
const sortedRecords = computed(() => {
  return [...records.value].sort((a, b) => {
    if (a.workDate !== b.workDate) {
      return a.workDate.localeCompare(b.workDate)
    }

    return a.startTime.localeCompare(b.startTime)
  })
})

/**
 * =========================================================
 * 匯入 / 匯出 / 列表操作
 * 負責單日 JSON、週 XLSX、列表暫存
 * =========================================================
 */

/**
 * 匯出今日薪資紀錄為 JSON
 */
const exportTodayJson = () => {
  if (!workSummary.value || !payBreakdown.value) return

  const todayRecord = buildWorkRecordFromInputs({
    workDate: workDate.value,
    startTime: startTime.value,
    endTime: endTime.value,
  })

  if (!todayRecord) return

  const jsonString = JSON.stringify(todayRecord, null, 2)
  const blob = new Blob([jsonString], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = `${workDate.value}.json`
  link.click()

  URL.revokeObjectURL(url)
}

const exportWeeklyJson = () => {
  if (records.value.length === 0) return

  const jsonString = JSON.stringify(records.value, null, 2)
  const blob = new Blob([jsonString], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = 'weekly-records.json'
  link.click()

  URL.revokeObjectURL(url)
}

/**
 * 匯入多個 JSON 檔，轉成 records 列表
 */
const importJsonFiles = async (payload) => {
  const uploaderFiles = Array.isArray(payload) ? payload : [payload]
  const eventFiles = Array.from(payload?.target?.files || [])
  const files = eventFiles.length > 0
    ? eventFiles
    : uploaderFiles
        .map((item) => item?.file || item)
        .filter(Boolean)

  const importedRecords = []

  for (const file of files) {
    const text = await file.text()
    const jsonData = JSON.parse(text)

    if (Array.isArray(jsonData)) {
      importedRecords.push(
        ...jsonData
          .map((record) => normalizeWorkRecord(record))
          .map((record) => {
            return buildWorkRecordFromInputs({
              id: record.id,
              workDate: record.workDate,
              startTime: record.startTime,
              endTime: record.endTime,
            }) ?? record
          }),
      )
      continue
    }

    const normalizedRecord = normalizeWorkRecord(jsonData)
    importedRecords.push(
      buildWorkRecordFromInputs({
        id: normalizedRecord.id,
        workDate: normalizedRecord.workDate,
        startTime: normalizedRecord.startTime,
        endTime: normalizedRecord.endTime,
      }) ?? normalizedRecord,
    )
  }

  records.value = importedRecords.sort((a, b) => {
    if (a.workDate === b.workDate) {
      return b.startTime.localeCompare(a.startTime)
    }

    return b.workDate.localeCompare(a.workDate)
  })
}

/**
 * 匯出本週列表為 XLSX
 */
const exportWeeklyXlsx = () => {
  if (records.value.length === 0) return

  const sortedExportRecords = [...records.value].sort((a, b) => {
    if (a.workDate !== b.workDate) {
      return a.workDate.localeCompare(b.workDate)
    }

    return a.startTime.localeCompare(b.startTime)
  })

  let cumulativePaidHours = 0
  const totalRawMinutes = sortedExportRecords.reduce((sum, record) => sum + record.totalMinutes, 0)
  const totalSmokoCount = sortedExportRecords.reduce((sum, record) => sum + record.smokoCount, 0)
  const totalSmokoDeductMinutes = sortedExportRecords.reduce((sum, record) => sum + record.smokoDeductMinutes, 0)
  const totalPaidMinutes = sortedExportRecords.reduce((sum, record) => sum + record.paidMinutes, 0)
  const totalWeekdayMinutes = sortedExportRecords.reduce((sum, record) => sum + record.weekdayPaidMinutes, 0)
  const totalSaturdayMinutes = sortedExportRecords.reduce((sum, record) => sum + record.saturdayPaidMinutes, 0)
  const totalSundayMinutes = sortedExportRecords.reduce((sum, record) => sum + record.sundayPaidMinutes, 0)
  const totalHolidayMinutes = sortedExportRecords.reduce((sum, record) => sum + record.holidayPaidMinutes, 0)
  const totalSatOrdMinutes = sortedExportRecords.reduce((sum, record) => sum + record.satOrdMinutes, 0)
  const totalTimeHalfMinutes = sortedExportRecords.reduce((sum, record) => sum + record.timeHalfMinutes, 0)
  const totalDoubleMinutes = sortedExportRecords.reduce((sum, record) => sum + record.doubleMinutes, 0)
  const totalBasePay = roundTo(sortedExportRecords.reduce((sum, record) => sum + record.basePay, 0), 2)
  const totalCasualPay = roundTo(sortedExportRecords.reduce((sum, record) => sum + record.casualPay, 0), 2)
  const totalShiftPay = roundTo(sortedExportRecords.reduce((sum, record) => sum + record.shiftPay, 0), 2)
  const totalHolidayPenaltyPay = roundTo(sortedExportRecords.reduce((sum, record) => sum + record.holidayPenaltyPay, 0), 2)
  const totalSatOrdPay = roundTo(sortedExportRecords.reduce((sum, record) => sum + record.satOrdPay, 0), 2)
  const totalTimeHalfPay = roundTo(sortedExportRecords.reduce((sum, record) => sum + record.timeHalfPay, 0), 2)
  const totalDoublePay = roundTo(sortedExportRecords.reduce((sum, record) => sum + record.doublePay, 0), 2)
  const totalSunOrdPay = roundTo(sortedExportRecords.reduce((sum, record) => sum + record.sunOrdPay, 0), 2)
  const totalGrossPay = roundTo(sortedExportRecords.reduce((sum, record) => sum + record.grossPay, 0), 2)
  const totalPaidHours = roundTo(totalPaidMinutes / 60, 4)
  const totalBaseHours = roundTo((totalPaidMinutes - totalTimeHalfMinutes - totalDoubleMinutes) / 60, 4)
  const totalTimeHalfHours = roundTo(totalTimeHalfMinutes / 60, 4)
  const totalDoubleHours = roundTo(totalDoubleMinutes / 60, 4)
  const totalHolidayHours = roundTo(totalHolidayMinutes / 60, 4)
  const totalShiftHours = roundTo(
    shiftLoadingRate.value > 0 ? totalShiftPay / shiftLoadingRate.value : 0,
    4,
  )

  const exportRows = sortedExportRecords.map((record) => {
    cumulativePaidHours = roundTo(cumulativePaidHours + record.paidMinutes / 60, 4)

    return ({
    日期: record.workDate,
    開始時間: record.startTime,
    結束時間: record.endTime,
    原始工時分鐘: record.totalMinutes,
    smoko次數: record.smokoCount,
    smoko扣除分鐘: record.smokoDeductMinutes,
    計薪工時分鐘: record.paidMinutes,
    平日分鐘: record.weekdayPaidMinutes,
    星期六分鐘: record.saturdayPaidMinutes,
    星期日分鐘: record.sundayPaidMinutes,
    節日分鐘: record.holidayPaidMinutes,
    SatOrd分鐘: record.satOrdMinutes,
    THalf分鐘: record.timeHalfMinutes,
    Double分鐘: record.doubleMinutes,
    BasePay: record.basePay,
    CasualPay: record.casualPay,
    ShiftPay: record.shiftPay,
    OrdinaryHours: roundTo(
      (record.paidMinutes - record.timeHalfMinutes - record.doubleMinutes) / 60,
      4,
    ),
    'PH/OL Rate': record.holidayPenaltyRate,
    'PH/OL Pay': record.holidayPenaltyPay,
    SatOrdPay: record.satOrdPay,
    THalfPay: record.timeHalfPay,
    DoublePay: record.doublePay,
    SunOrdPay: record.sunOrdPay,
    當日總薪資: record.grossPay,
    加總工時: cumulativePaidHours,
  })
  })

  exportRows.push({
    日期: '合計',
    開始時間: '',
    結束時間: '',
    原始工時分鐘: totalRawMinutes,
    smoko次數: totalSmokoCount,
    smoko扣除分鐘: totalSmokoDeductMinutes,
    計薪工時分鐘: totalPaidMinutes,
    平日分鐘: totalWeekdayMinutes,
    星期六分鐘: totalSaturdayMinutes,
    星期日分鐘: totalSundayMinutes,
    節日分鐘: totalHolidayMinutes,
    SatOrd分鐘: totalSatOrdMinutes,
    THalf分鐘: totalTimeHalfMinutes,
    Double分鐘: totalDoubleMinutes,
    BasePay: totalBasePay,
    CasualPay: totalCasualPay,
    ShiftPay: totalShiftPay,
    OrdinaryHours: totalBaseHours,
    'PH/OL Rate': '',
    'PH/OL Pay': totalHolidayPenaltyPay,
    SatOrdPay: totalSatOrdPay,
    THalfPay: totalTimeHalfPay,
    DoublePay: totalDoublePay,
    SunOrdPay: totalSunOrdPay,
    當日總薪資: totalGrossPay,
    加總工時: totalPaidHours,
  })

  const payslipCompareRows = [
    { 項目: 'POULTRY PROCESSING AWARD - CASUAL - LEVEL 1', 工時: totalBaseHours, 費率: baseRate.value, 金額: totalBasePay },
    { 項目: 'T/Half', 工時: totalTimeHalfHours, 費率: timeHalfRate.value, 金額: totalTimeHalfPay },
    { 項目: 'Double', 工時: totalDoubleHours, 費率: doubleRate.value, 金額: totalDoublePay },
    { 項目: 'CASUAL LOADING 25%', 工時: totalBaseHours, 費率: casualLoadingRate.value, 金額: totalCasualPay },
    { 項目: 'P/HOL PENALTY 150%', 工時: totalHolidayHours, 費率: roundTo(baseRate.value * 1.5, 3), 金額: totalHolidayPenaltyPay },
    { 項目: 'SHIFT 25%', 工時: totalShiftHours, 費率: shiftLoadingRate.value, 金額: totalShiftPay },
    { 項目: 'SUN ORD LOAD 75%', 工時: roundTo(totalSundayMinutes / 60, 4), 費率: sundayLoadingRate.value, 金額: totalSunOrdPay },
    { 項目: 'PPE & TOOL ALLOWANCE', 工時: '', 費率: '', 金額: weeklyPPE.value },
    { 項目: 'GROSS（不含 PPE）', 工時: totalPaidHours, 費率: '', 金額: totalGrossPay },
    { 項目: 'WEEK TOTAL（含 PPE）', 工時: totalPaidHours, 費率: '', 金額: roundTo(totalGrossPay + weeklyPPE.value, 2) },
  ]

  const ws = XLSX.utils.json_to_sheet(exportRows)
  const compareWs = XLSX.utils.json_to_sheet(payslipCompareRows)
  const wb = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(wb, ws, 'Weekly Summary')
  XLSX.utils.book_append_sheet(wb, compareWs, 'Payslip Compare')
  XLSX.writeFile(wb, 'weekly-summary.xlsx')
}


/**
 * 將目前畫面算出的單日結果加入本週列表
 */
const addTodayRecordToList = () => {
  if (!workSummary.value || !payBreakdown.value) return
  if (!isValidTime(startTime.value) || !isValidTime(endTime.value)) return

  const todayRecord = buildWorkRecordFromInputs({
    workDate: workDate.value,
    startTime: startTime.value,
    endTime: endTime.value,
  })

  if (!todayRecord) return

  if (isEditingRecord.value) {
    records.value = records.value.map((record) => {
      if (record.id !== editingRecordId.value) return record

      return {
        ...todayRecord,
        id: record.id,
      }
    })
    editingRecordId.value = null
    return
  }

  records.value.unshift(todayRecord)
}

/**
 * 編輯列表中的單筆資料時，只回填原始輸入欄位，再沿用目前既有計算流程重算。
 *
 * 假設：
 * - 編輯後重新儲存時，會使用目前畫面上的費率設定重新計算該筆資料。
 * - 這裡不回復歷史費率，避免默默引入新的薪資規則或資料模型。
 */
const editRecord = (record) => {
  editingRecordId.value = record.id
  workDate.value = record.workDate
  startTime.value = record.startTime
  endTime.value = record.endTime
}

const cancelEditingRecord = () => {
  editingRecordId.value = null
}

const deleteRecord = (recordId) => {
  records.value = records.value.filter((record) => record.id !== recordId)

  if (editingRecordId.value === recordId) {
    editingRecordId.value = null
  }
}


</script>

<template>
  <div class="page">
    <div class="header">
      <h1>薪資計算工具</h1>
      <p>使用 24 小時制，自動計算工時、smoko 與預估薪資</p>
    </div>

    <!-- 輸入區 -->
    <div class="section">
      <h2>輸入資料</h2>
        <van-cell-group inset>
        <van-field
          label="工作日期"
          :model-value="workDate"
          readonly
          clickable
            input-align="right"
            is-link
            @click="showDatePicker = true"
          />
          <van-cell
            v-if="selectedHolidayLabel"
            title="國定假日"
            :value="selectedHolidayLabel"
          />
        <van-field
          v-model="startTime"
          is-link
          readonly
          label="上班時間"
          placeholder="請選擇時間"
          @click="showStartTimePicker = true"
        />

        <van-popup v-model:show="showStartTimePicker" position="bottom" round>
          <van-time-picker
            title="上班時間"
            :filter="filterTime"
            @confirm="onStartTimeConfirm"
            @cancel="showStartTimePicker = false"
          />
        </van-popup>

        <van-field
          v-model="endTime"
          is-link
          readonly
          label="下班時間"
          placeholder="請選擇時間"
          @click="showEndTimePicker = true"
        />

        <van-popup v-model:show="showEndTimePicker" position="bottom" round>
          <van-time-picker
            title="下班時間"
            :filter="filterTime"
            @confirm="onEndTimeConfirm"
            @cancel="showEndTimePicker = false"
          />
        </van-popup>
      </van-cell-group>
    </div>

    <!-- 工時摘要 -->
    <div class="section" v-if="workSummary">
      <h2>工時摘要</h2>
      <van-cell-group inset>
        <van-cell title="開始時間" :value="startTime" />
        <van-cell title="結束時間" :value="endTime" />
        <van-cell title="原始總工時" :value="`${formatHours(workSummary.totalMinutes)} 小時`" />
        <van-cell title="是否跨日" :value="workSummary.crossesMidnight ? '是' : '否'" />
        <van-cell title="夜班加成" :value="isNightShift ? '是' : '否'" />
        <van-cell title="smoko 次數" :value="`${workSummary.smokoCount} 次`" />
        <van-cell title="smoko 扣除" :value="`${workSummary.smokoDeductMinutes} 分鐘`" />
        <van-cell title="實際計薪工時" :value="`${formatHours(workSummary.paidMinutes)} 小時`" />
        <van-cell title="平日工時" :value="`${formatHours(paidSegmentedMinutes.weekdayPaidMinutes)} 小時`"/>
        <van-cell
          v-if="holidaySummary.holidayPaidMinutes > 0"
          title="P/HOL 工時"
          :value="`${formatHours(holidaySummary.holidayPaidMinutes)} 小時`"
        />
        <van-cell title="Sat ORD 工時" :value="`${formatHours(saturdayRuleBreakdown.satOrdMinutes)} 小時`" />
        <van-cell title="T/Half 工時" :value="`${formatHours(saturdayRuleBreakdown.timeHalfMinutes)} 小時`" />
        <van-cell title="Double 工時" :value="`${formatHours(saturdayRuleBreakdown.doubleMinutes)} 小時`" />
        <van-cell title="SUN ORD 工時" :value="`${formatHours(paidSegmentedMinutes.sundayPaidMinutes)} 小時`" />
      </van-cell-group>
    </div>

    <!-- 薪資估算 -->
    <div class="section" v-if="payBreakdown">
      <h2>薪資估算</h2>
      <van-cell-group inset>
        <van-cell title="Base Pay" :value="`$${formatMoney(payBreakdown.basePay)}`" />
        <van-cell title="CASUAL LOADING 25%" :value="`$${formatMoney(payBreakdown.casualPay)}`" />
        <van-cell
          v-if="payBreakdown.shiftPay > 0"
          title="SHIFT 25%"
          :value="`$${formatMoney(payBreakdown.shiftPay)}`"
        />
        <van-cell
          v-if="payBreakdown.holidayPenaltyPay > 0"
          title="PH/OL PENALTY 150%"
          :label="holidaySummary.holidayPaidMinutes > 0 ? `節日時數 ${formatHours(holidaySummary.holidayPaidMinutes)} 小時，費率 $${formatMoney(payBreakdown.holidayPenaltyRate)}` : ''"
          :value="`$${formatMoney(payBreakdown.holidayPenaltyPay)}`"
        />
        <van-cell title="SAT ORD 50%" :value="`$${formatMoney(payBreakdown.satOrdPay)}`" />
        <van-cell title="T/Half" :value="`$${formatMoney(payBreakdown.timeHalfPay)}`" />
        <van-cell title="Double" :value="`$${formatMoney(payBreakdown.doublePay)}`" />
        <van-cell title="SUN ORD LOAD 75%" :value="`$${formatMoney(payBreakdown.sunOrdPay)}`" />
        <van-cell
          title="預估總薪資"
          :value="`$${formatMoney(payBreakdown.grossPay)}`"
          class="gross-cell"
        />
      </van-cell-group>
    </div>

    <!-- 費率設定 -->
    <div class="section">
      <h2>費率設定</h2>
      <van-cell-group inset>
        <van-field
  :model-value="formatRate(baseRate)"
  label="基本時薪"
  type="number"
  input-align="right"
  @update:model-value="(val) => updateRate(baseRate, val, 3)"
/>

<van-field
  :model-value="formatRate(casualLoadingRate)"
  label="Casual 25%"
  type="number"
  input-align="right"
  @update:model-value="(val) => updateRate(casualLoadingRate, val, 3)"
/>

<van-field
  :model-value="formatRate(shiftLoadingRate)"
  label="夜班 25%"
  type="number"
  input-align="right"
  @update:model-value="(val) => updateRate(shiftLoadingRate, val, 3)"
/>

<van-field
  :model-value="formatRate(saturdayOrdLoadingRate)"
  label="Sat ORD 50%"
  type="number"
  input-align="right"
  @update:model-value="(val) => updateRate(saturdayOrdLoadingRate, val, 3)"
/>

<van-field
  :model-value="formatRate(timeHalfRate)"
  label="T/Half"
  type="number"
  input-align="right"
  @update:model-value="(val) => updateRate(timeHalfRate, val, 3)"
/>

<van-field
  :model-value="formatRate(doubleRate)"
  label="Double"
  type="number"
  input-align="right"
  @update:model-value="(val) => updateRate(doubleRate, val, 3)"
/>

<van-field
  :model-value="formatRate(sundayLoadingRate)"
  label="星期日 75%"
  type="number"
  input-align="right"
  @update:model-value="(val) => updateRate(sundayLoadingRate, val, 3)"
/>

<van-field
  :model-value="formatRate(ppeAllowance)"
  label="PPE 津貼"
  type="number"
  input-align="right"
  @update:model-value="(val) => updateRate(ppeAllowance, val, 2)"
/>
      </van-cell-group>
    </div>
    <!-- 備註 -->
    <div class="section">
      <h2>規則備註</h2>
        <van-cell-group inset>
        <van-cell title="smoko 規則" value="滿 4 小時 1 次，滿 8 小時 2 次" />
        <van-cell title="夜班判定" value="跨日或凌晨 06:00 前開工視為夜班" />
        <van-cell title="節日判定" value="目前以 NSW public holiday 日曆為準" />
      </van-cell-group>
    </div>
    <div class="workflow">
      <div class="section" v-if="payBreakdown || records.length > 0">
        <h2>本週操作</h2>
        <div class="section-card">
          <p class="section-note">
            先把今天的計算結果加入本週；如果列表中有寫錯，也可以直接編輯或刪除單筆。
          </p>
          <div class="weekly-actions">
            <van-button
              v-if="payBreakdown"
              block
              type="primary"
              @click="addTodayRecordToList"
            >
              {{ isEditingRecord ? '更新這筆紀錄' : '加入本週列表' }}
            </van-button>
            <van-button
              v-if="isEditingRecord"
              block
              plain
              type="default"
              @click="cancelEditingRecord"
            >
              取消編輯
            </van-button>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>本週列表</h2>
        <div class="section-card section-card--tight">
          <div v-if="records.length === 0" class="empty-state">
            <div class="empty-state__title">還沒有本週紀錄</div>
            <div class="empty-state__text">
              先確認今天的工時與薪資，再按「加入本週列表」。
            </div>
          </div>

          <div v-else>
            <div
              v-for="record in sortedRecords"
              :key="record.id"
              class="weekly-record"
            >
              <div class="weekly-record__top">
                <div>
                  <div class="weekly-record__date">{{ record.workDate }}</div>
                  <div class="weekly-record__time">
                    {{ record.startTime }} - {{ record.endTime }}
                  </div>
                </div>
                <div class="weekly-record__pay">
                  ${{ formatMoney(record.grossPay) }}
                </div>
              </div>
              <div class="weekly-record__meta">
                <span>計薪 {{ formatHours(record.paidMinutes) }} 小時</span>
                <span>smoko {{ record.smokoCount }} 次</span>
                <span v-if="record.holidayPaidMinutes > 0">
                  P/HOL {{ formatHours(record.holidayPaidMinutes) }} 小時
                </span>
                <span v-if="record.timeHalfMinutes > 0">
                  T/Half {{ formatHours(record.timeHalfMinutes) }} 小時
                </span>
                <span v-if="record.doubleMinutes > 0">
                  Double {{ formatHours(record.doubleMinutes) }} 小時
                </span>
                <span v-if="record.shiftPay > 0">夜班</span>
              </div>
              <div class="weekly-record__actions">
                <van-button
                  size="small"
                  plain
                  type="primary"
                  @click="editRecord(record)"
                >
                  編輯
                </van-button>
                <van-button
                  size="small"
                  plain
                  type="danger"
                  @click="deleteRecord(record.id)"
                >
                  刪除
                </van-button>
              </div>
            </div>
          </div>
        </div>
      </div>

<div class="section">
  <h2>本週總結</h2>
  <div class="section-card weekly-summary-card">
    
    <div class="weekly-summary__row">
      <span class="weekly-summary__label">目前顯示幣別</span>
      <van-button size="small" plain type="primary" @click="showCurrencyPicker = true">
        切換 ({{ currentCurrency }})
      </van-button>
    </div>

    <div class="weekly-summary__row">
      <span class="weekly-summary__label">本週小計 (AUD)</span>
      <span class="weekly-summary__value">${{ formatMoney(weeklySubtotal) }}</span>
    </div>
    <div class="weekly-summary__row">
      <span class="weekly-summary__label">PPE (AUD)</span>
      <span class="weekly-summary__value">${{ formatMoney(weeklyPPE) }}</span>
    </div>

    <div class="weekly-summary__row" style="margin-top: 8px; border-top: 1px dashed #ebedf0; padding-top: 8px;">
      <span class="weekly-summary__label" style="font-size: 13px; color: #646566;">本週總薪資（稅前）(AUD)</span>
      <span class="weekly-summary__value" style="font-size: 14px; color: #646566; font-weight: 500;">${{ formatMoney(weeklyTotal) }}</span>
    </div>
    
    <div class="weekly-summary__row weekly-summary__row--tax" style="margin-bottom: 8px;">
      <span class="weekly-summary__label">預估扣稅 12% (AUD)</span>
      <span class="weekly-summary__value weekly-summary__value--tax">-${{ formatMoney(weeklyTaxEstimate) }}</span>
    </div>

    <div class="weekly-summary__total weekly-summary__total--net">
      <div class="weekly-summary__total-label">本週實領（稅後預估）</div>
      <div class="weekly-summary__total-value weekly-summary__total-value--net">
        <span style="margin-right: 4px;">{{ currencyFlag }}</span>
        {{ currencySymbol }}{{ formatMoney(convertedNetTotal) }}
        <span style="font-size: 14px; font-weight: normal; color: #969799; margin-left: 2px;">{{ currentCurrency }}</span>
      </div>
      
      <div v-if="currentCurrency !== 'AUD'" style="font-size: 12px; color: #969799; margin-top: 6px; font-weight: normal; text-align: right;">
        匯率參考: 1 AUD = {{ exchangeRates[currentCurrency] }} {{ currentCurrency }}
      </div>
    </div>

  </div>
</div>

<van-popup v-model:show="showCurrencyPicker" position="bottom" round>
  <van-picker
    title="選擇換算幣別"
    :columns="currencyColumns"
    @confirm="onCurrencyConfirm"
    @cancel="showCurrencyPicker = false"
  />
</van-popup>

      <div class="section" v-if="payBreakdown || records.length > 0">
        <h2>資料管理</h2>
        <van-collapse v-model="dataManagementSections" class="data-management-collapse">
          <van-collapse-item name="data-management" title="匯入 / 匯出資料">
            <div class="button-group">
              <p class="section-note section-note--compact">
                這裡放備份與匯入功能，不影響每天主要使用流程。
              </p>
              <van-button block plain type="default" @click="exportTodayJson">
                匯出今日 JSON
              </van-button>

              <div class="import-export-row">
                <van-button
                  block
                  plain
                  type="primary"
                  :disabled="records.length === 0"
                  @click="exportWeeklyJson"
                >
                  匯出本週 JSON
                </van-button>

                <van-uploader
                  class="import-uploader"
                  :after-read="importJsonFiles"
                  accept=".json,application/json"
                  multiple
                >
                  <van-button block plain type="danger" class="import-button">
                    匯入 JSON
                  </van-button>
                </van-uploader>
              </div>

              <van-button
                block
                plain
                type="success"
                style="margin-top: 12px"
                :disabled="records.length === 0"
                @click="exportWeeklyXlsx"
              >
                匯出本週 XLSX
              </van-button>
            </div>
          </van-collapse-item>
        </van-collapse>
      </div>
    </div>
</div>

<van-calendar
  v-model:show="showDatePicker"
  title="選擇工作日期"
  :default-date="calendarDefaultDate"
  :min-date="calendarMinDate"
  :max-date="calendarMaxDate"
  :show-confirm="false"
  :formatter="holidayCalendarFormatter"
  switch-mode="year-month"
  @confirm="confirmDate"
/>

</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f7f8fa;
  padding: 20px 0 40px;
}

.header {
  padding: 0 16px 12px;
}

.header h1 {
  margin: 0 0 8px;
  font-size: 28px;
}

.header p {
  margin: 0;
  color: #666;
  font-size: 14px;
}

.section {
  margin-top: 18px;
}

.section h2 {
  font-size: 18px;
  margin: 0 0 10px;
  padding: 0 16px;
}

.workflow {
  margin-top: 4px;
}

.section-card {
  margin: 0 16px;
  padding: 16px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.05);
}

.section-card--tight {
  padding: 0;
  overflow: hidden;
}

.section-note {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.5;
  color: #646566;
}

.section-note--compact {
  margin-bottom: 12px;
}

.native-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  text-align: right;
  font-size: 16px;
  color: #323233;
}

:deep(.gross-cell .van-cell__value) {
  font-weight: 700;
  color: #1989fa;

}

:deep(.holiday-day) {
  color: #ee0a24;
}

:deep(.holiday-day .van-calendar__bottom-info) {
  color: #ee0a24;
  font-size: 10px;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.field-error {
  color: #ee0a24;
  font-size: 12px;
  padding: 6px 16px 0;
}

.button-group {
  padding: 4px 0 0;
}

.weekly-actions {
  display: grid;
  gap: 12px;
}

.weekly-actions :deep(.van-button--primary) {
  min-height: 48px;
  font-size: 16px;
  font-weight: 700;
  box-shadow: 0 10px 24px rgba(25, 137, 250, 0.22);
}

.weekly-actions :deep(.van-button--danger.is-plain),
.weekly-actions :deep(.van-button--danger.van-button--plain) {
  min-height: 40px;
  font-size: 14px;
}

.empty-state {
  padding: 22px 16px;
  text-align: center;
}

.empty-state__title {
  font-size: 15px;
  font-weight: 700;
  color: #323233;
}

.empty-state__text {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.5;
  color: #646566;
}

.weekly-record {
  margin: 12px;
  padding: 14px;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
  border: 1px solid #eef2f7;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
}

.weekly-record__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.weekly-record__date {
  font-size: 15px;
  font-weight: 700;
  color: #323233;
}

.weekly-record__pay {
  font-size: 22px;
  line-height: 1;
  font-weight: 800;
  color: #1989fa;
  white-space: nowrap;
}

.weekly-record__time {
  margin-top: 8px;
  font-size: 14px;
  color: #646566;
}

.weekly-record__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.weekly-record__meta span {
  padding: 5px 9px;
  border-radius: 999px;
  background: #f5f7fb;
  font-size: 12px;
  font-weight: 600;
  color: #5f6773;
}

.weekly-record__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.weekly-summary-card {
  padding: 14px 16px 16px;
}

.weekly-summary__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
}

.weekly-summary__label {
  font-size: 14px;
  color: #646566;
}

.weekly-summary__value {
  font-size: 15px;
  font-weight: 600;
  color: #323233;
}

.weekly-summary__row--tax {
  padding-top: 14px;
  margin-top: 10px;
  border-top: 1px dashed #e7ebf1;
}

.weekly-summary__value--tax {
  color: #8c6b00;
}

.weekly-summary__total {
  margin-top: 12px;
  padding-top: 14px;
  border-top: 1px solid #eef2f7;
}

.weekly-summary__total--gross {
  margin-top: 10px;
}

.weekly-summary__total--net {
  margin-top: 10px;
  padding: 16px;
  border-radius: 14px;
  background: linear-gradient(180deg, #f5faff 0%, #eef7ff 100%);
  border-top: none;
}

.weekly-summary__total-label {
  font-size: 13px;
  color: #646566;
}

.weekly-summary__total-value {
  margin-top: 6px;
  font-size: 30px;
  line-height: 1.1;
  font-weight: 800;
  color: #1989fa;
}

.weekly-summary__total-value--net {
  color: #0f8a5f;
}

.import-export-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 12px;
}

.import-uploader {
  display: block;
}

.import-uploader :deep(.van-uploader__wrapper) {
  display: block;
}

.import-button {
  border-style: dashed;
  background: #fff5f5;
}

.data-management-collapse {
  margin: 0 16px;
  overflow: hidden;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.04);
  opacity: 0.96;
}

:deep(.data-management-collapse .van-cell) {
  padding: 16px;
}

:deep(.data-management-collapse .van-collapse-item__content) {
  padding: 0 16px 16px;
}

:deep(.data-management-collapse .van-collapse-item__title) {
  font-size: 15px;
  color: #4b5563;
}
</style>
