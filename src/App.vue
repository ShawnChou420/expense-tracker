<script setup>
import { ref, computed } from 'vue'

/**
 * ===============================
 * 1. 使用者輸入資料
 * ===============================
 */

// 工作日期：格式 YYYY-MM-DD
const workDate = ref(getTodayDate())

/*
開始時間、結束時間：格式 HH:mm（24 小時制）
早班06:00~15:45
中班15:45~11:50
晚班11:45~06:00
*/ 
const startTime = ref('23:45')
const endTime = ref('06:00')

/**
 * ===============================
 * 2. 薪資規則設定
 * 依你的 payslip 預設，可自行調整
 * ===============================
 */
const baseRate = ref(25.06)//level1
const casualLoadingRate = ref(6.265)
const shiftLoadingRate = ref(6.265)
const saturdayLoadingRate = ref(12.53)
const sundayLoadingRate = ref(18.795) // 先假設 75%，之後可依 payslip 調整
const ppeAllowance = ref(5.0)//每週一次
const smokoMinutesPerBreak = ref(30)

const getShiftDateTimeRange = () => {
  if (!workDate.value || !startTime.value || !endTime.value) return null

  const start = new Date(`${workDate.value}T${startTime.value}`)
  const end = new Date(`${workDate.value}T${endTime.value}`)

  // 若結束時間小於等於開始時間，視為跨日
  if (end <= start) {
    end.setDate(end.getDate() + 1)
  }

  return { start, end }
}

