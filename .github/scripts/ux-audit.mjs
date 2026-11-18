// UX 稽核：用手機實際可視範圍（已扣掉瀏覽器網址列與工具列）截圖主要頁面與彈窗，並量測問題。
// 每一步都獨立 try/catch，某一步失敗不影響其他截圖。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(join(process.cwd(), 'package.json'))
const { chromium, webkit, devices } = require('playwright')

const outDir = process.env.OUT_DIR || 'ux-audit'
mkdirSync(outDir, { recursive: true })
const url = 'http://127.0.0.1:4174'
const targets = [
  { name: 'iphone13', engine: webkit, device: devices['iPhone 13'] },
  { name: 'iphoneSE', engine: webkit, device: devices['iPhone SE'] },
  { name: 'pixel7', engine: chromium, device: devices['Pixel 7'] },
]
const report = {}

// 量測：太小的觸控區、可見彈窗數量、彈窗是否超出畫面、主要按鈕是否在畫面外、水平溢出
async function measure(page) {
  return page.evaluate(() => {
    const vh = window.innerHeight
    const vw = window.innerWidth
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    }
    const label = (el) => (el.innerText || el.getAttribute('aria-label') || el.title || el.className || '').toString().trim().replace(/\s+/g, ' ').slice(0, 30)
    const clickables = [...document.querySelectorAll('button, a[href], [role=button], [role=tab], .van-cell--clickable, input[type=checkbox], .van-checkbox, .van-radio, .van-switch, .van-stepper__minus, .van-stepper__plus, .van-tabbar-item, .van-calendar__day')]
      .filter(visible)
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.bottom > 0 && r.top < vh
      })
    const small = clickables
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.height < 36 || r.width < 36)
      .map(({ el, r }) => `${label(el)} (${Math.round(r.width)}×${Math.round(r.height)})`)
    const popups = [...document.querySelectorAll('.van-popup, .van-dialog')].filter(visible)
    const popupInfo = popups.map((el) => {
      const r = el.getBoundingClientRect()
      const buttons = [...el.querySelectorAll('button')].filter(visible)
      const offscreen = buttons.filter((b) => b.getBoundingClientRect().top > vh).map(label)
      return { heightPct: Math.round((r.height / vh) * 100), top: Math.round(r.top), offscreenButtons: offscreen.slice(0, 6) }
    })
    const tabbar = document.querySelector('.van-tabbar')
    return {
      viewport: `${vw}×${vh}`,
      pageHeight: document.documentElement.scrollHeight,
      screens: Math.round((document.documentElement.scrollHeight / vh) * 10) / 10,
      horizontalOverflow: document.documentElement.scrollWidth - vw,
      smallTapTargets: [...new Set(small)].slice(0, 25),
      smallTapTargetCount: small.length,
      visiblePopups: popupInfo,
      tabbarHeight: tabbar ? Math.round(tabbar.getBoundingClientRect().height) : null,
      buttonsInView: clickables.length,
    }
  })
}

const tab = (page, name) => page.locator('.van-tabbar-item', { hasText: name }).click()
const settle = (page, ms = 500) => page.waitForTimeout(ms)
const toastGone = (page) => page.locator('.van-toast').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
async function closePopups(page) {
  for (let i = 0; i < 4; i++) {
    const overlay = page.locator('.van-overlay:visible').last()
    if (!(await overlay.count())) break
    await overlay.click({ position: { x: 5, y: 5 } }).catch(() => {})
    await settle(page, 350)
  }
}

