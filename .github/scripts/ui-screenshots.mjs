// 用 Playwright 截取首頁（訪客模式）並走過主要流程。
// 日期固定在 2026-11-12（雪梨時間），讓前後版本的畫面可以比較。
//
// 新版（after）沒有任何預設費率與班表，所以先走「工作設定」：
// 手動設定費率 → 選班別與工作日 → Smoko 與預覽 → 填滿本週（預覽後確認）。
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

const overflowOf = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
// 彈出視窗內是否有水平溢出（例如設定精靈）
const popupOverflow = (page) =>
  page.evaluate(() =>
    Math.max(
      0,
      ...[...document.querySelectorAll('.van-popup')]
        .filter((el) => el.offsetParent !== null)
        .flatMap((el) => [el, ...el.querySelectorAll('*')])
        .map((el) => el.scrollWidth - el.clientWidth)
        .filter((value) => value > 1 && value < 2000),
    ),
  )
const tab = (page, name) => page.locator('.van-tabbar-item', { hasText: name }).click()
const toastGone = (page) =>
  page.locator('.van-toast').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})

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
    const is390 = size.name === '390'
    const checks = {}
    const shot = (name) =>
      page.screenshot({ path: join(outDir, `${target.name}-${size.name}-${name}.png`) })

    if (is390 || size.name === '320') await shot('empty')

    if (target.name === 'before') {
      await tab(page, '薪資')
      await page.getByRole('button', { name: '填滿本週' }).click()
      await page.waitForTimeout(500)
      // 基準版本若已有工作設定閘門，關掉彈窗再截首頁
      if (await page.locator('.van-popup:visible').count()) await page.reload({ waitUntil: 'networkidle' })
    } else {
      try {
        Object.assign(checks, await guestSetupFlow(page, is390 || size.name === '320' ? shot : null))
        checks.wizardOverflowPx = checks.wizardOverflowPx ?? 0
      } catch (error) {
        checks.error = String(error.message || error).slice(0, 400)
        await shot('error').catch(() => {})
        // 關掉卡住的彈窗，繼續截其他畫面
        await page.reload({ waitUntil: 'networkidle' })
      }
    }

    await tab(page, '首頁')
    await page.evaluate(() => window.scrollTo(0, 0))
    await toastGone(page)
    await page.waitForTimeout(500)
    const overflow = await overflowOf(page)
    await page.screenshot({ path: join(outDir, `${target.name}-${size.name}.png`), fullPage: true })
    if (is390) await shot('fold')

    if (target.name === 'after' && is390) {
      try {
        await page.getByRole('button', { name: /進階統計/ }).click()
        await page.waitForTimeout(1200)
        checks.advancedOpened = await page.locator('#advanced-panel').isVisible()
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.getByRole('button', { name: '新增支出' }).click()
        await page.waitForTimeout(800)
        checks.expenseFormOpened = await page.locator('.van-popup--bottom:visible').count() > 0
      } catch (error) {
        checks.quickError = String(error.message || error).slice(0, 300)
      }
      if (fixtureDir) checks.payslip = await payslipFlow(page)
    }
    report.push({ target: target.name, width: size.width, horizontalOverflowPx: overflow, errors, checks })
    await context.close()
  }
}
await browser.close()

/**
 * 新訪客：沒有任何費率 → 填滿本週會被擋下 → 手動設定 → 班別 → Smoko → 完成 → 繼續填滿本週。
 * @param {import('playwright').Page} page
 * @param {null | ((name: string) => Promise<unknown>)} shot
 */
