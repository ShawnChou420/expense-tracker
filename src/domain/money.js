/** Money values in domain logic are integer cents to avoid float drift. */
export function dollarsToCents(value) {
  if (value === '' || value === null || value === undefined) return null
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue < 0) return null
  return Math.round((numericValue + Number.EPSILON) * 100)
}

export function signedDollarsToCents(value) {
  if (value === '' || value === null || value === undefined) return null
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return null
  const cents = Math.round((Math.abs(numericValue) + Number.EPSILON) * 100)
  return Number.isSafeInteger(cents) ? Math.sign(numericValue) * cents : null
}

export function centsToDollars(cents) {
  return (Number(cents) || 0) / 100
}

export function sumCents(values) {
  return values.reduce((sum, value) => sum + (Number.isInteger(value) ? value : 0), 0)
}

export function formatAud(cents) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centsToDollars(cents))
}

export function formatCentsInput(cents) {
  return centsToDollars(cents).toFixed(2)
}