for (const target of targets) {
  const browser = await target.engine.launch()
  const context = await browser.newContext({
    ...target.device,
    locale: 'zh-TW',
    timezoneId: 'Australia/Sydney',
  })
  const page = await context.newPage()
  await page.clock.setFixedTime(new Date('2026-11-18T10:00:00+11:00'))
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const results = {}
  report[target.name] = { results, errors }
  let n = 0
  const capture = async (name, { full = false } = {}) => {
    await settle(page, 450)
    const file = `${target.name}-${String(++n).padStart(2, '0')}-${name}.png`
    await page.screenshot({ path: join(outDir, file), fullPage: full }).catch(() => {})
    results[name] = { file, ...(await measure(page).catch((e) => ({ error: String(e) }))) }
  }
  const step = async (name, fn) => {
    try {
      await fn()
    } catch (error) {
      results[`${name}:error`] = String(error.message || error).slice(0, 300)
      await page.screenshot({ path: join(outDir, `${target.name}-error-${name}.png`) }).catch(() => {})
      await closePopups(page)
    }
  }

  await page.goto(url, { waitUntil: 'networkidle' })
  await settle(page, 800)

  await step('home-guest', async () => {
    await capture('home-guest')
    await capture('home-guest-full', { full: true })
  })
  await step('payroll-guest', async () => {
    await tab(page, '薪資')
    await capture('payroll-guest-full', { full: true })
  })
  await step('auth', async () => {
    await tab(page, '首頁')
    await settle(page)
    await page.locator('.home-header__account').click()
    await capture('auth-sheet')
    await closePopups(page)
  })
  await step('setup', async () => {
    await tab(page, '薪資')
    await page.getByRole('button', { name: '填滿本週' }).click()
    await page.getByText('你還沒有設定薪資費率或預設班別').waitFor({ timeout: 5000 })
    await capture('gate')
    await page.getByRole('button', { name: '手動設定費率' }).click()
    await page.getByText('輸入合約或薪資單上的費率').waitFor({ timeout: 5000 })
    await capture('wizard-1')
    await page.getByPlaceholder('例如 30.00').fill('30')
    await capture('wizard-1-keyboard-filled')
    await page.getByPlaceholder('例如 15').fill('15')
    await page.getByRole('button', { name: '儲存，下一步' }).click()
    await page.getByText('點選常見班別加入').waitFor({ timeout: 5000 })
    await page.getByRole('button', { name: /^晚班 23:50/ }).click()
    await page.getByRole('button', { name: /^早班 06:00/ }).click()
    await capture('wizard-2')
    const rows = page.locator('.week__row')
    for (const [index, name] of [[0, '晚班'], [1, '早班'], [2, '晚班'], [3, '晚班'], [4, '晚班']]) {
      await rows.nth(index).getByRole('button', { name, exact: true }).click()
    }
    await page.locator('.setup__body').evaluate((el) => el.scrollTo(0, el.scrollHeight))
    await capture('wizard-2-bottom')
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await page.getByText('以本週為例').waitFor({ timeout: 5000 })
    await capture('wizard-3')
    await page.getByRole('button', { name: '完成設定' }).click()
    await page.getByText('工作設定完成，現在可以開始預估薪資。').waitFor({ timeout: 5000 })
    await capture('wizard-4-done')
    await page.getByRole('button', { name: '繼續填滿本週' }).click()
    await page.getByText(/加入 \d+ 筆紀錄/).waitFor({ timeout: 5000 })
    await capture('fill-preview')
    await page.getByRole('button', { name: /加入 \d+ 筆紀錄/ }).click()
    await settle(page, 600)
    await toastGone(page)
  })
  await step('payroll-configured', async () => {
    await page.evaluate(() => window.scrollTo(0, 0))
    await capture('payroll-top')
    await capture('payroll-full', { full: true })
    // 點日曆上的今天 → 當天操作
    const today = page.locator('.van-calendar__day', { hasText: /^18/ }).first()
    await today.scrollIntoViewIfNeeded()
    await today.click()
    await settle(page)
    await capture('payroll-day-selected')
    const editor = page.getByRole('button', { name: /編輯當天工時|新增當天班表/ }).first()
    await editor.click()
    await settle(page)
    await capture('payroll-day-editor')
    const startField = page.locator('.van-field', { hasText: /上班/ }).first()
    if (await startField.count()) {
      await startField.click()
      await capture('time-picker')
      await closePopups(page)
    }
  })
  await step('home-configured', async () => {
    await tab(page, '首頁')
    await page.evaluate(() => window.scrollTo(0, 0))
    await capture('home')
    await capture('home-full', { full: true })
  })
  await step('expenses', async () => {
    await tab(page, '支出')
    await page.evaluate(() => window.scrollTo(0, 0))
    await capture('expenses')
    await capture('expenses-full', { full: true })
    const add = page.getByRole('button', { name: /新增支出|記一筆|新增/ }).first()
    await add.click()
    await capture('expense-form')
    const amount = page.locator('.van-popup:visible input[inputmode=decimal], .van-popup:visible input[type=number]').first()
    if (await amount.count()) {
      await amount.fill('25')
      await capture('expense-form-typing')
    }
    await closePopups(page)
  })
  await step('trips', async () => {
    await tab(page, '車資')
    await page.evaluate(() => window.scrollTo(0, 0))
    await capture('trips')
    await capture('trips-full', { full: true })
    const add = page.getByRole('button', { name: /新增行程|記錄行程|新增乘客/ }).first()
    await add.click()
    await capture('trip-form')
    await closePopups(page)
  })
  await step('more', async () => {
    await tab(page, '更多')
    await page.evaluate(() => window.scrollTo(0, 0))
    await capture('more-full', { full: true })
  })
  await step('shopping', async () => {
    await page.getByText('採買清單').first().click()
    await settle(page)
    await capture('shopping')
    await page.goBack().catch(() => {})
  })
  await step('payslip', async () => {
    await tab(page, '首頁')
    await settle(page)
    const entry = page.getByRole('button', { name: /薪資單/ }).first()
    await entry.click()
    await capture('payslip-sheet')
    await closePopups(page)
  })
  await step('back-button', async () => {
    // 瀏覽器／Android 返回鍵：打開彈窗後按返回，是否關閉彈窗而不是離開 App
    await tab(page, '支出')
    await page.getByRole('button', { name: /新增支出|記一筆|新增/ }).first().click()
    await settle(page)
    const before = page.url()
    await page.goBack().catch(() => {})
    await settle(page, 800)
    results.backButton = {
      urlBefore: before,
      urlAfter: page.url(),
      popupStillOpen: await page.locator('.van-popup:visible').count(),
    }
  })
  await browser.close()
}

writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2).slice(0, 20000))
