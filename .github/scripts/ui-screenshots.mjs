// 用 Playwright 截取首頁（訪客模式）。先在薪資頁「填滿本週」產生示範班表，再回首頁截圖。
// 日期固定在 2026-11-12（雪梨時間），讓前後版本的畫面可以比較。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(join(process.cwd(), 'package.json'))
const { chromium } = require('playwright')

const outDir = process.env.OUT_DIR || 'ui-screenshots'
const fixtureDir = process.env.FIXTURE_DIR || ''
mkdirSync(outDir, { recursive: true })

const targets = [
  { name: 'before', url: 'http://127.0.0.1:4173' },
  { name: 'after', url: 'http://127.0.0.1:4174' },
]
const widths = [
  { name: '320', width: 320, height: 720 },
  { name: '375', width: 375, height: 812 },
  { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 },
  { name: 'desktop', width: 1280, height: 900 },
]
const report = []

const browser = await chromium.launch()
for (const target of targets) {
  for (const size of widths) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 2,
      locale: 'zh-TW',
      timezoneId: 'Australia/Sydney',
    })
    const page = await context.newPage()
    await page.clock.setFixedTime(new Date('2026-11-12T10:00:00+11:00'))
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(target.url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)

    if (size.name === '390') {
      await page.screenshot({ path: join(outDir, `${target.name}-${size.name}-empty.png`), fullPage: true })
    }

    // 產生示範資料：薪資頁 → 填滿本週 → 回首頁
    await page.locator('.van-tabbar-item', { hasText: '薪資' }).click()
    await page.getByRole('button', { name: '填滿本週' }).click()
    await page.waitForTimeout(500)
    await page.locator('.van-tabbar-item', { hasText: '首頁' }).click()
    await page.evaluate(() => window.scrollTo(0, 0))
    // 等「成功加入班表」提示消失再截圖
    await page.locator('.van-toast').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(500)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    await page.screenshot({ path: join(outDir, `${target.name}-${size.name}.png`), fullPage: true })
    if (size.name === '390') {
      await page.screenshot({ path: join(outDir, `${target.name}-${size.name}-fold.png`) })
    }
    // 互動檢查（新版才有）：展開進階統計、快捷操作「新增支出」會打開表單
    const checks = {}
    if (target.name === 'after' && size.name === '390') {
      try {
        await page.getByRole('button', { name: /進階統計/ }).click()
        await page.waitForTimeout(1200)
        checks.advancedOpened = await page.locator('#advanced-panel').isVisible()
        await page.locator('#advanced-panel').screenshot({ path: join(outDir, 'after-390-advanced.png') })
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.getByRole('button', { name: '新增支出' }).click()
        await page.waitForTimeout(800)
        checks.expenseFormOpened = await page.locator('.van-popup--bottom').first().isVisible()
        await page.screenshot({ path: join(outDir, 'after-390-quick-expense.png') })
      } catch (error) {
        checks.error = String(error.message || error).slice(0, 300)
      }
    }
    if (target.name === 'after' && size.name === '390' && fixtureDir) {
      checks.payslip = await payslipFlow(page)
    }
    report.push({ target: target.name, width: size.width, horizontalOverflowPx: overflow, errors, checks })
    await context.close()
  }
}
await browser.close()

// 薪資單匯入：合成的加密 PDF → 錯誤密碼 → 正確密碼 → 確認 → 套用費率
async function payslipFlow(page) {
  const result = {}
  const shot = (name) => page.screenshot({ path: join(outDir, `payslip-${name}.png`) })
  try {
    // 重新載入，關掉前面檢查留下的彈窗（訪客資料會清空）
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: /讓第一張薪資單/ }).click()
    await page.waitForTimeout(600)
    await shot('1-choose')
    await page
      .locator('input[type=file][accept*="pdf"]')
      .setInputFiles(join(fixtureDir, 'sample-payslip-locked.pdf'))
    await page.getByLabel('PDF 密碼').waitFor({ timeout: 15000 })
    await shot('2-password')
    await page.getByLabel('PDF 密碼').fill('wrong-password')
    await page.getByRole('button', { name: '解鎖並讀取' }).click()
    await page.getByText('密碼不正確').waitFor({ timeout: 15000 })
    result.wrongPasswordRejected = true
    await shot('3-wrong-password')
    await page.getByLabel('PDF 密碼').fill('sample1234')
    await page.getByRole('button', { name: '解鎖並讀取' }).click()
    await page.getByText('確認薪資單內容').waitFor({ timeout: 15000 })
    await page.waitForTimeout(400)
    result.netPayShown = await page.getByText('$1,653.00').first().isVisible()
    await shot('4-summary')
    await page.getByRole('tab', { name: '工作費率' }).click()
    await page.waitForTimeout(400)
    await shot('5-rates')
    result.saturdayKept = await page.getByText('保留目前設定，不會設為 0').first().isVisible()
    await page.getByRole('button', { name: '確認並套用' }).click()
    await page.waitForTimeout(1200)
    await page.locator('.van-tabbar-item', { hasText: '薪資' }).click()
    await page.getByText('進階：各項加給費率').click()
    await page.waitForTimeout(600)
    const rates = page.locator('.payslip-entry').locator('..')
    await rates.screenshot({ path: join(outDir, 'payslip-6-applied-rates.png') })
    result.ratesFromPayslip = await page.getByText('來自薪資單').count()
    await page.locator('.van-tabbar-item', { hasText: '首頁' }).click()
    await page.waitForTimeout(600)
    await page.getByText('年度稅務追蹤').scrollIntoViewIfNeeded()
    await shot('7-dashboard-tax')
    result.taxBadge = await page.getByText('薪資單 YTD').first().isVisible()
  } catch (error) {
    result.error = String(error.message || error).slice(0, 400)
    await shot('error').catch(() => {})
  }
  return result
}
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
