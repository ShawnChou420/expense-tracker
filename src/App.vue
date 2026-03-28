<script setup>
import { ref, computed } from 'vue'
import * as XLSX from 'xlsx'

/**
 * =========================================================
 * 1. 使用者輸入資料
 * 畫面上由使用者直接輸入或選擇的欄位
 * =========================================================
 */



/**
 * 工作起訖時間，格式：HH:mm（24 小時制）
 * 例：
 * - 早班：06:00 ~ 15:45
 * - 中班：15:45 ~ 23:50
 * - 晚班：23:45 ~ 06:00
 */
const workDate = ref(getTodayDate())
const startTime = ref('23:45')
const endTime = ref('06:00')

 //日期
const showDatePicker = ref(false)
const showStartPicker = ref(false)
const showEndPicker = ref(false)

const startPickerValue = ref([startTime.value])
const endPickerValue = ref([endTime.value])

const confirmStartTime = ({ selectedValues }) => {
  const value = selectedValues[0]
  startTime.value = value
  startPickerValue.value = [value]
  showStartPicker.value = false
}

const confirmEndTime = ({ selectedValues }) => {
  const value = selectedValues[0]
  endTime.value = value
  endPickerValue.value = [value]
  showEndPicker.value = false
}
const confirmDate = ({ selectedValues }) => {
  workDate.value = `${selectedValues[0]}-${selectedValues[1]}-${selectedValues[2]}`
  showDatePicker.value = false
}

const updateRate = (targetRef, value, digits = 3) => {
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return
  targetRef.value = roundTo(parsed, digits)
}

const datePickerValue = computed({
  get() {
    const [year, month, day] = workDate.value.split('-')
    return [year, month, day]
  },
  set(val) {
    workDate.value = `${val[0]}-${val[1]}-${val[2]}`
  },
})

const timeOptions = computed(() => {
  const values = []

  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const timeText = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      values.push({
        text: timeText,
        value: timeText,
      })
    }
  }

  return values
})

/**
 * =========================================================
 * 2. 薪資規則設定
 * 依 payslip 預設，可由畫面手動調整
 * =========================================================
 */

// Level 1 基本時薪
const baseRate = ref(25.06)

// Casual loading 25%
const casualLoadingRate = ref(6.265)

// Shift loading 25%
const shiftLoadingRate = ref(6.265)

// 星期五打卡、跨到星期六時，星期六那段的 ordinary load
const saturdayOrdLoadingRate = ref(12.53)

// 星期六打卡上班時，星期六工時的加班算法
const timeHalfRate = ref(37.59)
const doubleRate = ref(50.12)

// 星期日 ordinary load
const sundayLoadingRate = ref(18.795)

// PPE 津貼（每週一次，不算在單日薪資內）
const ppeAllowance = ref(5.0)

// 每次 smoko 扣除分鐘數
const smokoMinutesPerBreak = ref(30)

//判斷這一班是星期幾開始ㄊ
const shiftStartDay = computed(() => {
  if (!workDate.value) return null
  const start = new Date(`${workDate.value}T${startTime.value}`)
  return start.getDay() // 0=Sun, 5=Fri, 6=Sat
})

/**
 * =========================================================
 * 3. 週資料容器
 * 用來累積本週匯入或手動加入的每日紀錄
 * =========================================================
 */
const records = ref([])

/**
 * =========================================================
 * 4. 日期與時間工具函式
 * 負責日期初始化、字串轉分鐘、原始工時計算
 * =========================================================
 */

/**
 * 取得今天日期
 * 回傳格式：YYYY-MM-DD
 */
function getTodayDate() {
  const today = new Date()

  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

/**
 * 將 HH:mm 轉成總分鐘數
 * 例如：23:45 -> 1425
 */
const parseTimeToMinutes = (timeText) => {
  if (!timeText) return null

  const match = timeText.match(/^(\d{2}):(\d{2})$/)
  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2])

  return hour * 60 + minute
}

/**
 * 計算整段班的原始工時
 * 若結束時間 <= 開始時間，視為跨日
 */
const calculateWorkMinutes = (startText, endText) => {
  const startMinutes = parseTimeToMinutes(startText)
  const endMinutes = parseTimeToMinutes(endText)

  if (startMinutes === null || endMinutes === null) {
    return null
  }

  let totalMinutes = 0
  let crossesMidnight = false

  if (endMinutes <= startMinutes) {
    crossesMidnight = true
    totalMinutes = 24 * 60 - startMinutes + endMinutes
  } else {
    totalMinutes = endMinutes - startMinutes
  }

  return {
    startMinutes,
    endMinutes,
    totalMinutes,
    crossesMidnight,
  }
}

