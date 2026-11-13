// 會員端對端流程（真實後端＋PostgreSQL）。任何一步失敗就以非 0 結束，讓 CI 失敗。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(join(process.cwd(), 'package.json'))
const { chromium } = require('playwright')

const outDir = process.env.OUT_DIR || 'e2e-screenshots'
const fixtureDir = process.env.FIXTURE_DIR
const url = 'http://127.0.0.1:4174'
mkdirSync(outDir, { recursive: true })

const email = `e2e-${Date.now()}@example.com`
let password = 'E2e-pas1' // 8 個字元：最短長度，含大小寫、數字、符號
const mailApi = process.env.MAILPIT_URL || 'http://127.0.0.1:8025'

// 從測試用的 Mailpit 取得最新一封寄給 email 的驗證碼
async function latestCode(subjectPrefix) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${mailApi}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    const data = await res.json()
    const message = (data.messages || []).find((m) => m.Subject.startsWith(subjectPrefix))
    if (message) {
      const code = message.Subject.match(/(\d{6})$/)?.[1]
      if (code) return code
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`沒有收到「${subjectPrefix}」的驗證信`)
}
async function clearMailbox() {
  await fetch(`${mailApi}/api/v1/messages`, { method: 'DELETE' })
}
const result = {}

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: 'zh-TW',
  timezoneId: 'Australia/Sydney',
})
const page = await context.newPage()
await page.clock.setFixedTime(new Date('2026-11-12T10:00:00+11:00'))
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
let step = 0
const shot = (name) => page.screenshot({ path: join(outDir, `${String(++step).padStart(2, '0')}-${name}.png`) })
const tab = (name) => page.locator('.van-tabbar-item', { hasText: name }).click()
const toastGone = () =>
  page.locator('.van-toast').waitFor({ state: 'hidden', timeout: 6000 }).catch(() => {})
const check = (name, value) => {
  result[name] = value
  if (!value) throw new Error(`檢查失敗：${name}`)
}

async function signIn(mode) {
  await page.locator('.home-header__account').click()
  await page.locator('.auth-sheet').waitFor()
  const switchLabel = mode === 'register' ? '沒有帳號？註冊' : '已有帳號？登入'
  const switcher = page.getByRole('button', { name: switchLabel })
  if (await switcher.isVisible()) await switcher.click()
  await page.locator('.auth-sheet input[type=email]').fill(email)
  await page.locator('.auth-sheet input[type=password]').fill(password)
  if (mode === 'register') {
    await clearMailbox()
    await page.getByRole('button', { name: '寄送驗證碼' }).click()
    await page.getByText('驗證碼已寄到').waitFor({ timeout: 15000 })
    await shot('register-code')
    // 先輸入錯誤的驗證碼，應該被擋下
    await page.getByLabel('6 位數驗證碼').fill('000000')
    await page.getByRole('button', { name: '完成註冊' }).click()
    await page.getByText(/驗證碼不正確/).waitFor({ timeout: 10000 })
    result.wrongCodeRejected = true
    await page.getByLabel('6 位數驗證碼').fill(await latestCode('你的註冊驗證碼'))
    await page.getByRole('button', { name: '完成註冊' }).click()
  } else {
    await page.getByRole('button', { name: '登入', exact: true }).click()
  }
  await page.locator('.auth-sheet').waitFor({ state: 'hidden', timeout: 15000 })
  await page.waitForTimeout(1500)
  await toastGone()
}

