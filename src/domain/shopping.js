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

/** 選填的整數 cents；空值回傳 null */
function optionalCents(value, label) {
  if (value === null || value === undefined || value === '') return null
  const cents = Number(value)
  if (!Number.isInteger(cents) || cents < 0 || cents > 1_000_000) throw new Error(`${label}不正確`)
  return cents
}

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
  // 特價商品名稱可能較長（後端上限 200）；手動輸入欄位仍限制 120 字
  if (!name || name.length > 200) throw new Error('品名需為 1–200 字')
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999)
    throw new Error('目標數量需為 1–999')
  if (!Number.isInteger(purchasedQuantity) || purchasedQuantity < 0 || purchasedQuantity > quantity)
    throw new Error('已買數量不可超過目標數量')
  if (!unit || unit.length > 20) throw new Error('單位需為 1–20 字')
  if (note.length > 240) throw new Error('備註不可超過 240 字')
  if (!SHOPPING_PRIORITIES.some((option) => option.id === priority)) throw new Error('無效優先順序')
  if (!['NOW', 'LATER'].includes(bucket)) throw new Error('無效採買安排')
  if (!SHOPPING_STORES.some((option) => option.id === store)) throw new Error('無效店家')

  const packageSize = input.packageSize ? String(input.packageSize).trim() : null
  if (packageSize && packageSize.length > 60) throw new Error('規格不可超過 60 字')
  const promotionId =
    input.promotionId === null || input.promotionId === undefined ? null : Number(input.promotionId)
  if (promotionId !== null && (!Number.isSafeInteger(promotionId) || promotionId < 1))
    throw new Error('無效特價 ID')

  return {
    id,
    name,
    quantity,
    purchasedQuantity,
    unit,
    priority,
    bucket,
    store,
    note,
    promotionId,
    packageSize: packageSize || null,
    estimatedUnitPriceCents: optionalCents(input.estimatedUnitPriceCents, '預估單價'),
    actualUnitPriceCents: optionalCents(input.actualUnitPriceCents, '實際單價'),
  }
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
