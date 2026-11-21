import { apiRequest, authToken } from '../services/authSession.js'
import { createShoppingItem } from '../domain/shopping.js'
import {
  addShoppingItem,
  buildShoppingExpense,
  splitForCompletion,
} from '../domain/shoppingLists.js'
import { expenseRepository } from './appRepositories.js'

/**
 * 採買清單。會員：後端 /api/shopping-lists（每人一張 ACTIVE 清單）；訪客：只存在記憶體。
 * 完成採買時兩者都會建立一筆既有的「飲食／採買」支出，支出 ID 固定，所以重複送出不會重複記帳。
 */
/** @typedef {ReturnType<typeof createShoppingItem>} ShoppingItem */
/** @typedef {{ id: string, title: string, items: ShoppingItem[] }} GuestList */

const listeners = new Set()
let guestList = newGuestList()
/** 會員目前 ACTIVE 清單的 ID（快取；清單在別的裝置完成時，會在 404／409 後重新取得） */
let memberListId = ''
let memberListToken = ''

/** @returns {GuestList} */
function newGuestList() {
  return { id: `guest-${crypto.randomUUID()}`, title: '採買清單', items: [] }
}

export function subscribeToShoppingChanges(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyShoppingChanged() {
  for (const listener of listeners) listener()
}

export function getGuestShoppingItems() {
  return guestList.items.map((item) => ({ ...item }))
}

function toList(response) {
  return {
    id: response.id,
    title: response.title,
    status: response.status,
    items: (response.items || []).map(createShoppingItem),
  }
}

async function openMemberList() {
  const list = toList(await apiRequest('/shopping-lists', { method: 'POST', body: {} }))
  memberListId = list.id
  memberListToken = authToken.value || ''
  return list
}

async function currentMemberListId() {
  if (memberListId && memberListToken === (authToken.value || '')) return memberListId
  return (await openMemberList()).id
}

/** 清單已在別處完成（409）或不存在（404）時，重新取得 ACTIVE 清單再試一次 */
async function withMemberList(action) {
  try {
    return await action(await currentMemberListId())
  } catch (error) {
    if (![404, 409].includes(/** @type {any} */ (error)?.status)) throw error
    memberListId = ''
    return action(await currentMemberListId())
  }
}

const itemPath = (listId, id) =>
  `/shopping-lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(id)}`

export const shoppingRepository = {
  /** 目前清單（含品項） */
  async active() {
    if (authToken.value) return openMemberList()
    return { ...guestList, status: 'ACTIVE', items: getGuestShoppingItems() }
  },
  async list() {
    return (await this.active()).items
  },
  /** 加入品項；同一筆特價會合併數量。回傳 { item, merged } */
  async add(value) {
    const item = createShoppingItem(value)
    let result
    if (authToken.value) {
      const saved = await withMemberList((listId) =>
        apiRequest(`/shopping-lists/${encodeURIComponent(listId)}/items`, {
          method: 'POST',
          body: item,
        }),
      )
      result = {
        item: createShoppingItem(saved),
        merged: Boolean(saved.merged),
      }
    } else {
      const next = addShoppingItem(guestList.items, item)
      guestList = { ...guestList, items: next.items }
      result = { item: next.item, merged: next.merged }
    }
    notifyShoppingChanged()
    return result
  },
  /** 更新既有品項（整筆欄位） */
  async save(value) {
    const item = createShoppingItem(value)
    let saved = item
    if (authToken.value) {
      saved = createShoppingItem(
        await withMemberList((listId) =>
          apiRequest(itemPath(listId, item.id), {
            method: 'PATCH',
            body: item,
          }),
        ),
      )
    } else {
      guestList = {
        ...guestList,
        items: guestList.items.some((entry) => entry.id === item.id)
          ? guestList.items.map((entry) => (entry.id === item.id ? item : entry))
          : [...guestList.items, item],
      }
    }
    notifyShoppingChanged()
    return saved
  },
  async remove(id) {
    if (authToken.value)
      await withMemberList((listId) => apiRequest(itemPath(listId, id), { method: 'DELETE' }))
    else
      guestList = {
        ...guestList,
        items: guestList.items.filter((item) => item.id !== String(id)),
      }
    notifyShoppingChanged()
  },
  /**
   * 完成採買：建立一筆支出並結束這張清單，沒買到的數量移到新清單。
   * @param {{ listId: string, title?: string, date: string, amountCents: number, itemCount: number }} input
   */
  async complete(input) {
    const expense = buildShoppingExpense(input)
    let result
    if (authToken.value) {
      result = await apiRequest(`/shopping-lists/${encodeURIComponent(input.listId)}/complete`, {
        method: 'POST',
        body: { expense },
      })
      memberListId = result.nextListId || ''
    } else {
      if (input.listId !== guestList.id) throw new Error('這張清單已完成')
      await expenseRepository.save(expense)
      const { carryOver } = splitForCompletion(guestList.items, () => crypto.randomUUID())
      guestList = { ...newGuestList(), items: carryOver }
      result = {
        expenseId: expense.id,
        alreadyCompleted: false,
        nextListId: guestList.id,
      }
    }
    notifyShoppingChanged()
    return result
  },
}
