import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/authSession.js', async () => {
  const { ref } = await import('vue')
  return {
    authToken: ref(null),
    apiRequest: vi.fn(async (path) => {
      if (path.startsWith('/daily-quotes/sample')) return { quoteId: 1, content: '休息一下' }
      throw new Error('unexpected ' + path)
    }),
  }
})

const { todayRepository, resetGuestToday } = await import('./todayRepository.js')
const { apiRequest, authToken } = await import('../services/authSession.js')

describe('todayRepository（訪客）', () => {
  beforeEach(() => {
    resetGuestToday()
    authToken.value = null
  })

  it('重複待辦今天完成不影響明天', async () => {
    const task = await todayRepository.createTask({
      title: '健身',
      taskDate: '2026-11-18',
      repeatType: 'DAILY',
    })
    await todayRepository.updateTask(task.id, { completed: true, occurrenceDate: '2026-11-18' })
    expect((await todayRepository.tasksFor('2026-11-18'))[0].completed).toBe(true)
    expect((await todayRepository.tasksFor('2026-11-19'))[0].completed).toBe(false)
  })

  it('之前沒完成的單次待辦保留在 overdue，不會改日期', async () => {
    await todayRepository.createTask({ title: '繳房租', taskDate: '2026-11-15' })
    const today = await todayRepository.load('2026-11-18')
    expect(today.tasks).toEqual([])
    expect(today.overdue.map((task) => [task.title, task.taskDate])).toEqual([
      ['繳房租', '2026-11-15'],
    ])
    expect(today.quote.content).toBe('休息一下')
  })

  it('只存心情不會清掉備註', async () => {
    await todayRepository.saveJournal('2026-11-18', { content: '下午去買菜' })
    const saved = await todayRepository.saveJournal('2026-11-18', { mood: 'TIRED' })
    expect(saved).toMatchObject({ content: '下午去買菜', mood: 'TIRED', saved: true })
  })

  it('會員走 API，日期放在網址', async () => {
    authToken.value = 'token'
    vi.mocked(apiRequest).mockResolvedValueOnce({ date: '2026-11-18' })
    await todayRepository.load('2026-11-18')
    expect(apiRequest).toHaveBeenLastCalledWith('/today?date=2026-11-18')
    vi.mocked(apiRequest).mockResolvedValueOnce({})
    await todayRepository.saveJournal('2026-11-18', { mood: 'GREAT' })
    expect(apiRequest).toHaveBeenLastCalledWith('/daily-journal/2026-11-18', {
      method: 'PUT',
      body: { mood: 'GREAT' },
    })
  })
})