const getDayTypeMinutes = (start, end) => {
  let weekdayMinutes = 0
  let saturdayMinutes = 0
  let sundayMinutes = 0

  const current = new Date(start)

  while (current < end) {
    const next = new Date(current)
    next.setMinutes(next.getMinutes() + 15)

    // 不要超過下班時間
    if (next > end) {
      next.setTime(end.getTime())
    }

    const diffMinutes = (next - current) / 60000
    const day = current.getDay() // 0=日, 6=六

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

const paidSegmentedMinutes = computed(() => {
  if (!workSummary.value) {
    return {
      weekdayPaidMinutes: 0,
      saturdayPaidMinutes: 0,
      sundayPaidMinutes: 0,
    }
  }

  const totalMinutes = workSummary.value.totalMinutes
  const paidMinutes = workSummary.value.paidMinutes

  if (totalMinutes <= 0) {
    return {
      weekdayPaidMinutes: 0,
      saturdayPaidMinutes: 0,
      sundayPaidMinutes: 0,
    }
  }

  const { weekdayMinutes, saturdayMinutes, sundayMinutes } = segmentedMinutes.value

  const weekdayPaidMinutes = (weekdayMinutes / totalMinutes) * paidMinutes
  const saturdayPaidMinutes = (saturdayMinutes / totalMinutes) * paidMinutes
  const sundayPaidMinutes = (sundayMinutes / totalMinutes) * paidMinutes

  return {
    weekdayPaidMinutes,
    saturdayPaidMinutes,
    sundayPaidMinutes,
  }
})

const weeklySubtotal = computed(() => {
  return records.value.reduce((sum, record) => {
    return sum + record.grossPay
  }, 0)
})

const weeklyPPE = computed(() => {
  return records.value.length > 0 ? ppeAllowance.value : 0
})

/**
 * 本週總薪資（暫時先用全部紀錄計算）
 * 只要有紀錄，就加一次 PPE
 */
const weeklyTotal = computed(() => {
  return weeklySubtotal.value + weeklyPPE.value
})

/**
 * ===============================
 * 3. 工具函式：把 HH:mm 轉成總分鐘數
 * 例如 23:45 -> 1425
 * ===============================
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
 * ===============================
 * 4. 工具函式：計算工作總分鐘數
 * 若結束時間 <= 開始時間，視為跨日
 * 例如 23:45 -> 05:45
 * ===============================
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
 * ===============================
 * 5. smoko 規則
 * - 滿 8 小時：2 次
 * - 滿 6 小時：1 次
 * - 其他：0 次
 * ===============================
 */
const getSmokoCount = (totalMinutes) => {
  if (totalMinutes >= 8 * 60) return 2
  if (totalMinutes >= 6 * 60) return 1
  return 0
}

/**
 * ===============================
 * 6. 工具函式：格式化小時
 * 分鐘 -> 小時（保留兩位小數）
 * ===============================
 */
const formatHours = (minutes) => {
  return (minutes / 60).toFixed(2)
}

/**
 * ===============================
 * 7. 判斷是否為星期六
 * JavaScript: 星期日=0, 星期六=6
 * ===============================
 */
const isSaturday = computed(() => {
  if (!workDate.value) return false

  const date = new Date(workDate.value)
  return date.getDay() === 6
})

/**
 * ===============================
 * 8. 工時摘要
 * 只要日期或時間變更，就自動重新計算
 * ===============================
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
 * ===============================
 * 9. 是否為夜班
 * 目前先以「跨日」作為夜班判斷
 * ===============================
 */
const isNightShift = computed(() => {
  return workSummary.value?.crossesMidnight ?? false
})

/**
 * ===============================
 * 10. 薪資估算
 * 先估 gross pay，不含 tax / super
 * ===============================
 */
const payBreakdown = computed(() => {
  if (!workSummary.value) return null

  const weekdayHours = paidSegmentedMinutes.value.weekdayPaidMinutes / 60
  const saturdayHours = paidSegmentedMinutes.value.saturdayPaidMinutes / 60
  const sundayHours = paidSegmentedMinutes.value.sundayPaidMinutes / 60

  // 基本時薪：全部計薪工時都會有
  const basePay = (workSummary.value.paidMinutes / 60) * baseRate.value

  // Casual loading：全部計薪工時都會有
  const casualPay = (workSummary.value.paidMinutes / 60) * casualLoadingRate.value

  // Night shift：你目前先維持「跨日就整段算」
  const shiftPay = isNightShift.value
    ? (workSummary.value.paidMinutes / 60) * shiftLoadingRate.value
    : 0

  // 星期六加成：只算落在星期六的工時
  const saturdayPay = saturdayHours * saturdayLoadingRate.value

  // 星期日加成：只算落在星期日的工時
  const sundayPay = sundayHours * sundayLoadingRate.value

  const grossPay =
    basePay + casualPay + shiftPay + saturdayPay + sundayPay

  return {
    weekdayHours,
    saturdayHours,
    sundayHours,
    basePay,
    casualPay,
    shiftPay,
    saturdayPay,
    sundayPay,
    grossPay,
  }
})

/**
 * ===============================
 * 11. 工具函式：格式化金額
 * ===============================
 */
const formatMoney = (value) => {
  return Number(value).toFixed(2)
}

function getTodayDate() {
  const today = new Date()

  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

/**
 * 
 * 匯出今日薪資Json
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
    grossPay: Number(payBreakdown.value.grossPay.toFixed(2)),
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



const records = ref([])

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

const exportWeeklyCsv = () => {
  if (records.value.length === 0) return

  const header = [
    '日期',
    '開始時間',
    '結束時間',
    '原始工時(分鐘)',
    'smoko次數',
    'smoko扣除(分鐘)',
    '計薪工時(分鐘)',
    '當日薪資',
  ]

  const rows = records.value.map((record) => [
    record.workDate,
    record.startTime,
    record.endTime,
    record.totalMinutes,
    record.smokoCount,
    record.smokoDeductMinutes,
    record.paidMinutes,
    record.grossPay,
  ])

  const csvContent = [header, ...rows]
    .map((row) => row.join(','))
    .join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = 'weekly-summary.csv'
  link.click()

  URL.revokeObjectURL(url)
}

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
        <van-field label="工作日期">
          <template #input>
            <input v-model="workDate" class="native-input" type="date" />
          </template>
        </van-field>

        <van-field label="開始時間">
          <template #input>
            <input
              v-model="startTime"
              class="native-input"
              type="time"
              step="900"
            />
          </template>
        </van-field>

        <van-field label="結束時間">
          <template #input>
            <input
              v-model="endTime"
              class="native-input"
              type="time"
              step="900"
            />
          </template>
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
        <van-cell title="星期六工時" :value="`${formatHours(paidSegmentedMinutes.saturdayPaidMinutes)} 小時`"/>
        <van-cell title="星期日工時" :value="`${formatHours(paidSegmentedMinutes.sundayPaidMinutes)} 小時`"/>
      </van-cell-group>
    </div>

    <!-- 薪資估算 -->
    <div class="section" v-if="payBreakdown">
      <h2>薪資估算</h2>
      <van-cell-group inset>
        <van-cell title="基本薪資" :value="`$${formatMoney(payBreakdown.basePay)}`" />
        <van-cell title="Casual Loading" :value="`$${formatMoney(payBreakdown.casualPay)}`" />
        <van-cell title="夜班加成" :value="`$${formatMoney(payBreakdown.shiftPay)}`" />
        <van-cell title="星期六加成" :value="`$${formatMoney(payBreakdown.saturdayPay)}`" />
        <van-cell title="星期六加成" :value="`$${formatMoney(payBreakdown.sundayPay)}`" />
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
        <van-field v-model.number="baseRate" label="基本時薪" type="number" input-align="right" />
        <van-field
          v-model.number="casualLoadingRate"
          label="Casual 25%"
          type="number"
          input-align="right"
        />
        <van-field
          v-model.number="shiftLoadingRate"
          label="夜班 25%"
          type="number"
          input-align="right"
        />
        <van-field
          v-model.number="saturdayLoadingRate"
          label="星期六 50%"
          type="number"
          input-align="right"
        />
        <van-field
          v-model.number="ppeAllowance"
          label="PPE 津貼"
          type="number"
          input-align="right"
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
  </div>
<div class="section" v-if="payBreakdown">
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
      @click="exportWeeklyCsv"
    >
      匯出本週 CSV
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