import { describe, expect, it } from 'vitest'
import { classifyPayItem } from './classify.js'
import { parsePayslipLines } from './parsePayslip.js'
import {
  getDefaultDerivedRate,
  getRateProposals,
  getRatesToApply,
  getStoredRateOverrides,
} from './rates.js'
import { buildTextLines } from './textLines.js'
import { SAMPLE_PAYSLIP_LINES } from './fixtures/samplePayslip.js'

describe('buildTextLines', () => {
  it('groups pdf.js text pieces into lines ordered top to bottom and left to right', () => {
    const items = [
      { str: 'Gross', transform: [1, 0, 0, 1, 10, 100], width: 24 },
      { str: '1,945.00', transform: [1, 0, 0, 1, 120, 100.5], width: 36 },
      { str: 'Employer', transform: [1, 0, 0, 1, 10, 300], width: 40 },
      { str: 'SAMPLE FARM', transform: [1, 0, 0, 1, 60, 300], width: 50 },
      { str: ' ', transform: [1, 0, 0, 1, 200, 300], width: 2 },
    ]
    expect(buildTextLines(items)).toEqual(['Employer   SAMPLE FARM', 'Gross   1,945.00'])
  })
})

describe('parsePayslipLines', () => {
  const payslip = parsePayslipLines(SAMPLE_PAYSLIP_LINES)

  it('reads the summary, dates and year-to-date figures', () => {
    expect(payslip).toMatchObject({
      employer: { name: 'SAMPLE FARM PTY LTD', abn: '12345678901' },
      periodStart: '2026-11-02',
      periodEnd: '2026-11-08',
      payDate: '2026-11-12',
      grossCents: 194500,
      taxCents: 29200,
      netCents: 165300,
      superCents: 19530,
      ytd: { grossCents: 3000000, taxCents: 450000, superCents: 320000 },
      baseRate: 30,
    })
    expect(payslip.warnings).toEqual([])
  })

  it('does not mistake year-to-date super for year-to-date gross', () => {
    expect(payslip.ytd.grossCents).not.toBe(payslip.ytd.superCents)
  })

  it('reads every pay item, joining wrapped names and skipping subtotal lines', () => {
    expect(payslip.items.map((item) => [item.rawName, item.type, item.calcMethod])).toEqual([
      ['FOOD PROCESSING A WARD - CASUAL - LEVEL 4', 'BASE_PAY', 'FULL_RATE'],
      ['T/Half', 'OVERTIME_1_5', 'FULL_RATE'],
      ['Double', 'OVERTIME_2_0', 'FULL_RATE'],
      ['CASUAL LOADING 25%', 'CASUAL_LOADING', 'ADDITIONAL'],
      ['PPE & TOOL ALLOWANCE', 'PPE_ALLOWANCE', 'FLAT'],
      ['SHIFT 25%', 'SHIFT_LOADING', 'ADDITIONAL'],
      ['SUN ORD LOAD 75%', 'SUNDAY_LOADING', 'ADDITIONAL'],
    ])
  })

  it('keeps unrecognised items as UNKNOWN instead of dropping them', () => {
    const lines = [...SAMPLE_PAYSLIP_LINES]
    lines.splice(16, 0, 'FIRST AID   1.00 Hrs   2.0000   2.00')
    const result = parsePayslipLines(lines)
    const firstAid = result.items.find((item) => item.rawName === 'FIRST AID')
    expect(firstAid).toMatchObject({ type: 'UNKNOWN', confidence: 'LOW' })
    expect(result.warnings.some((warning) => warning.includes('不一致'))).toBe(true)
  })

  it('warns when gross, tax and net pay do not add up or fields are missing', () => {
    const lines = SAMPLE_PAYSLIP_LINES.map((line) =>
      line.startsWith('NET PAY') ? 'NET PAY   1,600.00   25,500.00' : line,
    ).filter((line) => !line.startsWith('Tax'))
    const result = parsePayslipLines(lines)
    expect(result.taxCents).toBeNull()
    expect(result.warnings).toContain('找不到扣稅金額（Tax / PAYG）')
  })
})

