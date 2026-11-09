export const SHOPPING_PRIORITIES = [
  { id: 'HIGH', label: '急需' },
  { id: 'NORMAL', label: '一般' },
  { id: 'LOW', label: '不急' },
]

export const SHOPPING_STORES = [
  { id: 'ANY', label: '不限店家' },
  { id: 'WOOLWORTHS', label: 'Woolworths' },
  { id: 'COLES', label: 'Coles' },
  { id: 'ALDI', label: 'ALDI' },
  { id: 'OTHER', label: '其他' },
]

export function createShoppingItem(input) {
  const id = String(input.id || '')
  const name = String(input.name || '').trim()
  const unit = String(input.unit || '件').trim()
  const note = String(input.note || '').trim()
  const quantity = Number(input.quantity)
  const purchasedQuantity = Number(input.purchasedQuantity ?? 0)
  const priority = input.priority || 'NORMAL'
  const bucket = input.bucket || 'NOW'
  const store = input.store || 'ANY'

  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('無效採買項目 ID')
  if (!name || name.length > 120) throw new Error('品名需為 1–120 字')
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999)
    throw new Error('目標數量需為 1–999')
  if (!Number.isInteger(purchasedQuantity) || purchasedQuantity < 0 || purchasedQuantity > quantity)
    throw new Error('已買數量不可超過目標數量')
  if (!unit || unit.length > 20) throw new Error('單位需為 1–20 字')
  if (note.length > 240) throw new Error('備註不可超過 240 字')
  if (!SHOPPING_PRIORITIES.some((option) => option.id === priority)) throw new Error('無效優先順序')
  if (!['NOW', 'LATER'].includes(bucket)) throw new Error('無效採買安排')
  if (!SHOPPING_STORES.some((option) => option.id === store)) throw new Error('無效店家')

  return { id, name, quantity, purchasedQuantity, unit, priority, bucket, store, note }
}

export function completeShoppingItem(item) {
  return createShoppingItem({ ...item, purchasedQuantity: item.quantity })
}

export function reopenShoppingItem(item) {
  return createShoppingItem({ ...item, purchasedQuantity: item.quantity - 1 })
}

export function addPurchasedUnits(item, quantity) {
  return createShoppingItem({
    ...item,
    purchasedQuantity: item.purchasedQuantity + Number(quantity),
  })
}

export function getShoppingSections(items) {
  const rank = { HIGH: 0, NORMAL: 1, LOW: 2 }
  const sorted = [...items].sort(
    (a, b) => rank[a.priority] - rank[b.priority] || a.name.localeCompare(b.name),
  )
  const pending = sorted.filter((item) => item.purchasedQuantity < item.quantity)
  const completed = sorted.filter((item) => item.purchasedQuantity === item.quantity)
  const now = pending.filter((item) => item.bucket === 'NOW')
  return {
    now,
    later: pending.filter((item) => item.bucket === 'LATER'),
    completed,
    completedNow: completed.filter((item) => item.bucket === 'NOW'),
    completedLater: completed.filter((item) => item.bucket === 'LATER'),
    urgentCount: now.filter((item) => item.priority === 'HIGH').length,
    remainingCount: pending.length,
  }
}