/**
 * 四捨五入到指定位數，避免 JS 浮點數誤差
 */
const roundTo = (value, digits = 2) => {
  const factor = 10 ** digits
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor
}

/**
 * 費率顯示：最多 3 位，不要一堆尾數
 * 例如：
 * 25.06 -> 25.06
 * 6.265 -> 6.265
 * 5.000 -> 5
 */
const formatRate = (value) => {
  return String(roundTo(value, 3)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

/**
 * 24 小時制時間顯示
 */
const format24HourTime = (timeText) => {
  return timeText || '--:--'
}

/**
 * 將分鐘格式化成小時字串
 * 例如：345 -> 5.75
 */
const formatHours = (minutes) => {
  return (minutes / 60).toFixed(2)
}

/**
 * 將金額格式化成小數點後兩位
 */
const formatMoney = (value) => {
  return roundTo(value, 2).toFixed(2)
}

/**
 * =========================================================
 * 5. 班別切段工具
 * 將整段班切成平日 / 星期六 / 星期日分鐘數
 * =========================================================
 */

/**
 * 取得本次班別的實際起訖 datetime
 * 若為跨日班，會自動把結束時間加一天
 */
const getShiftDateTimeRange = () => {
  if (!workDate.value || !startTime.value || !endTime.value) return null

  const start = new Date(`${workDate.value}T${startTime.value}`)
  const end = new Date(`${workDate.value}T${endTime.value}`)

  if (end <= start) {
    end.setDate(end.getDate() + 1)
  }

  return { start, end }
}

/**
 * 以 15 分鐘為單位切段
 * 將原始班別拆成：
 * - 平日分鐘
 * - 星期六分鐘
 * - 星期日分鐘
 */
const getDayTypeMinutes = (start, end) => {
  let weekdayMinutes = 0
  let saturdayMinutes = 0
  let sundayMinutes = 0

  const current = new Date(start)

  while (current < end) {
    const next = new Date(current)
    next.setMinutes(next.getMinutes() + 15)

    if (next > end) {
      next.setTime(end.getTime())
    }

    const diffMinutes = (next - current) / 60000
    const day = current.getDay() // 0=星期日, 6=星期六

    if (day === 6) {
      saturdayMinutes += diffMinutes
    } else if (day === 0) {
      sundayMinutes += diffMinutes
    } else {
      weekdayMinutes += diffMinutes
    }

    current.setTime(next.getTime())
  }

  return {
    weekdayMinutes,
    saturdayMinutes,
    sundayMinutes,
  }
}

/**
 * 計算兩個時間區段的重疊分鐘數
 */
const getOverlapMinutes = (rangeStart, rangeEnd, blockStart, blockEnd) => {
  const start = Math.max(rangeStart.getTime(), blockStart.getTime())
  const end = Math.min(rangeEnd.getTime(), blockEnd.getTime())

  if (end <= start) return 0
  return (end - start) / 60000
}

/**
 * 依 smoko 規則建立 break 視窗
 *
 * 規則：
 * - 1 次 smoko：扣在第 1 個 4 小時區段尾端
 * - 2 次 smoko：分別扣在第 1、2 個 4 小時區段尾端
 *
 * 例如：
 * 20:45 上班，30 分鐘 break
 * 第 1 次 break：00:15 ~ 00:45
 * 第 2 次 break：04:15 ~ 04:45
 */
const getSmokoWindows = (shiftStart, shiftEnd, smokoCount, smokoMinutes) => {
  const windows = []

  const blockEndOffsets = []

  if (smokoCount >= 1) blockEndOffsets.push(240) // 第 1 個 4 小時結束點
  if (smokoCount >= 2) blockEndOffsets.push(480) // 第 2 個 4 小時結束點

  for (const offsetMinutes of blockEndOffsets) {
    const blockEnd = new Date(shiftStart.getTime() + offsetMinutes * 60000)

    // break 結束時間不能超過下班時間
    const breakEnd = blockEnd > shiftEnd ? shiftEnd : blockEnd

    // break 往前推 smokoMinutes
    const breakStart = new Date(
      Math.max(
        shiftStart.getTime(),
        breakEnd.getTime() - smokoMinutes * 60000,
      ),
    )

    if (breakEnd > breakStart) {
      windows.push({
        start: breakStart,
        end: breakEnd,
      })
    }
  }

  return windows
}

/**
 * 原始班別切段結果
 * 尚未扣 smoko
 */
const segmentedMinutes = computed(() => {
  const range = getShiftDateTimeRange()

  if (!range) {
    return {
      weekdayMinutes: 0,
      saturdayMinutes: 0,
      sundayMinutes: 0,
    }
  }

  return getDayTypeMinutes(range.start, range.end)
})

/**
 * =========================================================
 * 6. 工時與薪資計算
 * 包含 smoko、夜班判斷、計薪工時與薪資拆分
 * =========================================================
 */

/**
 * smoko 規則：
 * - 滿 8 小時：2 次
 * - 滿 6 小時：1 次
 * - 其他：0 次
 */
const getSmokoCount = (totalMinutes) => {
  if (totalMinutes >= 8 * 60) return 2
  if (totalMinutes >= 6 * 60) return 1
  return 0
}

/**
 * 本次班別的工時摘要
 * 包含：
 * - 原始總分鐘數
 * - 是否跨日
 * - smoko 次數
 * - smoko 扣除分鐘數
 * - 實際計薪分鐘數
 */
const workSummary = computed(() => {
  const result = calculateWorkMinutes(startTime.value, endTime.value)

  if (!result) return null

  const smokoCount = getSmokoCount(result.totalMinutes)
  const smokoDeductMinutes = smokoCount * smokoMinutesPerBreak.value
  const paidMinutes = result.totalMinutes - smokoDeductMinutes

  return {
    ...result,
    smokoCount,
    smokoDeductMinutes,
    paidMinutes,
  }
})

/**
 * 夜班判斷
 * 目前規則：只要跨日就視為夜班
 */
const isNightShift = computed(() => {
  return workSummary.value?.crossesMidnight ?? false
})

/**
 * 將實際計薪分鐘數按比例分攤到：
 * - 平日
 * - 星期六
 * - 星期日
 *
 * 目前採比例分配，尚未做到「smoko 精準扣在哪一天」
 */
const paidSegmentedMinutes = computed(() => {
  if (!workSummary.value) {
    return {
      weekdayPaidMinutes: 0,
      saturdayPaidMinutes: 0,
      sundayPaidMinutes: 0,
    }
  }

  const { weekdayMinutes, saturdayMinutes, sundayMinutes } = segmentedMinutes.value
  const smokoDeductMinutes = workSummary.value.smokoDeductMinutes

  return applySmokoDeductionToSegments(
    weekdayMinutes,
    saturdayMinutes,
    sundayMinutes,
    smokoDeductMinutes,
  )
})




const saturdayRuleBreakdown = computed(() => {
  const saturdayPaidMinutes = paidSegmentedMinutes.value.saturdayPaidMinutes

  if (!saturdayPaidMinutes) {
    return {
      satOrdMinutes: 0,
      timeHalfMinutes: 0,
      doubleMinutes: 0,
    }
  }

  // 星期五打卡跨到星期六 => Sat ORD
  if (shiftStartDay.value === 5) {
    return {
      satOrdMinutes: saturdayPaidMinutes,
      timeHalfMinutes: 0,
      doubleMinutes: 0,
    }
  }

  // 星期六打卡 => overtime
  if (shiftStartDay.value === 6) {
    return {
      satOrdMinutes: 0,
      timeHalfMinutes: Math.min(saturdayPaidMinutes, 180),
      doubleMinutes: Math.max(saturdayPaidMinutes - 180, 0),
    }
  }

  return {
    satOrdMinutes: 0,
    timeHalfMinutes: 0,
    doubleMinutes: 0,
  }
})

/**
 * 單日薪資拆分
 * 不含 tax / super，也不含每週一次 PPE
 */
const payBreakdown = computed(() => {
  if (!workSummary.value) return null

  const weekdayHours = roundTo(paidSegmentedMinutes.value.weekdayPaidMinutes / 60, 4)
  const saturdayHours = roundTo(paidSegmentedMinutes.value.saturdayPaidMinutes / 60, 4)
  const sunOrdHours = roundTo(paidSegmentedMinutes.value.sundayPaidMinutes / 60, 4)
  const paidHours = roundTo(workSummary.value.paidMinutes / 60, 4)

  const satOrdHours = roundTo(
    saturdayRuleBreakdown.value.satOrdMinutes / 60,
    4,
  )

  const timeHalfHours = roundTo(
    saturdayRuleBreakdown.value.timeHalfMinutes / 60,
    4,
  )

  const doubleHours = roundTo(
    saturdayRuleBreakdown.value.doubleMinutes / 60,
    4,
  )

  const basePay = roundTo(paidHours * baseRate.value, 2)
  const casualPay = roundTo(paidHours * casualLoadingRate.value, 2)
  const shiftPay = isNightShift.value
    ? roundTo(paidHours * shiftLoadingRate.value, 2)
    : 0

  const satOrdPay = roundTo(
    satOrdHours * saturdayOrdLoadingRate.value,
    2,
  )

  const timeHalfPay = roundTo(timeHalfHours * timeHalfRate.value, 2)
  const doublePay = roundTo(doubleHours * doubleRate.value, 2)
  const sunOrdPay = roundTo(sunOrdHours * sundayLoadingRate.value, 2)

  const grossPay = roundTo(
    basePay +
      casualPay +
      shiftPay +
      satOrdPay +
      timeHalfPay +
      doublePay +
      sunOrdPay,
    2,
  )

  return {
    weekdayHours,
    saturdayHours,
    sunOrdHours,
    satOrdHours,
    timeHalfHours,
    doubleHours,
    basePay,
    casualPay,
    shiftPay,
    satOrdPay,
    timeHalfPay,
    doublePay,
    sunOrdPay,
    grossPay,
  }
})

/**
 * =========================================================
 * 7. 週統計
 * 針對 records 內已加入的資料做加總
 * =========================================================
 */

/**
 * 本週薪資小計
 * 暫時直接加總 records，尚未依日期過濾週別
 */
const weeklySubtotal = computed(() => {
  return records.value.reduce((sum, record) => {
    return sum + record.grossPay
  }, 0)
})

/**
 * PPE 為每週一次
 * 目前規則：只要本週列表有紀錄，就加一次
 */
const weeklyPPE = computed(() => {
  return records.value.length > 0 ? ppeAllowance.value : 0
})

/**
 * 本週總薪資
 */
const weeklyTotal = computed(() => {
  return weeklySubtotal.value + weeklyPPE.value
})

/**
 * =========================================================
 * 8. 匯入 / 匯出 / 列表操作
 * 負責單日 JSON、週 XLSX、列表暫存
 * =========================================================
 */

/**
 * 匯出今日薪資紀錄為 JSON
 */
const exportTodayJson = () => {
  if (!workSummary.value || !payBreakdown.value) return

  const todayRecord = {
    id: Date.now(),
    workDate: workDate.value,
    startTime: startTime.value,
    endTime: endTime.value,
    totalMinutes: workSummary.value.totalMinutes,
    smokoCount: workSummary.value.smokoCount,
    smokoDeductMinutes: workSummary.value.smokoDeductMinutes,
    paidMinutes: workSummary.value.paidMinutes,
    grossPay: roundTo(payBreakdown.value.grossPay, 2),
  }

  const jsonString = JSON.stringify(todayRecord, null, 2)
  const blob = new Blob([jsonString], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = `${workDate.value}.json`
  link.click()

  URL.revokeObjectURL(url)
}

/**
 * 匯入多個 JSON 檔，轉成 records 列表
 */
const importJsonFiles = async (event) => {
  const files = Array.from(event.target.files || [])
  const importedRecords = []

  for (const file of files) {
    const text = await file.text()
    const jsonData = JSON.parse(text)
    importedRecords.push(jsonData)
  }

  records.value = importedRecords.sort((a, b) =>
    a.workDate.localeCompare(b.workDate),
  )
}

/**
 * 匯出本週列表為 XLSX
 */
const exportWeeklyXlsx = () => {
  if (records.value.length === 0) return

  const exportRows = records.value.map((record) => ({
    日期: record.workDate,
    開始時間: record.startTime,
    結束時間: record.endTime,
    原始工時分鐘: record.totalMinutes,
    smoko次數: record.smokoCount,
    smoko扣除分鐘: record.smokoDeductMinutes,
    計薪工時分鐘: record.paidMinutes,
    計薪工時小時: roundTo(record.paidMinutes / 60, 2),
    當日薪資: roundTo(record.grossPay, 2),
  }))

  const ws = XLSX.utils.json_to_sheet(exportRows)
  const wb = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(wb, ws, 'Weekly Summary')
  XLSX.writeFile(wb, 'weekly-summary.xlsx')
}


/**
 * 將目前畫面算出的單日結果加入本週列表
 */
const addTodayRecordToList = () => {
  if (!workSummary.value || !payBreakdown.value) return

  const todayRecord = {
    id: Date.now(),
    workDate: workDate.value,
    startTime: startTime.value,
    endTime: endTime.value,
    totalMinutes: workSummary.value.totalMinutes,
    smokoCount: workSummary.value.smokoCount,
    smokoDeductMinutes: workSummary.value.smokoDeductMinutes,
    paidMinutes: workSummary.value.paidMinutes,
    grossPay: Number(payBreakdown.value.grossPay.toFixed(2)),
  }

  records.value.unshift(todayRecord)
}

/**
 * 依日期切出原始分鐘數後，再把 smoko 扣到各段
 * 目前規則：
 * - smoko 優先從 weekday 扣
 * - weekday 不夠再扣 saturday
 * - saturday 不夠再扣 sunday
 *
 * 你之後如果想改成「從最後發生的時段開始扣」也很好改
 */
/**
 * smoko 優先從後面時段扣
 * 順序：weekday -> saturday -> sunday
 * 因為像 Sunday night 班，smoko 通常比較像扣在 00:00 後那段
 */
const applySmokoDeductionToSegments = (
  weekdayMinutes,
  saturdayMinutes,
  sundayMinutes,
  smokoDeductMinutes,
) => {
  let remainingSmoko = smokoDeductMinutes

  let weekdayPaidMinutes = weekdayMinutes
  let saturdayPaidMinutes = saturdayMinutes
  let sundayPaidMinutes = sundayMinutes

  if (remainingSmoko > 0) {
    const deduct = Math.min(weekdayPaidMinutes, remainingSmoko)
    weekdayPaidMinutes -= deduct
    remainingSmoko -= deduct
  }

  if (remainingSmoko > 0) {
    const deduct = Math.min(saturdayPaidMinutes, remainingSmoko)
    saturdayPaidMinutes -= deduct
    remainingSmoko -= deduct
  }

  if (remainingSmoko > 0) {
    const deduct = Math.min(sundayPaidMinutes, remainingSmoko)
    sundayPaidMinutes -= deduct
    remainingSmoko -= deduct
  }

  return {
    weekdayPaidMinutes,
    saturdayPaidMinutes,
    sundayPaidMinutes,
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
            @click="showDatePicker = true"
          />

        <van-field
          label="開始時間"
          :model-value="startTime"
          readonly
          clickable
          input-align="right"
          @click="showStartPicker = true"
        >
        </van-field>

        <van-field
          label="結束時間"
          :model-value="endTime"
          readonly
          clickable
          input-align="right"
          @click="showEndPicker = true"
        >
        </van-field>
          <van-field
            v-model.number="smokoMinutesPerBreak"
            label="每次 smoko 分鐘"
            type="number"
            input-align="right"
          />
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
        <van-cell title="SHIFT 25%" :value="`$${formatMoney(payBreakdown.shiftPay)}`" />
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
        <van-cell title="smoko 規則" value="滿 6 小時 1 次，滿 8 小時 2 次" />
        <van-cell title="夜班判定" value="目前以跨日視為夜班" />
        <van-cell title="時間格式" value="24 小時制，每 15 分鐘一格" />
      </van-cell-group>
    </div>
<div class="section" v-if="payBreakdown">
  </div>
  <h2>操作</h2>
  <div class="button-group">
    <van-button block type="primary" @click="exportTodayJson">
      匯出今日 JSON
    </van-button>

    <van-button
      block
      plain
      type="warning"
      style="margin-top: 12px"
      @click="addTodayRecordToList"
    >
      加入本週列表
    </van-button>

    <van-button
      block
      plain
      type="success"
      style="margin-top: 12px"
      @click="exportWeeklyXlsx"
    >
      匯出本週 XLSX
    </van-button>
  </div>
</div>

<div class="section">
  <h2>本週紀錄列表</h2>

  <van-empty v-if="records.length === 0" description="目前沒有本週紀錄" />

  <div v-else class="record-list">
    <van-card
      v-for="record in records"
      :key="record.id"
      :title="record.workDate"
      :desc="`${record.startTime} - ${record.endTime}`"
    >
      <template #tags>
        <van-tag plain type="primary">
          工時 {{ formatHours(record.paidMinutes) }} 小時
        </van-tag>
        <van-tag plain type="success" style="margin-left: 8px">
          ${{ formatMoney(record.grossPay) }}
        </van-tag>
      </template>
    </van-card>
  </div>
</div>

<van-popup v-model:show="showDatePicker" position="bottom" round>
  <van-date-picker
    v-model="datePickerValue"
    title="選擇工作日期"
    @confirm="confirmDate"
    @cancel="showDatePicker = false"
  />
</van-popup>

<van-popup v-model:show="showStartPicker" position="bottom" round>
  <van-picker
    :columns="timeOptions"
    :model-value="startPickerValue"
    title="選擇開始時間"
    @confirm="confirmStartTime"
    @cancel="showStartPicker = false"
  />
</van-popup>

<van-popup v-model:show="showEndPicker" position="bottom" round>
  <van-picker
    :columns="timeOptions"
    :model-value="endPickerValue"
    title="選擇結束時間"
    @confirm="confirmEndTime"
    @cancel="showEndPicker = false"
  />
</van-popup>

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
</style>