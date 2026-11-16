// 集簽流程端對端測試（真實後端＋PostgreSQL）：
// 設定集二簽 → 補登歷史班表 → 批次改 Holiday → 單日改時間與 Smoko → 保存 → 首頁查看估算 →
// 批次請假衝突 → 禁休公告 → 重新登入資料保留 → 帳號隔離，並在 360／390／430 寬度截圖。
// 任何一步失敗就以非 0 結束，讓 CI 失敗。帳號以 API 建立（UI 註冊已由 e2e-member.mjs 涵蓋）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(join(process.cwd(), 'package.json'))
const { chromium } = require('playwright')

const appUrl = process.env.APP_URL || 'http://127.0.0.1:4174'
const api = process.env.API_URL || 'http://127.0.0.1:8080/api'
const mailApi = process.env.MAILPIT_URL || 'http://127.0.0.1:8025'
const backendLog = process.env.BACKEND_LOG // 本機用：MAIL_MODE=log 時從後端 log 讀驗證碼
const outDir = process.env.OUT_DIR || 'e2e-screenshots'
mkdirSync(outDir, { recursive: true })

const TODAY = '2026-11-16'
const result = {}
const check = (name, value) => {
  result[name] = Boolean(value)
  if (!value) throw new Error(`檢查失敗：${name}`)
}

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`)
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
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`沒有收到 ${email} 的驗證碼`)
}

/** 建立會員並設定時薪與夜班（週一到五 22:00–06:30），另有一筆既有班表 10/14 */
async function createMember(tag) {
  const email = `e2e-visa-${tag}-${Date.now()}@example.com`
  const password = 'E2e-visa1!'
  const config = await call('/auth/config')
  let code
  if (config.emailVerification) {
    await call('/auth/email-code', { method: 'POST', body: { email, purpose: 'REGISTER' } })
    code = await latestCode(email)
  }
  const { token, expiresAt } = await call('/auth/register', { method: 'POST', body: { email, password, code } })
  await call('/salary-rates', { method: 'PUT', token, body: { baseRate: 30, ppeAllowance: 0, withholdingTaxRate: 0.15 } })
  await call('/work-profile', {
    method: 'PUT',
    token,
    body: {
      version: 1,
      payStatus: 'MANUAL_CONFIRMED',
      confirmedRateKeys: ['baseRate', 'ppeAllowance', 'withholdingTaxRate'],
      allowProvisionalRates: true,
      taxRateSource: { type: 'MANUAL', payDate: null },
      scheduleStatus: 'CONFIGURED',
      shiftTemplates: [
        { id: 'night', name: '夜班', startTime: '22:00', endTime: '06:30', cleaningStartTime: '21:00', cleaningEndTime: '05:30' },
      ],
      weekPlan: { 1: 'night', 2: 'night', 3: 'night', 4: 'night', 5: 'night' },
      offDayRule: 'SKIP',
      smoko: { mode: 'AUTO', count: 1, minutes: 30, paid: false },
    },
  })
  await call('/work-records/1', {
    method: 'PUT',
    token,
    body: { id: 1, workDate: '2026-10-14', startTime: '20:00', endTime: '04:00', grossPay: 240, paidMinutes: 450, totalMinutes: 480, smokoCount: 1, shiftType: 'normal' },
  })
  return { email, password, token, expiresAt }
}

const browser = await chromium.launch()
const errors = []

async function openApp(member, viewport) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: 'zh-TW',
    timezoneId: 'Australia/Sydney',
    hasTouch: true,
  })
  await context.addInitScript((session) => {
    localStorage.setItem('expense-tracker.session', JSON.stringify(session))
  }, { token: member.token, email: member.email, expiresAt: member.expiresAt })
  const page = await context.newPage()
  await page.clock.setFixedTime(new Date(`${TODAY}T10:00:00+11:00`))
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(appUrl)
  await page.locator('.visa-card').waitFor({ timeout: 20000 })
  return { context, page }
}

let shotIndex = 0
async function shot(page, name) {
  const width = page.viewportSize().width
  await page.waitForTimeout(350) // 等 bottom sheet 動畫
  await page.screenshot({ path: join(outDir, `visa-${String(++shotIndex).padStart(2, '0')}-${width}-${name}.png`) })
}
const noHorizontalScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const footer = (page) => page.locator('.history-wizard__footer')

const member = await createMember('a')

// ---- 390px：完整流程 ----
{
  const { context, page } = await openApp(member, { width: 390, height: 844 })
  await page.locator('.visa-card').scrollIntoViewIfNeeded()
  await shot(page, 'card-not-set')
  await page.getByRole('button', { name: '設定集簽目標' }).click()
  await page.locator('.visa-setup').waitFor()
  await shot(page, 'setup-goal')
  await page.locator('.visa-option', { hasText: '集二簽' }).click()
  await page.locator('.visa-setup').getByText('417', { exact: true }).click()
  await page.locator('.visa-setup input[type=date]').nth(0).fill('2027-06-30')
  await page.locator('.visa-setup input[type=date]').nth(1).fill('2026-10-12')
  await page.locator('.visa-setup .van-switch').click()
  await shot(page, 'setup-details')
  await page.getByRole('button', { name: '儲存並開始追蹤' }).click()
  await page.getByText('要不要幫你補登過去的工作紀錄？').waitFor()
  await shot(page, 'history-prompt')
  await page.getByRole('button', { name: '補登', exact: true }).click()

  // Step 1：期間預設為指定工作開始日到今天
  await page.locator('.history-wizard').waitFor()
  const range = await page.locator('.history-wizard input[type=date]').evaluateAll((inputs) => inputs.map((input) => input.value))
  check('historyRangeDefaults', range[0] === '2026-10-12' && range[1] === TODAY)
  await shot(page, 'history-step1')
  await footer(page).getByRole('button', { name: '產生班表草稿' }).click()

  // Step 2：預覽，既有的 10/14 不會出現
  const summary = await page.locator('.history-summary').innerText()
  check('historyDraftSkipsExisting', /1\s*已有紀錄略過/.test(summary))
  check('historyDraftNoDuplicate', !(await page.locator('.history-row', { hasText: '10/14（' }).count()))
  await shot(page, 'history-step2')
  await footer(page).getByRole('button', { name: '下一步：修正請假' }).click()

  // Step 3：一次把 10/20–10/22 設為 Holiday
  for (const date of ['2026-10-20', '2026-10-21', '2026-10-22']) {
    await page.getByLabel(`選取 ${date}`).click()
  }
  await shot(page, 'history-step3-selected')
  await footer(page).getByRole('button', { name: /已選 3 天/ }).click()
  await page.getByRole('button', { name: '設為Holiday／旅行' }).click()
  check('batchHoliday', (await page.locator('.history-row.is-leave').count()) === 3)

  // 單日修改：10/23 改成 23:00 上班、Smoko 手動 1 次（跨午夜）
  await page.locator('.history-row', { hasText: '10/23（' }).locator('.history-row__body').click()
  const editor = page.locator('.history-editor')
  await editor.locator('input[type=time]').first().fill('23:00')
  await editor.getByText('手動', { exact: true }).click()
  await editor.locator('.van-stepper__minus').click()
  await shot(page, 'history-day-editor')
  await editor.getByRole('button', { name: '套用' }).click()
  const edited = await page.locator('.history-row', { hasText: '10/23（' }).innerText()
  check('singleDayEdit', edited.includes('23:00–06:30') && edited.includes('Smoko 1 次（手動）'))
  check('noHorizontalScroll390', await noHorizontalScroll(page))
  await shot(page, 'history-step3-edited')
  await footer(page).getByRole('button', { name: '下一步：確認' }).click()

  // Step 4：確認保存
  await shot(page, 'history-step4')
  await footer(page).getByRole('button', { name: '確認保存' }).click()
  await page.getByText(/已保存 \d+ 筆補登紀錄/).waitFor({ timeout: 20000 })
  await shot(page, 'history-saved')
  await page.getByRole('button', { name: '查看集簽進度' }).click()
  await page.locator('.visa-card .visa-card__status').waitFor()
  await page.waitForTimeout(600)
  const card = await page.locator('.visa-card').innerText()
  check('cardShowsTracking', card.includes('集簽中') && card.includes('集二簽'))
  check('cardShowsEstimateOrReason', /約 \d{4}\/|預估完成日期/.test(card))
  await shot(page, 'card-progress')

  // 資料庫：補登紀錄有來源標記，Holiday 是請假，10/14 原紀錄不變
  const saved = await call('/work-records', { token: member.token })
  const byDate = Object.fromEntries(saved.map((record) => [record.workDate, record]))
  check('historySourceSaved', byDate['2026-10-13']?.source === 'HISTORICAL_USER_CONFIRMED')
  check('holidaySaved', byDate['2026-10-21']?.shiftType === 'leave' && byDate['2026-10-21']?.leaveType === 'HOLIDAY')
  check('existingUntouched', byDate['2026-10-14']?.startTime === '20:00' && !byDate['2026-10-14']?.source)
  check('crossMidnightSaved', byDate['2026-10-23']?.startTime === '23:00' && byDate['2026-10-23']?.smokoCount === 1)
  result.savedRecords = saved.length

  // 批次請假：包含既有工作日 → 衝突提示，預設保留
  await page.locator('.van-tabbar-item', { hasText: '薪資' }).click()
  await page.getByRole('button', { name: '請假區間' }).click()
  const leave = page.locator('.leave-sheet')
  await leave.locator('input[type=date]').nth(0).fill('2026-10-13')
  await leave.locator('input[type=date]').nth(1).fill('2026-10-16')
  await leave.getByRole('radio', { name: '病假' }).click()
  await leave.getByText('已有工作紀錄', { exact: false }).first().waitFor()
  await shot(page, 'leave-conflict')
  await leave.getByRole('button', { name: '套用請假' }).click()
  await page.getByText('選取的日期都已有工作紀錄，沒有變更').waitFor()
  const afterSkip = await call('/work-records', { token: member.token })
  check('conflictKeepsWork', afterSkip.find((record) => record.workDate === '2026-10-14')?.shiftType !== 'leave')
  await leave.locator('.van-popup__close-icon').click()

  // 禁休公告：新增（多行）→ 查看 → 修改 → 不影響集簽
  const before = await page.evaluate(() => document.querySelector('.visa-card')?.innerText)
  await page.getByRole('button', { name: '新增禁休公告' }).click()
  const notice = page.locator('.notice-sheet')
  await notice.locator('input[type=date]').nth(1).fill('2026-11-22')
  await notice.getByPlaceholder('選填，例如：年底旺季禁休').fill('旺季禁休')
  await notice.locator('textarea').fill('各位同仁：\n本週為出貨旺季，\n暫停所有休假申請。')
  await shot(page, 'notice-edit')
  await notice.getByRole('button', { name: '儲存公告' }).click()
  await notice.waitFor({ state: 'hidden' })
  await page.locator('.calendar-day-actions__blackout').first().click()
  await notice.getByText('暫停所有休假申請。').waitFor()
  await shot(page, 'notice-view')
  await notice.getByRole('button', { name: '修改' }).click()
  await notice.getByPlaceholder('選填，例如：年底旺季禁休').fill('旺季禁休（更新）')
  await notice.getByRole('button', { name: '儲存公告' }).click()
  await notice.waitFor({ state: 'hidden' })
  const notices = await call('/blackout-notices', { token: member.token })
  check('noticeSaved', notices.length === 1 && notices[0].title === '旺季禁休（更新）' && notices[0].body.includes('\n'))
  const after = await page.evaluate(() => document.querySelector('.visa-card')?.innerText)
  check('noticeDoesNotChangeVisa', before === after)
  await context.close()
}

// ---- 重新登入：資料保留 ----
{
  const login = await call('/auth/login', { method: 'POST', body: { email: member.email, password: member.password } })
  const { context, page } = await openApp({ ...member, token: login.token, expiresAt: login.expiresAt }, { width: 390, height: 844 })
  await page.locator('.visa-card .visa-card__status').waitFor()
  const card = await page.locator('.visa-card').innerText()
  check('reloginKeepsJourney', card.includes('集二簽') && /補登/.test(card))
  await context.close()
}

// ---- 360 與 430：版面 ----
for (const viewport of [{ width: 360, height: 780 }, { width: 430, height: 932 }]) {
  const { context, page } = await openApp(member, viewport)
  await page.locator('.visa-card').scrollIntoViewIfNeeded()
  await shot(page, 'card-progress')
  check(`noHorizontalScroll${viewport.width}`, await noHorizontalScroll(page))
  await page.locator('.van-tabbar-item', { hasText: '薪資' }).click()
  await page.getByRole('button', { name: '補登歷史' }).click()
  await page.locator('.history-wizard input[type=date]').nth(0).fill('2026-09-28')
  await page.locator('.history-wizard input[type=date]').nth(1).fill('2026-10-11')
  await footer(page).getByRole('button', { name: '產生班表草稿' }).click()
  await footer(page).getByRole('button', { name: '下一步：修正請假' }).click()
  await page.getByLabel('選取 2026-09-29').click()
  await shot(page, 'history-step3')
  check(`wizardNoHorizontalScroll${viewport.width}`, await noHorizontalScroll(page))
  await context.close()
}

// ---- 不同帳號隔離 ----
{
  const other = await createMember('b')
  const journey = await call('/visa-journey', { token: other.token })
  const otherNotices = await call('/blackout-notices', { token: other.token })
  const otherRecords = await call('/work-records', { token: other.token })
  check('isolationJourney', journey.journey === null)
  check('isolationNotices', otherNotices.length === 0)
  check('isolationRecords', otherRecords.length === 1)
  // 不集簽：首頁不顯示進度卡
  await call('/visa-journey', { method: 'PUT', token: other.token, body: { goal: 'NONE' } })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW' })
  await context.addInitScript((session) => localStorage.setItem('expense-tracker.session', JSON.stringify(session)), {
    token: other.token,
    email: other.email,
    expiresAt: other.expiresAt,
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(appUrl)
  await page.locator('.home-block').first().waitFor()
  await page.waitForTimeout(1500)
  check('notTrackingHidesCard', (await page.locator('.visa-card').count()) === 0)
  await context.close()
}

await browser.close()
check('noPageErrors', errors.length === 0)
writeFileSync(join(outDir, 'visa-result.json'), JSON.stringify({ result, errors }, null, 2))
console.log(JSON.stringify(result, null, 2))
