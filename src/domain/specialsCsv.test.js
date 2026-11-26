import { describe, expect, it } from 'vitest'
import { mapErrorLines, parseCsv, splitSpecialsCsv } from './specialsCsv.js'

const HEADER =
  'external_product_id,name,brand,package_size,category,regular_price,sale_price,unit_price,promotion_type,promotion_start,promotion_end,product_url'

function row(/** @type {number} */ id, name = `Item ${id}`) {
  return `${id},${name},,,,5,2.5,,HALF_PRICE,2026-11-26,2026-12-02,`
}

describe('parseCsv', () => {
  it('handles BOM, quotes, commas and newlines inside quotes', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","line1\nline2"\r\n"say ""hi"""')).toEqual([
      ['a', 'b'],
      ['x, y', 'line1\nline2'],
      ['say "hi"'],
    ])
  })
})

describe('splitSpecialsCsv', () => {
  it('keeps one batch for a small file and skips blank rows', () => {
    const result = splitSpecialsCsv(`${HEADER}\n${row(1)}\n,,,\n\n${row(2)}\n`)
    expect(result.rowCount).toBe(2)
    expect(result.batches).toHaveLength(1)
    expect(result.batches[0].sourceRows).toEqual([2, 5])
    expect(parseCsv(result.batches[0].csv)[0].join(',')).toBe(HEADER)
  })

  it('drops columns the importer does not use (e.g. long descriptions)', () => {
    const long = 'x'.repeat(5000)
    const result = splitSpecialsCsv(
      `external_product_id,name,description,sale_price,promotion_start,promotion_end\n1,Milk,${long},2,2026-11-26,2026-12-02`,
    )
    expect(result.droppedColumns).toEqual(['description'])
    expect(result.batches[0].csv).not.toContain(long)
    expect(parseCsv(result.batches[0].csv)[1]).toEqual([
      '1',
      'Milk',
      '2',
      '2026-11-26',
      '2026-12-02',
    ])
  })

  it('splits by row count and by bytes, each batch with the header', () => {
    const lines = Array.from({ length: 25 }, (_, i) => row(i + 1))
    const byRows = splitSpecialsCsv(`${HEADER}\n${lines.join('\n')}`, { maxRows: 10 })
    expect(byRows.batches.map((batch) => batch.sourceRows.length)).toEqual([10, 10, 5])
    expect(byRows.batches[2].sourceRows[0]).toBe(22)
    expect(byRows.batches.every((batch) => batch.csv.startsWith(HEADER))).toBe(true)

    const bySize = splitSpecialsCsv(`${HEADER}\n${lines.join('\n')}`, { maxBytes: 600 })
    expect(bySize.batches.length).toBeGreaterThan(1)
    expect(bySize.batches.every((batch) => new TextEncoder().encode(batch.csv).length <= 600)).toBe(
      true,
    )
    expect(bySize.batches.flatMap((batch) => batch.sourceRows)).toHaveLength(25)
  })

  it('re-quotes values that contain commas or quotes', () => {
    const result = splitSpecialsCsv(`${HEADER}\n${row(1, '"Tim Tam, ""Original"""')}`)
    expect(parseCsv(result.batches[0].csv)[1][1]).toBe('Tim Tam, "Original"')
  })

  it('sends the file as-is when no known column exists, so the server can explain', () => {
    const result = splitSpecialsCsv('foo,bar\n1,2')
    expect(result.batches[0].csv).toContain('foo,bar')
  })

  it('returns nothing for an empty file', () => {
    expect(splitSpecialsCsv('')).toEqual({ batches: [], rowCount: 0, droppedColumns: [] })
  })
})

describe('mapErrorLines', () => {
  it('maps per-batch line numbers back to the original file', () => {
    const batch = { csv: '', sourceRows: [22, 23, 25] }
    expect(mapErrorLines(['第 2 列：缺少 name', '第 4 列：x', 'CSV 是空的'], batch)).toEqual([
      '第 22 列：缺少 name',
      '第 25 列：x',
      'CSV 是空的',
    ])
  })
})
