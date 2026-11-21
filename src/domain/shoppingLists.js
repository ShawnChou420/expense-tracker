/**
 * 採買清單的金額與完成採買邏輯（純函式）。
 * 預估金額＝數量 × 預估單價；沒有價格的品項另外計數，不當成 0 元。
 * 完成採買時的規則與後端 ShoppingListService 一致：買到的部分留在這張清單，
 * 沒買到的數量移到下一張清單。
 */
import { createExpense } from './expenses.js'
import { createShoppingItem } from './shopping.js'

export const SHOPPING_EXPENSE_PREFIX = 'shopping-list-'
const MAX_QUANTITY = 999

/** 一個品項買到的部分要算多少錢：有實際單價用實際單價，否則用預估單價 */
function purchasedUnitPrice(item) {
  return Number.isInteger(item.actualUnitPriceCents)
    ? item.actualUnitPriceCents
    : item.estimatedUnitPriceCents
}

/**
 * @param {Array<ReturnType<typeof createShoppingItem>>} items
 * @param {{ bucket?: 'NOW' | 'LATER' }} [options] 只計算某個採買安排（預設「這次買」）
 */
export function estimateShoppingTotals(items, { bucket = 'NOW' } = {}) {
  let estimatedCents = 0
  let unpricedCount = 0
  let purchasedCents = 0
  let purchasedUnpricedCount = 0
  let purchasedCount = 0
  for (const item of items) {
    if (item.bucket !== bucket) continue
    const estimated = item.estimatedUnitPriceCents
    if (typeof estimated === 'number') estimatedCents += item.quantity * estimated
    else unpricedCount += 1
    if (item.purchasedQuantity > 0) {
      purchasedCount += 1
      const price = purchasedUnitPrice(item)
      if (typeof price === 'number') purchasedCents += item.purchasedQuantity * price
      else purchasedUnpricedCount += 1
    }
  }
  return {
    estimatedCents,
    unpricedCount,
    purchasedCents,
    purchasedUnpricedCount,
    purchasedCount,
  }
}

/**
 * 加入品項（訪客模式用，登入時由後端做同樣的事）：
 * 同一個 ID 重送不重複加入；同一筆特價已在清單裡時只增加數量。
 * @returns {{ items: Array<ReturnType<typeof createShoppingItem>>, item: ReturnType<typeof createShoppingItem>, merged: boolean }}
 */
export function addShoppingItem(items, value) {
  const incoming = createShoppingItem(value)
  const sameId = items.find((item) => item.id === incoming.id)
  if (sameId) return { items, item: sameId, merged: false }
  if (incoming.promotionId !== null) {
    const same = items.find((item) => item.promotionId === incoming.promotionId)
    if (same) {
      const updated = createShoppingItem({
        ...same,
        quantity: Math.min(MAX_QUANTITY, same.quantity + incoming.quantity),
      })
      return {
        items: items.map((item) => (item.id === same.id ? updated : item)),
        item: updated,
        merged: true,
      }
    }
  }
  return { items: [...items, incoming], item: incoming, merged: false }
}

/**
 * 完成採買時的拆分：
 * - purchased：留在已完成清單的品項，數量改成實際買到的數量
 * - carryOver：沒買到的數量（完全沒買的保留原 ID；買一部分的剩餘數量用 newId() 產生新 ID）
 * @param {() => string} newId
 */
export function splitForCompletion(items, newId) {
  const purchased = []
  const carryOver = []
  for (const item of items) {
    if (item.purchasedQuantity === 0) {
      carryOver.push(item)
      continue
    }
    purchased.push(createShoppingItem({ ...item, quantity: item.purchasedQuantity }))
    if (item.purchasedQuantity < item.quantity)
      carryOver.push(
        createShoppingItem({
          ...item,
          id: newId(),
          quantity: item.quantity - item.purchasedQuantity,
          purchasedQuantity: 0,
          actualUnitPriceCents: null,
        }),
      )
  }
  return { purchased, carryOver }
}

/** 完成採買對應的支出 ID：固定值，所以重複送出只會更新同一筆，不會重複記帳 */
export function shoppingExpenseId(listId) {
  return `${SHOPPING_EXPENSE_PREFIX}${listId}`
}

/**
 * 完成採買要建立的支出（既有的支出格式：單次、已付款、飲食／採買）。
 * @param {{ listId: string, title?: string, date: string, amountCents: number, itemCount: number }} input
 */
export function buildShoppingExpense({ listId, title, date, amountCents, itemCount }) {
  return createExpense({
    id: shoppingExpenseId(listId),
    date,
    amountCents,
    group: 'FOOD',
    category: 'GROCERIES',
    title: title || '超市採買',
    note: `採買清單完成，共 ${itemCount} 項`,
    status: 'PAID',
    frequency: 'NONE',
  })
}

/** 「這次買」還沒買完的品項數與預估總額（特價頁底部的已選摘要） */
export function selectionSummary(items) {
  const pending = items.filter(
    (item) => item.bucket === 'NOW' && item.purchasedQuantity < item.quantity,
  )
  return { count: pending.length, estimatedCents: estimateShoppingTotals(items).estimatedCents }
}

/**
 * 完成採買時預設的實際購買數量：已經勾選過任何品項時沿用已買數量；
 * 一項都還沒勾時，預設「這次買」全部買齊，讓使用者只需要修改沒買到的。
 * @returns {Record<string, number>} 品項 ID → 數量
 */
export function defaultPurchasedQuantities(items) {
  const now = items.filter((item) => item.bucket === 'NOW')
  const anyMarked = now.some((item) => item.purchasedQuantity > 0)
  return Object.fromEntries(
    now.map((item) => [item.id, anyMarked ? item.purchasedQuantity : item.quantity]),
  )
}

/**
 * 依確認後的實際購買數量計算預估金額（有實際單價用實際單價，否則用預估單價）。
 * @param {Record<string, number>} quantities
 */
export function purchasedEstimate(items, quantities) {
  let cents = 0
  let unpriced = 0
  let count = 0
  for (const item of items) {
    const quantity = quantities[item.id] || 0
    if (quantity <= 0) continue
    count += 1
    const price = purchasedUnitPrice(item)
    if (typeof price === 'number') cents += quantity * price
    else unpriced += 1
  }
  return { cents, unpriced, count }
}
