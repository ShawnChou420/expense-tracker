// Today Dashboard 端對端測試（真實後端＋PostgreSQL）：
// API：每日小語固定分配／換一句／並發只有一筆、待辦（含重複）、備註心情、越權與未登入。
// 畫面：首頁今日班次（跨午夜夜班）、待辦快速新增與勾選、心情、備註儲存、重新登入後還在；
// 360／390／430 截圖、無水平捲動、無頁面錯誤。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(join(process.cwd(), 'package.json'))
const { chromium } = require('playwright')

const appUrl = process.env.APP_URL || 'http://127.0.0.1:4174'
const api = process.env.API_URL || 'http://127.0.0.1:8080/api'
const mailApi = process.env.MAILPIT_URL || 'http://127.0.0.1:8025'
const backendLog = process.env.BACKEND_LOG
const outDir = process.env.OUT_DIR || 'e2e-screenshots'
mkdirSync(outDir, { recursive: true })

const result = {}
const check = (name, value) => {
  result[name] = Boolean(value)
  if (!value) throw new Error(`檢查失敗：${name}`)
}

async function call(path, { method = 'GET', body, token, raw = false } = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (raw) return res
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

async function latestCode(email) {
  for (let i = 0; i < 30; i++) {
    if (backendLog) {
      const match = [...readFileSync(backendLog, 'utf8').matchAll(new RegExp(`to=${email}.*?(\\d{6})`, 'g'))].at(-1)
      if (match) return match[1]
    } else {
      const data = await (await fetch(`${mailApi}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()
      const code = (data.messages || [])[0]?.Subject.match(/(\d{6})$/)?.[1]
      if (code) return code
    }
    await new Promise((done) => setTimeout(done, 500))
  }
  throw new Error(`沒有收到 ${email} 的驗證碼`)
}

async function register(tag, password) {
  const email = `e2e-today-${tag}-${Date.now()}@example.com`
  const config = await call('/auth/config')
  let code
  if (config.emailVerification) {
    await call('/auth/email-code', { method: 'POST', body: { email, purpose: 'REGISTER' } })
    code = await latestCode(email)
  }
  const session = await call('/auth/register', { method: 'POST', body: { email, password, code } })
  return { email, password, ...session }
}

/** 本地日期（與 App 相同：裝置時間） */
const pad = (n) => String(n).padStart(2, '0')
const local = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const today = local(new Date())
const yesterday = local(new Date(Date.now() - 86400000))

const alice = await register('alice', 'Alice#Pass1')
const bob = await register('bob', 'Bob#Pass1')

// --- 每日小語 ---
const concurrent = await Promise.all(
  Array.from({ length: 6 }, () => call(`/daily-quotes/today?date=${today}`, { token: alice.token })),
)
check('concurrentRequestsShareOneQuote', new Set(concurrent.map((q) => q.quoteId)).size === 1)
const first = concurrent[0]
check('quoteHasFields', first.content && first.category && first.sourceType === 'ORIGINAL' && first.quoteDate === today)
const again = await call(`/daily-quotes/today?date=${today}`, { token: alice.token })
check('sameDaySameQuote', again.quoteId === first.quoteId)
const refreshed = await call('/daily-quotes/refresh', { method: 'POST', token: alice.token, body: { date: today } })
check('refreshChangesQuote', refreshed.quoteId !== first.quoteId)
const afterRefresh = await call(`/daily-quotes/today?date=${today}`, { token: alice.token })
check('refreshPersistsForTheDay', afterRefresh.quoteId === refreshed.quoteId)
const doubleTap = await call('/daily-quotes/refresh', { method: 'POST', token: alice.token, body: { date: today }, raw: true })
check('refreshDoubleTapThrottled', doubleTap.status === 429)
const bobQuote = await call(`/daily-quotes/today?date=${today}`, { token: bob.token })
check('otherMemberUnaffected', (await call(`/daily-quotes/today?date=${today}`, { token: alice.token })).quoteId === refreshed.quoteId && bobQuote.quoteId > 0)
const farDate = await call(`/daily-quotes/today?date=2020-01-01`, { token: alice.token, raw: true })
check('quoteRejectsArbitraryDate', farDate.status === 400)
const guestQuote = await call(`/daily-quotes/sample?date=${today}`)
check('guestSampleQuote', guestQuote.content && guestQuote.refreshesLeft === 0)

// --- 待辦 ---
const rent = await call('/daily-tasks', { method: 'POST', token: alice.token, body: { title: '繳房租', taskDate: yesterday } })
const gym = await call('/daily-tasks', {
  method: 'POST',
  token: alice.token,
  body: { title: '健身', taskDate: yesterday, repeatType: 'DAILY' },
})
await call(`/daily-tasks/${gym.id}`, { method: 'PATCH', token: alice.token, body: { completed: true, occurrenceDate: yesterday } })
const todayTasks = await call(`/daily-tasks?date=${today}`, { token: alice.token })
check('recurringCompletionIsPerDay', todayTasks.find((t) => t.id === gym.id)?.completed === false)
const yesterdayTasks = await call(`/daily-tasks?date=${yesterday}`, { token: alice.token })
check('recurringYesterdayStaysDone', yesterdayTasks.find((t) => t.id === gym.id)?.completed === true)
const overdue = await call(`/daily-tasks/overdue?today=${today}`, { token: alice.token })
check('overdueKeptWithOriginalDate', overdue.some((t) => t.id === rent.id && t.taskDate === yesterday))
const bobPatch = await call(`/daily-tasks/${rent.id}`, { method: 'PATCH', token: bob.token, body: { completed: true }, raw: true })
const bobDelete = await call(`/daily-tasks/${rent.id}`, { method: 'DELETE', token: bob.token, raw: true })
check('otherMemberTaskIs404', bobPatch.status === 404 && bobDelete.status === 404)
const badTitle = await call('/daily-tasks', { method: 'POST', token: alice.token, body: { title: ' ', taskDate: today }, raw: true })
check('blankTitleRejected', badTitle.status === 400)

// --- 備註與心情 ---
await call(`/daily-journal/${today}`, { method: 'PUT', token: alice.token, body: { content: '今天去買菜。' } })
const journal = await call(`/daily-journal/${today}`, { method: 'PUT', token: alice.token, body: { mood: 'TIRED' } })
check('moodKeepsNote', journal.content === '今天去買菜。' && journal.mood === 'TIRED')
const bobJournal = await call(`/daily-journal?date=${today}`, { token: bob.token })
check('journalIsPrivate', bobJournal.content === '' && bobJournal.mood === null)
const badMood = await call(`/daily-journal/${today}`, { method: 'PUT', token: alice.token, body: { mood: 'ANGRY' }, raw: true })
check('invalidMoodRejected', badMood.status === 400)

// --- 未登入 ---
const anonymous = await Promise.all(
  ['/today?date=' + today, '/daily-tasks?date=' + today, '/daily-journal?date=' + today, '/daily-quotes/today?date=' + today].map(
    (path) => call(path, { raw: true }),
  ),
)
check('anonymousGets401', anonymous.every((res) => res.status === 401))

// --- 一次取回 ---
const bundle = await call(`/today?date=${today}`, { token: alice.token })
check('todayBundle', bundle.quote?.quoteId === refreshed.quoteId && bundle.journal.mood === 'TIRED' && bundle.overdue.length === 1)

// --- 畫面：Bob 有一個跨午夜的夜班（從昨天 23:50 到今天 06:00 之後的班也行，這裡用「今天開始」） ---
const now = new Date()
const startHour = (now.getHours() + 23) % 24 // 一小時前開始 → 正在上班
const shiftDate = startHour > now.getHours() ? yesterday : today
await call('/work-records/1', {
  method: 'PUT',
  token: bob.token,
  body: {
    id: 1,
    workDate: shiftDate,
    startTime: `${pad(startHour)}:00`,
    endTime: `${pad((startHour + 7) % 24)}:00`,
    grossPay: 212.5,
    paidMinutes: 390,
    totalMinutes: 420,
    smokoCount: 1,
    smokoDeductMinutes: 30,
    shiftType: 'normal',
  },
})

const browser = await chromium.launch()
const errors = []
let shotIndex = 0
async function openApp(session, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'zh-TW' })
  await context.addInitScript((value) => localStorage.setItem('expense-tracker.session', JSON.stringify(value)), {
    token: session.token,
    email: session.email,
    expiresAt: session.expiresAt,
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(appUrl)
  await page.locator('.home-header').waitFor({ timeout: 20000 })
  await page.locator('.today-quote__text').waitFor({ timeout: 20000 })
  await page.waitForTimeout(600)
  return { context, page }
}
const shot = async (page, name, fullPage = false) => {
  await page.waitForTimeout(300)
  await page.screenshot({
    path: join(outDir, `today-${String(++shotIndex).padStart(2, '0')}-${page.viewportSize().width}-${name}.png`),
    fullPage,
  })
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

{
  const { context, page } = await openApp(bob, { width: 390, height: 844 })
  const shiftCard = page.locator('.today-shift')
  check('shiftCardShowsWorking', (await shiftCard.innerText()).includes('上班中'))
  check('shiftCardHidesFakePay', (await shiftCard.innerText()).includes('尚未設定薪資費率'))
  await shot(page, 'home-first-screen')

  // 待辦：快速新增 → 勾選
  await page.getByLabel('快速新增今日待辦').fill('上班前磨刀')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  await page.locator('.today-task', { hasText: '上班前磨刀' }).waitFor()
  await page.getByLabel('完成：上班前磨刀').click()
  await page.locator('.today-card__count', { hasText: '1 / 1 已完成' }).waitFor()

  // 編輯 Popup（設為每週）
  await page.getByRole('button', { name: /新增待辦/ }).click()
  const editor = page.locator('.today-editor')
  await editor.locator('.van-field', { hasText: '內容' }).locator('input').fill('洗衣服')
  await editor.getByRole('radio', { name: '每週' }).click()
  await shot(page, 'task-editor')
  await editor.getByRole('button', { name: '儲存' }).click()
  await page.locator('.today-task', { hasText: '洗衣服' }).waitFor()

  // 首頁自訂（UI 2.0 Sprint 2）：薪資優先預設不顯示心情與備註 → 在「自訂首頁」打開，設定存到後端
  check('moodHiddenByDefault', (await page.locator('.today-journal').count()) === 0)
  await page.getByRole('button', { name: '自訂首頁' }).click()
  const customize = page.locator('.customize-sheet')
  await customize.waitFor()
  await shot(page, 'customize-sheet')
  await customize.locator('.customize__row', { hasText: '心情與備註' }).locator('.van-switch').click()
  await customize.getByRole('button', { name: '關閉' }).click()
  await customize.waitFor({ state: 'hidden' })
  await page.locator('.today-journal').waitFor()
  await page.waitForTimeout(800) // 等首頁設定寫入後端
  const savedLayout = (await call('/dashboard-settings', { token: bob.token })).dashboardLayout
  check(
    'layoutSavedToBackend',
    savedLayout?.mode === 'PAY' && savedLayout.modules.some((m) => m.id === 'mood-journal' && m.visible === true),
  )

  // 心情＋備註
  await page.getByRole('button', { name: /很好/ }).click()
  await page.locator('.today-journal textarea').fill('今天雞胸比較難切，刀要再磨一下。')
  await page.locator('.today-journal__foot').getByRole('button', { name: '儲存' }).click()
  await page.locator('.today-journal__foot', { hasText: '已儲存' }).waitFor()
  await page.locator('.today-quote').scrollIntoViewIfNeeded()
  await shot(page, 'home-today-cards')
  check('noHorizontalScroll390', await noHorizontalScroll(page))
  await shot(page, 'home-full', true)
  await context.close()
}

// 重新登入後仍存在
{
  const login = await call('/auth/login', { method: 'POST', body: { email: bob.email, password: bob.password } })
  const { context, page } = await openApp({ ...bob, ...login }, { width: 390, height: 844 })
  await page.locator('.today-task', { hasText: '洗衣服' }).waitFor()
  check('tasksPersistAfterLogin', (await page.locator('.today-task__title--done').count()) === 1)
  check('moodPersistsAfterLogin', (await page.locator('.today-mood--active').innerText()).includes('很好'))
  check('journalPersistsAfterLogin', (await page.locator('.today-journal textarea').inputValue()).includes('雞胸'))
  check('layoutPersistsAfterLogin', (await page.locator('.today-journal').count()) === 1)
  await context.close()
}

// Alice：之前未完成的事項（不會自動消失）＋換一句
{
  const { context, page } = await openApp(alice, { width: 390, height: 844 })
  // 不同帳號的首頁設定互不影響：Alice 仍是預設（沒有心情與備註）
  check('otherAccountKeepsDefaultLayout', (await page.locator('.today-journal').count()) === 0)
  await page.getByText('還有 1 件之前未完成的事項').click()
  await page.locator('.today-overdue-list').getByText('繳房租').waitFor()
  await shot(page, 'overdue-popup')
  await page.locator('.today-overdue-list').getByRole('button', { name: '移到今天' }).click()
  await page.locator('.today-task', { hasText: '繳房租' }).waitFor()
  await page.keyboard.press('Escape').catch(() => {})
  await context.close()
}

for (const viewport of [{ width: 360, height: 780 }, { width: 430, height: 932 }]) {
  const { context, page } = await openApp(bob, viewport)
  await shot(page, 'home')
  check(`noHorizontalScroll${viewport.width}`, await noHorizontalScroll(page))
  await context.close()
}

// 訪客：今日區塊可用、小語固定一句
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(appUrl)
  await page.locator('.today-quote__text').waitFor({ timeout: 20000 })
  check('guestSeesQuote', (await page.locator('.today-quote__text').innerText()).trim() === guestQuote.content)
  // 全新訪客：首頁是雙滑桿快速試算（UI 2.0 Sprint 3），預設 A$26.44 × 38 小時
  check('guestSeesQuickEstimate', (await page.locator('.quick-pay__amount').innerText()).trim() === 'A$1,004.72')
  await shot(page, 'guest')
  await context.close()
}

await browser.close()
check('noPageErrors', errors.length === 0)
writeFileSync(join(outDir, 'today-result.json'), JSON.stringify({ result, errors }, null, 2))
console.log(JSON.stringify(result, null, 2))
