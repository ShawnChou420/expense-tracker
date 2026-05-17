/**
 * 將 Date 轉成 YYYY-MM-DD key
 */
export function formatDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const nswHolidayCache = new Map()
const nswHolidayMetaCache = new Map()

const createDateKey = (year, month, day) => {
  return formatDateKey(new Date(year, month - 1, day))
}

const getObservedDateKey = (year, month, day) => {
  const date = new Date(year, month - 1, day)
  const weekday = date.getDay()

  if (weekday === 6) {
    date.setDate(date.getDate() + 2)
  } else if (weekday === 0) {
    date.setDate(date.getDate() + 1)
  }

  return formatDateKey(date)
}

const getNthWeekdayOfMonth = (year, month, weekday, occurrence) => {
  const date = new Date(year, month - 1, 1)
  let matches = 0

  while (date.getMonth() === month - 1) {
    if (date.getDay() === weekday) {
      matches += 1

      if (matches === occurrence) {
        return formatDateKey(date)
      }
    }

    date.setDate(date.getDate() + 1)
  }

  return ''
}

const getEasterSunday = (year) => {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1

  return new Date(year, month - 1, day)
}

const shiftDate = (date, diffDays) => {
  const next = new Date(date)
  next.setDate(next.getDate() + diffDays)
  return formatDateKey(next)
}

/**
 * NSW public holidays used by this calculator.
 *
 * 假設：
 * - 目前以 NSW 為準，因為你現在使用地區是 Sydney。
 * - 採用一般州定假日 + Easter 系列 + 已公告的額外 ANZAC substitute day。
 * - Bank Holiday 不是一般 public holiday，先不列入 penalty 規則。
 * - 若未來政府另外臨時公告新假日，可直接在 declaredAdditionalHolidayMap 補上。
 */
const declaredAdditionalHolidayMap = {
  2026: ['2026-04-27'],
  2027: ['2027-04-26'],
}

export function getNswPublicHolidayMap(year) {
  if (nswHolidayMetaCache.has(year)) {
    return nswHolidayMetaCache.get(year)
  }

  const easterSunday = getEasterSunday(year)
  const holidayMap = new Map([
    [createDateKey(year, 1, 1), 'New Year'],
    [getObservedDateKey(year, 1, 26), 'Australia Day'],
    [shiftDate(easterSunday, -2), 'Good Friday'],
    [shiftDate(easterSunday, -1), 'Easter Sat'],
    [shiftDate(easterSunday, 0), 'Easter Sun'],
    [shiftDate(easterSunday, 1), 'Easter Mon'],
    [createDateKey(year, 4, 25), 'ANZAC Day'],
    [getNthWeekdayOfMonth(year, 6, 1, 2), 'King Birthday'],
    [getNthWeekdayOfMonth(year, 10, 1, 1), 'Labour Day'],
    [createDateKey(year, 12, 25), 'Christmas'],
    [createDateKey(year, 12, 26), 'Boxing Day'],
  ])

  const observedChristmas = getObservedDateKey(year, 12, 25)
  const observedBoxingDay = getObservedDateKey(year, 12, 26)

  if (observedChristmas !== createDateKey(year, 12, 25)) {
    holidayMap.set(observedChristmas, 'Christmas Obs')
  }

  if (observedBoxingDay !== createDateKey(year, 12, 26)) {
    holidayMap.set(observedBoxingDay, 'Boxing Obs')
  }

  for (const extraDate of declaredAdditionalHolidayMap[year] || []) {
    holidayMap.set(extraDate, 'ANZAC Obs')
  }

  nswHolidayMetaCache.set(year, holidayMap)
  return holidayMap
}

export function getNswPublicHolidayKeys(year) {
  if (nswHolidayCache.has(year)) {
    return nswHolidayCache.get(year)
  }

  const holidayKeys = new Set(getNswPublicHolidayMap(year).keys())

  nswHolidayCache.set(year, holidayKeys)
  return holidayKeys
}

export function isNswPublicHoliday(date) {
  return getNswPublicHolidayKeys(date.getFullYear()).has(formatDateKey(date))
}

export function getNswPublicHolidayLabel(date) {
  return getNswPublicHolidayMap(date.getFullYear()).get(formatDateKey(date)) || ''
}

const holidayShortLabelMap = {
  'New Year': 'NY',
  'Australia Day': 'AUS',
  'Good Friday': 'GF',
  'Easter Sat': 'E Sat',
  'Easter Sun': 'E Sun',
  'Easter Mon': 'E Mon',
  'ANZAC Day': 'ANZAC',
  'ANZAC Obs': 'ANZAC+',
  'King Birthday': 'King',
  'Labour Day': 'Labour',
  Christmas: 'Xmas',
  'Christmas Obs': 'Xmas+',
  'Boxing Day': 'Boxing',
  'Boxing Obs': 'Boxing+',
}

export function getNswPublicHolidayShortLabel(date) {
  const label = getNswPublicHolidayLabel(date)
  return holidayShortLabelMap[label] || label
}
