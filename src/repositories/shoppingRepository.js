import { apiRequest, authToken } from '../services/authSession.js'
import { createShoppingItem } from '../domain/shopping.js'

const guestItems = new Map()
const listeners = new Set()

export function subscribeToShoppingChanges(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyShoppingChanged() {
  for (const listener of listeners) listener()
}

export function getGuestShoppingItems() {
  return [...guestItems.values()].map((item) => ({ ...item }))
}

export const shoppingRepository = {
  async list() {
    if (authToken.value) return (await apiRequest('/shopping-items')).map(createShoppingItem)
    return getGuestShoppingItems()
  },
  async save(value) {
    const item = createShoppingItem(value)
    const saved = authToken.value
      ? createShoppingItem(
          await apiRequest(`/shopping-items/${encodeURIComponent(item.id)}`, {
            method: 'PUT',
            body: item,
          }),
        )
      : item
    if (!authToken.value) guestItems.set(item.id, saved)
    notifyShoppingChanged()
    return saved
  },
  async remove(id) {
    if (authToken.value)
      await apiRequest(`/shopping-items/${encodeURIComponent(id)}`, { method: 'DELETE' })
    else guestItems.delete(String(id))
    notifyShoppingChanged()
  },
}