async function guestSetupFlow(page, shot) {
  const result = {}
  const capture = async (name) => {
    await page.waitForTimeout(450) // 等彈窗動畫結束
    if (shot) await shot(name)
    result.wizardOverflowPx = Math.max(result.wizardOverflowPx ?? 0, await popupOverflow(page))
  }
  // 1. 新訪客：首頁主卡提示先完成工作設定
  result.heroAsksSetup = await page.getByText('先完成工作設定').first().isVisible()

  // 2. 薪資頁「填滿本週」→ 設定閘門，不會用任何預設費率產生班表
  await tab(page, '薪資')
  await page.waitForTimeout(300)
  if (shot) await shot('payroll-not-configured')
  await page.getByRole('button', { name: '填滿本週' }).click()
  await page.getByText('你還沒有設定薪資費率或預設班別').waitFor({ timeout: 5000 })
  result.gateShown = true
  await capture('gate')
  const recordsBefore = await page.locator('.schedule-pay').count()
  result.noRecordsWithoutSetup = recordsBefore === 0

  // 3. 手動設定費率
  await page.getByRole('button', { name: '手動設定費率' }).click()
  await page.getByText('輸入合約或薪資單上的費率').waitFor({ timeout: 5000 })
  await page.getByPlaceholder('例如 30.00').fill('30')
  await page.getByPlaceholder('例如 15').fill('15')
  await capture('wizard-1-manual')
  await page.getByRole('button', { name: '儲存，下一步' }).click()

  // 4. 班別：晚班＋清潔班，週一三四五晚班、週二清潔班
  await page.getByText('點選常見班別加入').waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: /^晚班 23:50/ }).click()
  await page.getByRole('button', { name: /^晚班清潔班/ }).click()
  const rows = page.locator('.week__row')
  for (const [index, name] of [
    [0, '晚班'],
    [1, '晚班清潔班'],
    [2, '晚班'],
    [3, '晚班'],
    [4, '晚班'],
  ]) {
    await rows.nth(index).getByRole('button', { name, exact: true }).click()
  }
  await capture('wizard-2-shifts')
  if (shot) {
    await page.locator('.setup__body').evaluate((el) => el.scrollTo(0, el.scrollHeight))
    await capture('wizard-2-week')
  }
  await page.getByRole('button', { name: '下一步', exact: true }).click()

  // 5. Smoko 與預覽
  await page.getByText('以本週為例').waitFor({ timeout: 5000 })
  result.previewShifts = await page.locator('.preview__days li:not(.is-off)').count()
  result.previewExcludedFlag = await page.getByText(/未含/).first().isVisible()
  await capture('wizard-3-smoko')
  if (shot) {
    await page.locator('.setup__body').evaluate((el) => el.scrollTo(0, el.scrollHeight))
    await capture('wizard-3-preview')
  }
  await page.getByRole('button', { name: '完成設定' }).click()
  await page.getByText('工作設定完成，現在可以開始預估薪資。').waitFor({ timeout: 5000 })
  await capture('wizard-4-done')

  // 6. 回到原本的「填滿本週」→ 預覽 → 確認
  await page.getByRole('button', { name: '繼續填滿本週' }).click()
  await page.getByText(/加入 \d+ 筆紀錄/).waitFor({ timeout: 5000 })
  await capture('fill-preview')
  result.fillPreviewCount = await page.locator('.fill__list li').count()
  await page.getByRole('button', { name: /加入 \d+ 筆紀錄/ }).click()
  await page.waitForTimeout(600)
  await toastGone(page)
  result.weekRecords = await page.locator('.calendar-wrapper .record-work-day').count()

  // 7. 再按一次填滿本週：已有紀錄的日期不會被覆蓋
  await page.getByRole('button', { name: '填滿本週' }).click()
  await page.getByText('沒有需要新增的班表').waitFor({ timeout: 5000 })
  result.noOverwrite = true
  await page.getByRole('button', { name: '關閉' }).click()
  await page.waitForTimeout(300)
  if (shot) {
    await page.locator('.work-setup-card').scrollIntoViewIfNeeded()
    await shot('payroll-configured')
  }
  return result
}

// 薪資單匯入：合成的加密 PDF → 錯誤密碼 → 正確密碼 → 確認並保存 → 首頁看到最近一期薪資
async function payslipFlow(page) {
  const result = {}
  const shot = (name) => page.screenshot({ path: join(outDir, `payslip-${name}.png`) })
  try {
    // 重新載入：回到全新訪客（訪客資料只在記憶體）
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: /讓第一張薪資單/ }).click()
    await page.waitForTimeout(600)
    await shot('1-choose')
    await page
      .locator('input[type=file][accept*="pdf"]')
      .setInputFiles(join(fixtureDir, 'sample-payslip-locked.pdf'))
    await page.getByLabel('PDF 密碼').waitFor({ timeout: 15000 })
    await page.getByLabel('PDF 密碼').fill('wrong-password')
    await page.getByRole('button', { name: '解鎖並讀取' }).click()
    await page.getByText('密碼不正確').waitFor({ timeout: 15000 })
    result.wrongPasswordRejected = true
    await page.getByLabel('PDF 密碼').fill('sample1234')
    await page.getByRole('button', { name: '解鎖並讀取' }).click()
    await page.getByText('確認薪資單內容').waitFor({ timeout: 15000 })
    await page.waitForTimeout(400)
    result.netPayShown = await page.getByText('$1,653.00').first().isVisible()
    await shot('2-summary')
    await page.getByRole('tab', { name: '工作費率' }).click()
    await page.waitForTimeout(400)
    await shot('3-rates')
    result.paygLabel = await page.getByText('本期實際預扣比例').first().isVisible()
    await page.getByRole('button', { name: '確認並保存' }).click()
    // 還沒設定班別 → 直接接著打開設定精靈 Step 2
    await page.getByText('點選常見班別加入').waitFor({ timeout: 8000 })
    result.wizardOpenedAtShifts = true
    await toastGone(page)
    await shot('4-wizard-shifts')
    await page.getByRole('button', { name: /^早班 06:00/ }).click()
    const rows = page.locator('.week__row')
    for (const index of [0, 1, 2]) {
      await rows.nth(index).getByRole('button', { name: '早班', exact: true }).click()
    }
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await page.getByText('以本週為例').waitFor({ timeout: 5000 })
    await page.getByRole('radio', { name: '1 次' }).click()
    await page.waitForTimeout(300)
    await shot('5-wizard-smoko')
    await page.getByRole('button', { name: '完成設定' }).click()
    await page.getByText('工作設定完成，現在可以開始預估薪資。').waitFor({ timeout: 5000 })
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await page.waitForTimeout(400)
    await tab(page, '首頁')
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(500)
    result.latestPayslipCard = await page.getByText('最近一期薪資').isVisible()
    await shot('6-dashboard')
    await page.locator('.latest-pay').screenshot({ path: join(outDir, 'payslip-7-latest-card.png') })
    await page.getByText('年度稅務追蹤').scrollIntoViewIfNeeded()
    result.taxBadge = await page.getByText('薪資單 YTD').first().isVisible()
    await shot('8-dashboard-tax')
    await tab(page, '薪資')
    await page.locator('.work-setup-card').scrollIntoViewIfNeeded()
    await shot('9-payroll-setup-card')
    result.rateStatusShown = await page.getByText(/薪資單確認/).first().isVisible()
  } catch (error) {
    result.error = String(error.message || error).slice(0, 400)
    await shot('error').catch(() => {})
  }
  return result
}
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
