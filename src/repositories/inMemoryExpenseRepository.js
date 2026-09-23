// Temporary storage: records disappear when the app is closed or reloaded.
export function createInMemoryExpenseRepository() {
  const records = new Map()
  return {
    async list() {
      return [...records.values()].map((record) => ({ ...record }))
    },
    async save(record) {
      records.set(record.id, { ...record })
      return { ...record }
    },
    async remove(id) {
      records.delete(id)
    },
  }
}
