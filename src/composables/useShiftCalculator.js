import { computed } from 'vue'
import { roundTo } from '../utils/number.js'
import {
  isValidTime,
  parseTimeToMinutes,
} from '../utils/time.js'
import {
  isNswPublicHoliday,
} from '../utils/holidays.js'

export function useShiftCalculator({
  workDate,//工作日
  startTime,//開始時間
  endTime,//結束時間
  smokoMinutesPerBreak,//smoko時間（固定30分鐘）
  baseRate,//基本時薪(晚班)
  casualLoadingRate,//臨時工補貼(0.25倍)
  shiftLoadingRate,//班別加給(0.25倍)
  saturdayOrdLoadingRate,//星期六加成(0.5倍)
  sundayLoadingRate,//星期日加成(0.75倍)
  timeHalfRate,//加班(1.5倍)
  doubleRate,//(2倍)
  
}) {
  /**
   * 判斷這一班是星期幾開始,
   * 0=Sun, 5=Fri, 6=Sat
   */
  const shiftStartDay = computed(() => {
    if (!workDate.value) return null //如果沒有輸入工作日就不計算

    /**
     * 這是因為 JS Date 吃這種標準格式：
      YYYY-MM-DDTHH:mm
      例如：
      2026-03-29T21:43
     * 
     */
    const start = new Date(`${workDate.value}T${startTime.value}`)
    return start.getDay()
  })

  /**
   * 計算整段班的原始工時
   * 若結束時間 <= 開始時間，視為跨日
   */
  const calculateWorkMinutes = (startText, endText) => {
    if (!isValidTime(startText) || !isValidTime(endText)) {
      return null
    }

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
      const day = current.getDay()

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
   * 假設：
   * - 目前改為以 NSW public holiday 日曆為準。
   * - 這包含 Easter 系列、Christmas / Boxing Day，以及已公告的額外補假日。
   * - 若班別只部分跨到節日，僅該節日時段改套節日 penalty，不默默放大整段班。
   */
  const getHolidayMinutes = (start, end) => {
    let holidayMinutes = 0
    const current = new Date(start)

    while (current < end) {
      const next = new Date(current)
      next.setMinutes(next.getMinutes() + 15)

      if (next > end) {
        next.setTime(end.getTime())
      }

      const diffMinutes = (next - current) / 60000

      if (isNswPublicHoliday(current)) {
        holidayMinutes += diffMinutes
      }

      current.setTime(next.getTime())
    }

    return holidayMinutes
  }

  const getOverlapMinutes = (rangeStart, rangeEnd, blockStart, blockEnd) => {
    const start = Math.max(rangeStart.getTime(), blockStart.getTime())
    const end = Math.min(rangeEnd.getTime(), blockEnd.getTime())

    if (end <= start) return 0
    return (end - start) / 60000
  }

  /**
   * 依 smoko 規則建立 break 視窗。
   *
   * 假設：
   * - 第 1 次 smoko 在上班後第 4 小時尾端
   * - 第 2 次 smoko 在上班後第 8 小時尾端
   * - 若 break 超出下班時間，會自動截到下班
   */
  const getSmokoWindows = (shiftStart, shiftEnd, smokoCount, smokoMinutes) => {
    const windows = []
    const blockEndOffsets = []

    if (smokoCount >= 1) blockEndOffsets.push(240)
    if (smokoCount >= 2) blockEndOffsets.push(480)

    for (const offsetMinutes of blockEndOffsets) {
      const blockEnd = new Date(shiftStart.getTime() + offsetMinutes * 60000)
      const breakEnd = blockEnd > shiftEnd ? shiftEnd : blockEnd
      const breakStart = new Date(
        Math.max(shiftStart.getTime(), breakEnd.getTime() - smokoMinutes * 60000),
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

  const getWindowDeductMinutes = (rangeStart, rangeEnd, windows) => {
    return windows.reduce((sum, window) => {
      return sum + getOverlapMinutes(rangeStart, rangeEnd, window.start, window.end)
    }, 0)
  }

  /**
   * 精準切出扣完 smoko 之後的實際計薪分鐘。
   *
   * 這裡不再用「先整段算完再從 weekday/saturday/sunday 順序扣」，
   * 改成直接從 smoko 實際發生的時間視窗扣除，才比較接近 payslip。
   *
   * 同時把 paid minutes 拆成後續計薪會用到的 bucket：
   * - weekday / saturday / sunday
   * - holiday
   */
  const getPaidMinutesBreakdown = (start, end, smokoWindows) => {
    let weekdayPaidMinutes = 0
    let saturdayPaidMinutes = 0
    let sundayPaidMinutes = 0
    let holidayPaidMinutes = 0

    const current = new Date(start)

    while (current < end) {
      const nextBoundary = new Date(current)
      nextBoundary.setHours(24, 0, 0, 0)

      const segmentEnd = nextBoundary < end ? nextBoundary : end
      const rawMinutes = (segmentEnd - current) / 60000
      const deductMinutes = getWindowDeductMinutes(current, segmentEnd, smokoWindows)
      const paidMinutes = Math.max(rawMinutes - deductMinutes, 0)
      const day = current.getDay()

      if (day === 6) {
        saturdayPaidMinutes += paidMinutes
      } else if (day === 0) {
        sundayPaidMinutes += paidMinutes
      } else {
        weekdayPaidMinutes += paidMinutes
      }

      if (isNswPublicHoliday(current)) {
        holidayPaidMinutes += paidMinutes
      }

      current.setTime(segmentEnd.getTime())
    }

    return {
      weekdayPaidMinutes,
      saturdayPaidMinutes,
      sundayPaidMinutes,
      holidayPaidMinutes,
    }
  }

  /**
   * 舊版曾用比例分配 / 順序扣 smoko。
   * 目前保留這段註解作為歷史背景，但實際計算已改成 break window 精準扣除。
   */

  /**
   * smoko 規則：
   * - 滿 4 小時：1 次
   * - 滿 8 小時：2 次
   *
   * 假設：
   * - 未滿 4 小時：0 次
   * - 目前不區分遲到、早退或短班，只依總工時判斷 smoko 次數。
   * - 這裡只調整 smoko 次數規則，不更動每次 smoko 扣除分鐘數。
   */
  const getSmokoCount = (totalMinutes) => {
    if (totalMinutes >= 8 * 60) return 2
    if (totalMinutes >= 4 * 60) return 1
    return 0
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

  const isNightShift = computed(() => {
    if (!workSummary.value || !startTime.value || !endTime.value) return false

    /**
     * 假設：
     * - 夜班 allowance 不只限於「跨日」。
     * - 若班別從凌晨開始（例如 00:30）也視為 night shift。
     *
     * 這是依 payslip 對帳結果補正，避免 00:30-07:00 這類班別漏掉 SHIFT 25%。
     */
    return workSummary.value.crossesMidnight || startTime.value < '06:00'
  })

  const holidaySummary = computed(() => {
    const range = getShiftDateTimeRange()

    if (!range || !workSummary.value) {
      return {
        holidayMinutes: 0,
        holidayPaidMinutes: 0,
      }
    }

    const smokoWindows = getSmokoWindows(
      range.start,
      range.end,
      workSummary.value.smokoCount,
      smokoMinutesPerBreak.value,
    )
    const paidBreakdown = getPaidMinutesBreakdown(range.start, range.end, smokoWindows)

    return {
      holidayMinutes: getHolidayMinutes(range.start, range.end),
      holidayPaidMinutes: paidBreakdown.holidayPaidMinutes,
    }
  })

  /**
   * 將實際計薪分鐘數按比例分攤到：
   * - 平日
   * - 星期六
   * - 星期日
   *
   * 目前改為依 smoko 實際發生的時間視窗扣除，
   * 比原本比例分配更接近 payslip 的算法。
   */
  const paidSegmentedMinutes = computed(() => {
    const range = getShiftDateTimeRange()

    if (!workSummary.value || !range) {
      return {
        weekdayPaidMinutes: 0,
        saturdayPaidMinutes: 0,
        sundayPaidMinutes: 0,
      }
    }

    const smokoWindows = getSmokoWindows(
      range.start,
      range.end,
      workSummary.value.smokoCount,
      smokoMinutesPerBreak.value,
    )

    const {
      weekdayPaidMinutes,
      saturdayPaidMinutes,
      sundayPaidMinutes,
      holidayPaidMinutes,
    } = getPaidMinutesBreakdown(range.start, range.end, smokoWindows)

    return {
      weekdayPaidMinutes,
      saturdayPaidMinutes,
      sundayPaidMinutes,
      holidayPaidMinutes,
    }
  })

  /**
   * 星期六工時拆分規則
   *
   * 依這期 payslip 對帳結果，星期六 paid hours 先視為 overtime：
   * - 前 3 小時 => T/Half
   * - 之後 => Double
   *
   * 先不再使用先前的 Fri->Sat Sat ORD 規則，避免和實際 payslip 不一致。
   */
  const saturdayRuleBreakdown = computed(() => {
    const saturdayPaidMinutes = paidSegmentedMinutes.value.saturdayPaidMinutes

    if (!saturdayPaidMinutes) {
      return {
        satOrdMinutes: 0,
        timeHalfMinutes: 0,
        doubleMinutes: 0,
      }
    }

    return {
      satOrdMinutes: 0,
      timeHalfMinutes: Math.min(saturdayPaidMinutes, 180),
      doubleMinutes: Math.max(saturdayPaidMinutes - 180, 0),
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
    const holidayHours = roundTo(holidaySummary.value.holidayPaidMinutes / 60, 4)

    const satOrdHours = roundTo(saturdayRuleBreakdown.value.satOrdMinutes / 60, 4)
    const timeHalfHours = roundTo(saturdayRuleBreakdown.value.timeHalfMinutes / 60, 4)
    const doubleHours = roundTo(saturdayRuleBreakdown.value.doubleMinutes / 60, 4)
    const ordinaryHours = roundTo(
      Math.max(paidHours - timeHalfHours - doubleHours, 0),
      4,
    )
    const regularNightHours = roundTo(
      Math.max(
        ordinaryHours -
          holidayHours -
          sunOrdHours -
          satOrdHours,
        0,
      ),
      4,
    )

    const basePay = roundTo(ordinaryHours * baseRate.value, 2)
    const casualPay = roundTo(ordinaryHours * casualLoadingRate.value, 2)
    const shiftPay = isNightShift.value
      ? roundTo(regularNightHours * shiftLoadingRate.value, 2)
      : 0
    /**
     * 特殊節日依 payslip / 人資說明，使用第一行
     * POULTRY PROCESSING AWARD - CASUAL - LEVEL 1 的基本時薪
     * 去計算 PH/OL penalty 150%。
     *
     * 也就是：
     * - 先照原本 base pay 計入該節日時數
     * - 再額外加上 1.5 倍 base rate 的 holiday penalty
     * - 不使用 shift 25% 去算該節日時段
     */
    const holidayPenaltyRate = roundTo(baseRate.value * 1.5, 3)
    const holidayPenaltyPay = roundTo(holidayHours * holidayPenaltyRate, 2)

    const satOrdPay = roundTo(satOrdHours * saturdayOrdLoadingRate.value, 2)
    const timeHalfPay = roundTo(timeHalfHours * timeHalfRate.value, 2)
    const doublePay = roundTo(doubleHours * doubleRate.value, 2)
    const sunOrdPay = roundTo(sunOrdHours * sundayLoadingRate.value, 2)

    const grossPay = roundTo(
      basePay +
        casualPay +
        shiftPay +
        holidayPenaltyPay +
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
      holidayHours,
      ordinaryHours,
      satOrdHours,
      timeHalfHours,
      doubleHours,
      basePay,
      casualPay,
      shiftPay,
      holidayPenaltyRate,
      holidayPenaltyPay,
      satOrdPay,
      timeHalfPay,
      doublePay,
      sunOrdPay,
      grossPay,
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
