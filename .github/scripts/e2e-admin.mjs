// 管理後台端對端測試（真實後端＋PostgreSQL）：
// 用初始化工具（CLI）授予管理員 → 原帳號登入 → 更多頁進入管理後台 → 總覽、會員、操作紀錄、錯誤 →
// 編輯、停用、恢復、刪除會員 → 稽核紀錄；並確認一般會員打所有 Admin API 都被拒絕。
// 360／390／430 截圖。任何一步失敗就以非 0 結束。
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(join(process.cwd(), 'package.json'))
const { chromium } = require('playwright')

const appUrl = process.env.APP_URL || 'http://127.0.0.1:4174'
const api = process.env.API_URL || 'http://127.0.0.1:8080/api'
const mailApi = process.env.MAILPIT_URL || 'http://127.0.0.1:8025'
const backendLog = process.env.BACKEND_LOG
const repoRoot = process.env.REPO_ROOT || resolve(process.cwd(), '..')
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
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`)
  return res.status === 204 || res.status === 202 ? null : res.json()
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
  const email = `e2e-admin-${tag}-${Date.now()}@example.com`
  const config = await call('/auth/config')
  let code
  if (config.emailVerification) {
    await call('/auth/email-code', { method: 'POST', body: { email, purpose: 'REGISTER' } })
    code = await latestCode(email)
  }
  const session = await call('/auth/register', { method: 'POST', body: { email, password, code } })
  return { email, password, ...session }
}

/** 初始化工具（與擁有者在自己電腦上執行的指令相同） */
function adminTool(args) {
  return execFileSync('bash', ['backend/gradlew', 'adminRole', '--no-daemon', '-q', `--args=${args}`], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  })
}

const owner = await register('owner', 'Owner#Pass1')
const member = await register('member', 'Member#Pass1')
check('newAccountHasNoRole', owner.roles.length === 0)

// 會員產生一些事件：薪資單在瀏覽器解析失敗、新增一筆班表
await call('/events', {
  method: 'POST',
  token: member.token,
  body: { type: 'PAYSLIP_IMPORT_FAILED', status: 'FAILURE', errorCode: 'WRONG_PASSWORD' },
})
await call('/work-records/1', {
  method: 'PUT',
  token: member.token,
  body: { id: 1, workDate: '2026-11-16', startTime: '22:00', endTime: '06:00', grossPay: 200, paidMinutes: 450, totalMinutes: 480, smokoCount: 1, shiftType: 'normal' },
})

// 一般會員（還沒有任何管理員時）打所有 Admin API 都要被拒絕
const adminEndpoints = [
  ['GET', '/admin/overview'],
  ['GET', '/admin/users'],
  ['GET', '/admin/users/1'],
  ['GET', '/admin/users/1/events'],
  ['GET', '/admin/events'],
  ['GET', '/admin/audit'],
  ['PUT', '/admin/users/1/profile'],
  ['POST', '/admin/users/1/disable'],
  ['POST', '/admin/users/1/enable'],
  ['PUT', '/admin/users/1/role'],
  ['POST', '/admin/users/1/delete'],
]
const denied = []
for (const [method, path] of adminEndpoints) {
  const res = await call(path, {
    method,
    token: member.token,
    raw: true,
    body: method === 'GET' ? undefined : { reason: '嘗試越權操作', password: 'x', superAdmin: true, confirmEmail: owner.email },
  })
  denied.push(res.status)
}
check('memberDeniedAllAdminApis', denied.every((status) => status === 403))
const anonymous = await call('/admin/overview', { raw: true })
check('anonymousDenied', anonymous.status === 401)

// 用初始化工具授予擁有者 SUPER_ADMIN（以 user_seq，並輸入 Email 確認）
const found = adminTool(`find ${owner.email}`)
const ownerSeq = Number(found.match(/user_seq=(\d+)/i)?.[1])
check('foundOwnerSeq', ownerSeq > 0)
adminTool(`grant ${ownerSeq} --reason E2E初始化管理員 --confirm-email ${owner.email}`)
const login = await call('/auth/login', { method: 'POST', body: { email: owner.email, password: owner.password } })
check('ownerHasSuperAdminRole', login.roles.includes('SUPER_ADMIN'))

const browser = await chromium.launch()
const errors = []
let shotIndex = 0
async function openApp(session, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'zh-TW', timezoneId: 'Australia/Sydney' })
  await context.addInitScript((value) => localStorage.setItem('expense-tracker.session', JSON.stringify(value)), {
    token: session.token,
    email: session.email,
    expiresAt: session.expiresAt,
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(appUrl)
  await page.locator('.home-header').waitFor({ timeout: 20000 })
  await page.waitForTimeout(1200)
  return { context, page }
}
const shot = async (page, name) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(outDir, `admin-${String(++shotIndex).padStart(2, '0')}-${page.viewportSize().width}-${name}.png`) })
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

// 一般會員：更多頁沒有管理後台入口
{
  const { context, page } = await openApp(member, { width: 390, height: 844 })
  await page.locator('.van-tabbar-item', { hasText: '更多' }).click()
  await page.locator('.more-page').waitFor()
  check('memberSeesNoAdminEntry', (await page.getByText('管理後台').count()) === 0)
  await context.close()
}

// 管理員：完整流程（390）
{
  const { context, page } = await openApp({ ...owner, ...login }, { width: 390, height: 844 })
  await page.locator('.van-tabbar-item', { hasText: '更多' }).click()
  await page.getByText('管理後台').click()
  await page.locator('.admin-page').waitFor()
  check('adminHash', page.url().endsWith('#/admin'))
  await page.locator('.admin-stats').waitFor()
  await shot(page, 'overview')
  const overviewText = await page.locator('.admin-page').innerText()
  check('overviewShowsPayslipFailures', overviewText.includes('7 天薪資單失敗') && overviewText.includes('NOT_SUPER_ADMIN'))
  check('noHorizontalScroll390', await noHorizontalScroll(page))

  // 會員列表 → 搜尋 → 詳細
  await page.getByRole('tab', { name: '會員' }).click()
  await page.getByPlaceholder('搜尋 Email 或會員 ID').fill(member.email)
  await page.getByPlaceholder('搜尋 Email 或會員 ID').press('Enter')
  await page.locator('.admin-row', { hasText: member.email }).waitFor()
  await shot(page, 'users')
  await page.locator('.admin-row', { hasText: member.email }).click()
  const detail = page.locator('.admin-detail')
  await detail.getByText('班表／支出／薪資單').waitFor()
  await shot(page, 'member-detail')
  await detail.getByRole('tab', { name: '操作紀錄' }).click()
  await detail.getByText('薪資單匯入失敗').waitFor()
  const memberEvents = await detail.innerText()
  check('memberEventsShowSequence', memberEvents.includes('註冊成功') && memberEvents.includes('新增班表'))
  check('memberEventsNoSecrets', !memberEvents.includes('Member#Pass1') && !memberEvents.includes(member.token))
  await shot(page, 'member-events')

  const action = page.locator('.admin-action')
  const runAction = async (button, { reason, password, nickname, confirmEmail }) => {
    await detail.getByRole('tab', { name: '資料' }).click()
    await detail.getByRole('button', { name: button }).click()
    await action.locator('.van-field', { hasText: '原因' }).locator('textarea').fill(reason)
    if (nickname !== undefined) await action.locator('.van-field', { hasText: '顯示名稱' }).locator('input').fill(nickname)
    if (confirmEmail) await action.locator('.van-field', { hasText: '會員 Email' }).locator('input').fill(confirmEmail)
    if (password) await action.locator('input[type=password]').fill(password)
    await action.getByRole('button', { name: new RegExp(`^確認${button}`) }).click()
    await action.waitFor({ state: 'hidden', timeout: 15000 })
  }

  await runAction('編輯顯示名稱', { reason: '會員要求修改顯示名稱', nickname: '測試會員' })
  await detail.getByText('測試會員').waitFor()
  await runAction('停用會員', { reason: '測試停用流程', password: owner.password })
  await detail.getByText('已停用').waitFor()
  const disabledLogin = await call('/auth/login', { method: 'POST', raw: true, body: { email: member.email, password: member.password } })
  check('disabledMemberCannotLogin', disabledLogin.status === 403)
  const oldToken = await call('/auth/me', { token: member.token, raw: true })
  check('disabledMemberSessionRevoked', oldToken.status === 401)
  await runAction('恢復會員', { reason: '測試恢復流程', password: owner.password })
  await detail.getByText('啟用中').waitFor()

  // 刪除：錯誤的 Email 會被擋下，正確才刪除
  await detail.getByRole('tab', { name: '資料' }).click()
  await detail.getByRole('button', { name: '刪除會員' }).click()
  await action.locator('.van-field', { hasText: '原因' }).locator('textarea').fill('測試安全刪除流程')
  await action.locator('.van-field', { hasText: '會員 Email' }).locator('input').fill('wrong@example.com')
  await action.locator('input[type=password]').fill(owner.password)
  await action.getByRole('button', { name: /^確認刪除會員/ }).click()
  await action.getByText('請輸入這位會員的 Email 確認刪除').waitFor()
  await shot(page, 'delete-confirm')
  await action.locator('.van-field', { hasText: '會員 Email' }).locator('input').fill(member.email)
  await action.getByRole('button', { name: /^確認刪除會員/ }).click()
  await action.waitFor({ state: 'hidden', timeout: 15000 })
  const deletedLogin = await call('/auth/login', { method: 'POST', raw: true, body: { email: member.email, password: member.password } })
  check('deletedMemberGone', deletedLogin.status === 401)

  // 紀錄：只看失敗
  await page.getByRole('tab', { name: '紀錄' }).click()
  await page.locator('.admin-filters select').nth(1).selectOption('FAILURE')
  await page.getByRole('button', { name: '搜尋' }).click()
  await page.locator('.admin-row').first().waitFor()
  await shot(page, 'logs-failures')
  await page.locator('.admin-row').first().click()
  await page.locator('.admin-event').getByText('Request ID').waitFor().catch(() => {})
  await shot(page, 'event-detail')
  await page.locator('.admin-event .van-popup__close-icon').click()

  // 稽核：所有管理員操作都有紀錄（含失敗）
  await page.getByRole('tab', { name: '稽核' }).click()
  await page.locator('.admin-audit').first().waitFor()
  const auditText = await page.locator('.admin-section').innerText()
  for (const label of ['授予管理員', '編輯基本資料', '停用會員', '恢復會員', '刪除會員'])
    check(`audit:${label}`, auditText.includes(label))
  check('auditHasFailedAttempt', auditText.includes('失敗'))
  await shot(page, 'audit')
  await context.close()
}

// 360／430：版面
for (const viewport of [{ width: 360, height: 780 }, { width: 430, height: 932 }]) {
  const { context, page } = await openApp({ ...owner, ...login }, viewport)
  // 直接開 /#/admin（重新整理後仍停在管理後台）
  await page.goto(`${appUrl}/#/admin`)
  await page.reload()
  await page.locator('.admin-stats').waitFor({ timeout: 20000 })
  await shot(page, 'overview')
  check(`noHorizontalScroll${viewport.width}`, await noHorizontalScroll(page))
  await page.getByRole('tab', { name: '紀錄' }).click()
  await page.locator('.admin-filters').waitFor()
  await shot(page, 'logs')
  check(`logsNoHorizontalScroll${viewport.width}`, await noHorizontalScroll(page))
  await context.close()
}

// 審計紀錄不能透過 API 修改：沒有任何修改／刪除稽核的路由
const auditDelete = await call('/admin/audit', { method: 'DELETE', token: login.token, raw: true })
check('auditNotDeletable', [404, 405].includes(auditDelete.status))

await browser.close()
check('noPageErrors', errors.length === 0)
writeFileSync(join(outDir, 'admin-result.json'), JSON.stringify({ result, errors }, null, 2))
console.log(JSON.stringify(result, null, 2))
