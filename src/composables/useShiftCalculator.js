import { computed } from 'vue'

import { roundTo } from '../utils/number'
import {
  isValidTime,
  parseTimeToMinutes,
} from '../utils/time'

export function useShiftCalculator({
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
}) {
  /**
   * 判斷這一班是星期幾開始
   * 0=Sun, 5=Fri, 6=Sat
   */
  const shiftStartDay = computed(() => {
    if (!workDate.value) return null

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

  /**
   * smoko 規則：
   * - 只要有上班：至少 1 次
   * - 滿 8 小時：2 次
   *
   * 假設：
   * - 目前不區分遲到、早退或短班，只要有計入班別就會有 1 次 smoko。
   * - 這裡只調整 smoko 次數規則，不更動每次 smoko 扣除分鐘數。
   */
  const getSmokoCount = (totalMinutes) => {
    if (totalMinutes >= 8 * 60) return 2
    if (totalMinutes > 0) return 1
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

  /**
   * 星期六工時拆分規則
   * - 星期五打卡跨到星期六 => Sat ORD
   * - 星期六打卡上班 => overtime
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

    if (shiftStartDay.value === 5) {
      return {
        satOrdMinutes: saturdayPaidMinutes,
        timeHalfMinutes: 0,
        doubleMinutes: 0,
      }
    }

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

    const satOrdHours = roundTo(saturdayRuleBreakdown.value.satOrdMinutes / 60, 4)
    const timeHalfHours = roundTo(saturdayRuleBreakdown.value.timeHalfMinutes / 60, 4)
    const doubleHours = roundTo(saturdayRuleBreakdown.value.doubleMinutes / 60, 4)

    const basePay = roundTo(paidHours * baseRate.value, 2)
    const casualPay = roundTo(paidHours * casualLoadingRate.value, 2)
    const shiftPay = isNightShift.value
      ? roundTo(paidHours * shiftLoadingRate.value, 2)
      : 0

    const satOrdPay = roundTo(satOrdHours * saturdayOrdLoadingRate.value, 2)
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

  return {
    shiftStartDay,
    workSummary,
    isNightShift,
    segmentedMinutes,
    paidSegmentedMinutes,
    saturdayRuleBreakdown,
    payBreakdown,
  }
}
