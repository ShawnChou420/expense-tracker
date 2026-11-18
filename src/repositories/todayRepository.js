import { apiRequest, authToken } from '../services/authSession.js'
import { occursOn } from '../domain/today.js'

/**
 * 首頁「今天」：待辦、備註與心情、每日小語。
 * 會員存在資料庫（/api/today 一次取回）；訪客只存在這個分頁的記憶體，重新整理後消失。
 * 日期一律是裝置的本地日期 YYYY-MM-DD。
 */

const guest = {
  nextId: 1,
  /** @type {Map<number, any>} */
  tasks: new Map(),
  /** 重複待辦每一天的完成狀態：`${id}|${date}` */
  completions: new Set(),
  /** @type {Map<string, { content: string, mood: string | null }>} */
  journals: new Map(),
}

/** 只供測試：清空訪客資料 */
export function resetGuestToday() {
  guest.nextId = 1
  guest.tasks.clear()
  guest.completions.clear()
  guest.journals.clear()
}

function guestTasksFor(date) {
  return [...guest.tasks.values()]
    .filter((task) => occursOn(task.repeatType, task.taskDate, date))
    .map((task) => ({
      ...task,
      occurrenceDate: date,
      completed:
        task.repeatType === 'NONE' ? task.completed : guest.completions.has(`${task.id}|${date}`),
    }))
}

function guestOverdue(today) {
  return [...guest.tasks.values()]
    .filter((task) => task.repeatType === 'NONE' && !task.completed && task.taskDate < today)
    .sort((a, b) => a.taskDate.localeCompare(b.taskDate))
    .map((task) => ({ ...task, occurrenceDate: task.taskDate }))
}

function guestJournal(date) {
  const saved = guest.journals.get(date)
  return { date, content: saved?.content ?? '', mood: saved?.mood ?? null, saved: Boolean(saved) }
}

async function guestQuote(date) {
  try {
    return await apiRequest(`/daily-quotes/sample?date=${date}`)
  } catch {
    return null
  }
}

export const todayRepository = {
  /** @param {string} date */
  async load(date) {
    if (authToken.value) return apiRequest(`/today?date=${date}`)
    return {
      date,
      tasks: guestTasksFor(date),
      overdue: guestOverdue(date),
      journal: guestJournal(date),
      quote: await guestQuote(date),
    }
  },

  async tasksFor(date) {
    if (authToken.value) return apiRequest(`/daily-tasks?date=${date}`)
    return guestTasksFor(date)
  },

  async overdueFor(/** @type {string} */ today) {
    if (authToken.value) return apiRequest(`/daily-tasks/overdue?today=${today}`)
    return guestOverdue(today)
  },

  /** @param {{ title: string, description?: string, taskDate: string, repeatType?: string }} task */
  async createTask(task) {
    if (authToken.value) return apiRequest('/daily-tasks', { method: 'POST', body: task })
    const title = String(task.title || '').trim()
    if (!title) throw new Error('請輸入待辦內容')
    const saved = {
      id: guest.nextId++,
      title,
      description: String(task.description || '').trim(),
      taskDate: task.taskDate,
      repeatType: task.repeatType || 'NONE',
      completed: false,
    }
    guest.tasks.set(saved.id, saved)
    return { ...saved, occurrenceDate: saved.taskDate }
  },

  /**
   * 修改內容／日期／重複，或勾選完成。重複待辦勾選時要帶 occurrenceDate。
   * @param {number} id
   * @param {Record<string, any>} patch
   */
  async updateTask(id, patch) {
    if (authToken.value) return apiRequest(`/daily-tasks/${id}`, { method: 'PATCH', body: patch })
    const task = guest.tasks.get(id)
    if (!task) throw new Error('找不到這個待辦')
    for (const key of ['title', 'description', 'taskDate', 'repeatType']) {
      if (key in patch) task[key] = key === 'title' ? String(patch.title).trim() : patch[key]
    }
    if ('completed' in patch) {
      if (task.repeatType === 'NONE') task.completed = patch.completed
      else if (patch.completed) guest.completions.add(`${id}|${patch.occurrenceDate}`)
      else guest.completions.delete(`${id}|${patch.occurrenceDate}`)
    }
    return { ...task }
  },

  async removeTask(/** @type {number} */ id) {
    if (authToken.value) return apiRequest(`/daily-tasks/${id}`, { method: 'DELETE' })
    guest.tasks.delete(id)
  },

  async journalFor(/** @type {string} */ date) {
    if (authToken.value) return apiRequest(`/daily-journal?date=${date}`)
    return guestJournal(date)
  },

  /**
   * 只送有變更的欄位：只點心情不會清掉備註。
   * @param {string} date
   * @param {{ content?: string, mood?: string | null }} changes
   */
  async saveJournal(date, changes) {
    if (authToken.value)
      return apiRequest(`/daily-journal/${date}`, { method: 'PUT', body: changes })
    const current = guestJournal(date)
    guest.journals.set(date, {
      content: 'content' in changes ? String(changes.content ?? '') : current.content,
      mood: 'mood' in changes ? (changes.mood ?? null) : current.mood,
    })
    return guestJournal(date)
  },

  async refreshQuote(/** @type {string} */ date) {
    if (!authToken.value) throw new Error('登入後可以換一句')
    return apiRequest('/daily-quotes/refresh', { method: 'POST', body: { date } })
  },
}
