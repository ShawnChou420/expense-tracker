export function formatCalendarAmount(amount) {
  const rounded = Math.round(Number(amount))
  if (!Number.isFinite(rounded)) return '0'
  if (Math.abs(rounded) < 10000) return String(rounded)
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(rounded)
}
