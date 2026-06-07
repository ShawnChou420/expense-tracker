import { computed } from 'vue'
import { roundTo } from '../utils/number.js'
import { isValidTime, parseTimeToMinutes } from '../utils/time.js'
import { isNswPublicHoliday } from '../utils/holidays.js'

export function useShiftCalculator({
  workDate,
  startTime,
  endTime,
  smokoMinutesPerBreak,
  baseRate,
  casualLoadingRate,
  shiftLoadingRate,
  saturdayOrdLoadingRate,
  sundayLoadingRate,
  timeHalfRate,
  doubleRate,
}) {
  
  // 1. 判斷這一班是星期幾開始 (0=Sun, 6=Sat)
  const shiftStartDay = computed(() => {
    if (!workDate.value) return null
    return new Date(`${workDate.value}T${startTime.value}`).getDay()
  })

  // ============================================================================
  // 內部工具函數 (Helper Functions) - 邏輯重構與簡化
  // ============================================================================

  /**
   * 計算整段班的原始工時 (分鐘) 與是否跨日
   */
  const calculateWorkMinutes = (startText, endText) => {
    if (!isValidTime(startText) || !isValidTime(endText)) return null

    const startMinutes = parseTimeToMinutes(startText)
    const endMinutes = parseTimeToMinutes(endText)
    if (startMinutes === null || endMinutes === null) return null

    const crossesMidnight = endMinutes <= startMinutes
    const totalMinutes = crossesMidnight 
      ? (24 * 60) - startMinutes + endMinutes 
      : endMinutes - startMinutes

    return { startMinutes, endMinutes, totalMinutes, crossesMidnight }
  }

  /**
   * 取得實際起訖的 Date 物件 (自動處理跨日)
   */
  const getShiftDateTimeRange = () => {
    if (!workDate.value || !startTime.value || !endTime.value) return null

    const start = new Date(`${workDate.value}T${startTime.value}`)
    const end = new Date(`${workDate.value}T${endTime.value}`)
    
    if (end <= start) end.setDate(end.getDate() + 1)

    return { start, end }
  }

  /**
   * (優化) 取得兩段時間的交集分鐘數
   */
  const getOverlapMinutes = (rangeStart, rangeEnd, blockStart, blockEnd) => {
    const overlapStart = Math.max(rangeStart.getTime(), blockStart.getTime())
    const overlapEnd = Math.min(rangeEnd.getTime(), blockEnd.getTime())
    return Math.max(0, (overlapEnd - overlapStart) / 60000)
  }

  /**
   * 依 smoko 規則建立休息時間視窗 (Break Windows)
   * 第 1 次在第 4 小時尾端，第 2 次在第 8 小時尾端
   */
  const getSmokoWindows = (shiftStart, shiftEnd, smokoCount, smokoMinutes) => {
    const windows = []
    const offsets = []
    if (smokoCount >= 1) offsets.push(4 * 60) // 4小時
    if (smokoCount >= 2) offsets.push(8 * 60) // 8小時

    for (const offsetMinutes of offsets) {
      const blockEnd = new Date(shiftStart.getTime() + offsetMinutes * 60000)
      const breakEnd = blockEnd > shiftEnd ? shiftEnd : blockEnd
      const breakStart = new Date(Math.max(shiftStart.getTime(), breakEnd.getTime() - smokoMinutes * 60000))
      
      if (breakEnd > breakStart) {
        windows.push({ start: breakStart, end: breakEnd })
      }
    }
    return windows
  }

  /**
   * (優化) 將時段依據「午夜 (Midnight)」切割，並精準計算平日/假日/國定假日分鐘數
   * 這是取代原本 15 分鐘迴圈的核心引擎，效能更好且邏輯一致
   */
  const calculateSegmentedMinutes = (start, end, smokoWindows = []) => {
    let weekday = 0, saturday = 0, sunday = 0, holiday = 0
    let current = new Date(start)

    while (current < end) {
      // 尋找下一個午夜作為切割點
      const nextMidnight = new Date(current)
      nextMidnight.setHours(24, 0, 0, 0)
      const segmentEnd = nextMidnight < end ? nextMidnight : end
      
      // 計算該區段的原始時間，並扣除落在該區段內的 smoko 時間
      const rawMinutes = (segmentEnd - current) / 60000
      const deductMinutes = smokoWindows.reduce((sum, window) => 
        sum + getOverlapMinutes(current, segmentEnd, window.start, window.end)
      , 0)
      const actualMinutes = Math.max(0, rawMinutes - deductMinutes)

      // 分配分鐘數到對應的日子
      const day = current.getDay()
      if (day === 6) saturday += actualMinutes
      else if (day === 0) sunday += actualMinutes
      else weekday += actualMinutes

      // 國定假日獨立累加
      if (isNswPublicHoliday(current)) {
        holiday += actualMinutes
      }

      // 前進到下一段
      current = segmentEnd
    }

    return { weekday, saturday, sunday, holiday }
  }

  const getSmokoCount = (totalMinutes) => {
    if (totalMinutes >= 8 * 60) return 2
    if (totalMinutes >= 4 * 60) return 1
    return 0
  }

  // ============================================================================
  // Computed 屬性 (對外曝露的資料) - 維持原貌
  // ============================================================================

  const workSummary = computed(() => {
    const result = calculateWorkMinutes(startTime.value, endTime.value)
    if (!result) return null

    const smokoCount = getSmokoCount(result.totalMinutes)
    const smokoDeductMinutes = smokoCount * smokoMinutesPerBreak.value
    
    return {
      ...result,
      smokoCount,
      smokoDeductMinutes,
      paidMinutes: result.totalMinutes - smokoDeductMinutes,
    }
  })

  // 原始班別切段結果 (尚未扣 smoko)
  const segmentedMinutes = computed(() => {
    const range = getShiftDateTimeRange()
    if (!range) return { weekdayMinutes: 0, saturdayMinutes: 0, sundayMinutes: 0 }

    const result = calculateSegmentedMinutes(range.start, range.end)
    return {
      weekdayMinutes: result.weekday,
      saturdayMinutes: result.saturday,
      sundayMinutes: result.sunday,
    }
  })

  // 實際計薪分鐘數切段 (已扣除 smoko)
  const paidSegmentedMinutes = computed(() => {
    const range = getShiftDateTimeRange()
    if (!workSummary.value || !range) {
      return { weekdayPaidMinutes: 0, saturdayPaidMinutes: 0, sundayPaidMinutes: 0, holidayPaidMinutes: 0 }
    }

    const windows = getSmokoWindows(range.start, range.end, workSummary.value.smokoCount, smokoMinutesPerBreak.value)
    const result = calculateSegmentedMinutes(range.start, range.end, windows)

    return {
      weekdayPaidMinutes: result.weekday,
      saturdayPaidMinutes: result.saturday,
      sundayPaidMinutes: result.sunday,
      holidayPaidMinutes: result.holiday,
    }
  })

  const holidaySummary = computed(() => {
    const range = getShiftDateTimeRange()
    if (!range || !workSummary.value) return { holidayMinutes: 0, holidayPaidMinutes: 0 }

    // 取得未扣 Smoko 的假日時間
    const rawResult = calculateSegmentedMinutes(range.start, range.end)
    return {
      holidayMinutes: rawResult.holiday,
      holidayPaidMinutes: paidSegmentedMinutes.value.holidayPaidMinutes,
    }
  })

  const isNightShift = computed(() => {
    if (!workSummary.value || !startTime.value || !endTime.value) return false
    return workSummary.value.crossesMidnight || startTime.value < '06:00'
  })

  const saturdayRuleBreakdown = computed(() => {
    const satMinutes = paidSegmentedMinutes.value.saturdayPaidMinutes
    if (!satMinutes) return { satOrdMinutes: 0, timeHalfMinutes: 0, doubleMinutes: 0 }

    return {
      satOrdMinutes: 0,
      timeHalfMinutes: Math.min(satMinutes, 180),
      doubleMinutes: Math.max(satMinutes - 180, 0),
    }
  })

  const payBreakdown = computed(() => {
    if (!workSummary.value) return null

    const weekdayHours = roundTo(paidSegmentedMinutes.value.weekdayPaidMinutes / 60, 4)
    const saturdayHours = roundTo(paidSegmentedMinutes.value.saturdayPaidMinutes / 60, 4)
    const sunOrdHours = roundTo(paidSegmentedMinutes.value.sundayPaidMinutes / 60, 4)
    const paidHours = roundTo(workSummary.value.paidMinutes / 60, 4)
    const holidayHours = roundTo(holidaySummary.value.holidayPaidMinutes / 60, 4)

    const satOrdHours = roundTo(saturdayRuleBreakdown.value.satOrdMinutes / 60, 4)
    const timeHalfHours = roundTo(saturdayRuleBreakdown.value.timeHalfMinutes / 60, 4)
    const doubleHours = roundTo(saturdayRuleBreakdown.value.doubleMinutes / 60, 4)
    
    const ordinaryHours = roundTo(Math.max(paidHours - timeHalfHours - doubleHours, 0), 4)
    const regularNightHours = roundTo(Math.max(ordinaryHours - holidayHours - sunOrdHours - satOrdHours, 0), 4)

    const basePay = roundTo(ordinaryHours * baseRate.value, 2)
    const casualPay = roundTo(ordinaryHours * casualLoadingRate.value, 2)
    const shiftPay = isNightShift.value ? roundTo(regularNightHours * shiftLoadingRate.value, 2) : 0
    
    const holidayPenaltyRate = roundTo(baseRate.value * 1.5, 3)
    const holidayPenaltyPay = roundTo(holidayHours * holidayPenaltyRate, 2)

    const satOrdPay = roundTo(satOrdHours * saturdayOrdLoadingRate.value, 2)
    const timeHalfPay = roundTo(timeHalfHours * timeHalfRate.value, 2)
    const doublePay = roundTo(doubleHours * doubleRate.value, 2)
    const sunOrdPay = roundTo(sunOrdHours * sundayLoadingRate.value, 2)

    const grossPay = roundTo(
      basePay + casualPay + shiftPay + holidayPenaltyPay + satOrdPay + timeHalfPay + doublePay + sunOrdPay, 
      2
    )

    return {
      weekdayHours, saturdayHours, sunOrdHours, holidayHours,
      ordinaryHours, satOrdHours, timeHalfHours, doubleHours,
      basePay, casualPay, shiftPay, holidayPenaltyRate, holidayPenaltyPay,
      satOrdPay, timeHalfPay, doublePay, sunOrdPay, grossPay,
    }
  })

  return {
    shiftStartDay,
    workSummary,
    isNightShift,
    holidaySummary,
    segmentedMinutes,
    paidSegmentedMinutes,
    saturdayRuleBreakdown,
    payBreakdown,
  }
}