describe('classifyPayItem', () => {
  it('uses the rate ratio, not just the name, to decide how a rate is calculated', () => {
    expect(classifyPayItem('SUNDAY 175%', { hours: 8, rate: 52.5, baseRate: 30 })).toMatchObject({
      type: 'SUNDAY_LOADING',
      calcMethod: 'FULL_RATE',
      ratio: 1.75,
    })
    expect(classifyPayItem('T/Half', { hours: 2, rate: 15, baseRate: 30 })).toMatchObject({
      type: 'OVERTIME_1_5',
      calcMethod: 'ADDITIONAL',
      confidence: 'LOW',
    })
  })
})

describe('getRateProposals', () => {
  const payslip = parsePayslipLines(SAMPLE_PAYSLIP_LINES)
  const current = {
    baseRate: 26.74,
    casualLoadingRate: 6.685,
    shiftLoadingRate: 6.685,
    saturdayOrdLoadingRate: 13.37,
    sundayLoadingRate: 20.055,
    timeHalfRate: 40.11,
    doubleRate: 53.48,
    ppeAllowance: 5,
    withholdingTaxRate: 0.12,
  }

  it('proposes observed rates and keeps unseen ones as NOT_OBSERVED instead of zero', () => {
    const rows = getRateProposals(payslip, current)
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]))
    expect(byKey.baseRate).toMatchObject({ proposed: 30, status: 'NEW' })
    expect(byKey.sundayLoadingRate).toMatchObject({ proposed: 22.5, status: 'NEW' })
    expect(byKey.timeHalfRate).toMatchObject({ proposed: 45, status: 'NEW' })
    expect(byKey.ppeAllowance).toMatchObject({ proposed: 10, status: 'NEW' })
    expect(byKey.saturdayOrdLoadingRate).toMatchObject({ proposed: null, status: 'NOT_OBSERVED' })
    expect(byKey.withholdingTaxRate).toMatchObject({ proposed: 0.1501, status: 'CHANGED' })

    const toApply = getRatesToApply(rows)
    expect(toApply).not.toHaveProperty('saturdayOrdLoadingRate')
    expect(toApply.baseRate).toBe(30)
  })

  it('marks rates already confirmed from a payslip as SAME or CHANGED', () => {
    const sources = { baseRate: 'payslip', casualLoadingRate: 'payslip' }
    const rows = getRateProposals(payslip, { ...current, baseRate: 30, casualLoadingRate: 7 }, sources)
    expect(rows.find((row) => row.key === 'baseRate')?.status).toBe('SAME')
    expect(rows.find((row) => row.key === 'casualLoadingRate')).toMatchObject({
      current: 7,
      proposed: 7.5,
      status: 'CHANGED',
    })
  })

  it('converts a full-rate Sunday line into the app additional-loading convention', () => {
    const fullRateSunday = {
      ...payslip,
      items: [
        ...payslip.items.filter((item) => item.type !== 'SUNDAY_LOADING'),
        { rawName: 'SUNDAY 175%', type: 'SUNDAY_LOADING', calcMethod: 'FULL_RATE', rate: 52.5, hours: 8, amountCents: 42000 },
      ],
    }
    const sunday = getRateProposals(fullRateSunday, current).find(
      (row) => row.key === 'sundayLoadingRate',
    )
    expect(sunday?.proposed).toBe(22.5)
  })

  it('derives default rates from the base rate', () => {
    expect(getDefaultDerivedRate('sundayLoadingRate', 28.01)).toBe(21.0075)
    expect(getDefaultDerivedRate('baseRate', 28.01)).toBeNull()
  })

  it('treats stored rates that differ from the default multiplier as payslip overrides', () => {
    expect(
      getStoredRateOverrides({
        baseRate: '28.0100',
        casualLoadingRate: '7.0025',
        shiftLoadingRate: '8.5000',
        sundayLoadingRate: null,
      }),
    ).toEqual({ shiftLoadingRate: 8.5 })
  })
})