try {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)

  // 1. 註冊新會員：沒有任何預設費率
  await signIn('register')
  check('memberHeroAsksSetup', await page.getByText('先完成工作設定').first().isVisible())
  await shot('member-home-new')

  // 2. 匯入薪資單並同時記錄入帳
  await page.getByRole('button', { name: /讓第一張薪資單/ }).click()
  await page
    .locator('input[type=file][accept*="pdf"]')
    .setInputFiles(join(fixtureDir, 'sample-payslip.pdf'))
  await page.getByText('確認薪資單內容').waitFor({ timeout: 20000 })
  check('depositCheckedByDefault', await page.getByRole('checkbox', { name: /同時記錄這筆薪資入帳/ }).isChecked().catch(async () =>
    (await page.locator('.payslip__footer .van-checkbox[aria-checked="true"]').count()) > 0,
  ))
  await shot('payslip-review')
  await page.getByRole('button', { name: '確認並保存' }).click()
  await page.getByText('點選常見班別加入').waitFor({ timeout: 10000 })
  check('wizardOpensAtShifts', true)

  // 3. 班別：晚班，週一到週五
  await page.getByRole('button', { name: /^晚班 23:50/ }).click()
  const rows = page.locator('.week__row')
  for (const index of [0, 1, 2, 3, 4]) {
    await rows.nth(index).getByRole('button', { name: '晚班', exact: true }).click()
  }
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByText('以本週為例').waitFor()
  await page.getByRole('radio', { name: '1 次' }).click()
  await shot('wizard-preview')
  await page.getByRole('button', { name: '完成設定' }).click()
  await page.getByText('工作設定完成，現在可以開始預估薪資。').waitFor()
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await page.waitForTimeout(500)

  // 4. 首頁看到最近一期薪資與入帳
  await tab('首頁')
  await page.evaluate(() => window.scrollTo(0, 0))
  await toastGone()
  check('latestPayslipCard', await page.getByText('最近一期薪資').isVisible())
  check('latestNetPay', await page.locator('.latest-pay').getByText('$1,653.00').isVisible())
  await shot('member-home-payslip')

  // 重新整理不會登出：仍是會員，薪資單還在
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('最近一期薪資').waitFor({ timeout: 15000 })
  check('staysSignedInAfterReload', true)

  // 5. 填滿此月：預覽 → 確認
  await tab('薪資')
  await page.getByRole('button', { name: '填滿此月' }).click()
  await page.getByText(/加入 \d+ 筆紀錄/).waitFor()
  const planned = await page.locator('.fill__list li').count()
  check('monthPreviewHasShifts', planned >= 15)
  await shot('fill-month-preview')
  await page.getByRole('button', { name: /加入 \d+ 筆紀錄/ }).click()
  await page.waitForTimeout(2500) // 等班表寫入後端
  result.monthShifts = planned

  // 6. 登出再登入：設定、薪資單、班表都要還在，且不會出現任何預設費率
  await tab('首頁')
  await page.locator('.home-header__account').click()
  await page.getByRole('button', { name: '登出' }).click()
  await page.waitForTimeout(1500)
  check('guestAfterLogout', await page.getByText('先完成工作設定').first().isVisible())
  // 忘記密碼：用驗證碼重設後直接登入
  await page.locator('.home-header__account').click()
  await page.locator('.auth-sheet').waitFor()
  await page.locator('.auth-sheet input[type=email]').fill(email)
  await page.locator('.auth-sheet input[type=password]').fill('wrong-password')
  await page.getByRole('button', { name: '登入', exact: true }).click()
  await page.getByRole('button', { name: '忘記密碼？用 Email 重設' }).click()
  await page.locator('.auth-sheet input[type=email]').fill(email)
  await clearMailbox()
  await page.getByRole('button', { name: '寄送驗證碼' }).click()
  await page.getByText('驗證碼已寄到').waitFor({ timeout: 15000 })
  password = 'New-pass9'
  await page.getByLabel('6 位數驗證碼').fill(await latestCode('你的重設密碼驗證碼'))
  await page.locator('.auth-sheet input[type=password]').fill(password)
  await shot('reset-password')
  await page.getByRole('button', { name: '重設密碼並登入' }).click()
  await page.locator('.auth-sheet').waitFor({ state: 'hidden', timeout: 15000 })
  await page.waitForTimeout(1500)
  check('resetPasswordSignedIn', await page.getByText('最近一期薪資').isVisible())
  // 再登出，用新密碼登入
  await page.locator('.home-header__account').click()
  await page.getByRole('button', { name: '登出' }).click()
  await page.waitForTimeout(1500)
  await signIn('login')
  check('payslipRestored', await page.getByText('最近一期薪資').isVisible())
  await shot('member-home-after-relogin')
  await tab('薪資')
  await page.locator('.work-setup-card').scrollIntoViewIfNeeded()
  check('payRestored', await page.getByText(/\$30\.00／時/).isVisible())
  check('scheduleRestored', await page.locator('.work-setup-card').getByText(/晚班 23:50–06:00（隔天） · 週一二三四五/).isVisible())
  await shot('payroll-after-relogin')
  await page.getByRole('button', { name: '填滿此月' }).click()
  await page.getByText('沒有需要新增的班表').waitFor()
  check('noDuplicateAfterRelogin', true)
} catch (error) {
  result.error = String(error.message || error).slice(0, 500)
  await shot('error').catch(() => {})
}
result.pageErrors = errors
await browser.close()
writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
if (result.error || errors.length) process.exit(1)
