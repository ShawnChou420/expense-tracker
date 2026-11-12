// 用 Playwright 截取首頁（訪客模式）。先在薪資頁「填滿本週」產生示範班表，再回首頁截圖。
// 日期固定在 2026-11-12（雪梨時間），讓前後版本的畫面可以比較。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(join(process.cwd(), 'package.json'))
const { chromium } = require('playwright')

const outDir = process.env.OUT_DIR || 'ui-screenshots'
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
    await page.waitForTimeout(800)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    await page.screenshot({ path: join(outDir, `${target.name}-${size.name}.png`), fullPage: true })
    if (size.name === '390') {
      await page.screenshot({ path: join(outDir, `${target.name}-${size.name}-fold.png`) })
    }
    report.push({ target: target.name, width: size.width, horizontalOverflowPx: overflow, errors })
    await context.close()
  }
}
await browser.close()
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
