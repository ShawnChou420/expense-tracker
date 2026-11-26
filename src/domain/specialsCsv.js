/**
 * 特價 CSV 上傳前的整理：只保留匯入用得到的欄位，並把大檔切成多批，
 * 每批都在後端單次請求上限內（請求 256 KB、每批 2000 列），讓檔案大小不受限制。
 */

export const SPECIALS_CSV_COLUMNS = [
  'external_product_id',
  'name',
  'brand',
  'package_size',
  'category',
  'regular_price',
  'sale_price',
  'unit_price',
  'promotion_type',
  'promotion_start',
  'promotion_end',
  'product_url',
]

/** 每批上限：比後端 256 KB 請求上限留出 JSON 包裝與跳脫字元的空間 */
export const BATCH_MAX_BYTES = 150 * 1024
export const BATCH_MAX_ROWS = 1000

/**
 * 最小的 RFC 4180 解析：雙引號、引號內逗號與換行、"" 跳脫
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '')
  /** @type {string[][]} */
  const rows = []
  /** @type {string[]} */
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function csvField(/** @type {string} */ value) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function csvLine(/** @type {string[]} */ values) {
  return values.map(csvField).join(',')
}

const encoder = new TextEncoder()
function byteLength(/** @type {string} */ text) {
  return encoder.encode(text).length
}

/**
 * @typedef {{ csv: string, sourceRows: number[] }} CsvBatch
 * sourceRows：這批每一筆資料在原始檔的列號（標題列是第 1 列，與 Excel 列號相同），用來換算後端回報的錯誤列號
 */

/**
 * 只保留匯入欄位、略過空白列，切成多批（每批都帶標題列）。
 * 找不到任何匯入欄位時原樣送出第一批，讓後端回報缺少哪些欄位。
 * @param {string} text
 * @param {{ maxBytes?: number, maxRows?: number }} [limits]
 * @returns {{ batches: CsvBatch[], rowCount: number, droppedColumns: string[] }}
 */
export function splitSpecialsCsv(text, limits = {}) {
  const maxBytes = limits.maxBytes ?? BATCH_MAX_BYTES
  const maxRows = limits.maxRows ?? BATCH_MAX_ROWS
  const rows = parseCsv(text)
  if (!rows.length) return { batches: [], rowCount: 0, droppedColumns: [] }
  const header = rows[0].map((name) => name.trim().toLowerCase())
  const keep = header
    .map((name, index) => ({ name, index }))
    .filter(({ name }, position, all) => {
      return (
        SPECIALS_CSV_COLUMNS.includes(name) &&
        all.findIndex((other) => other.name === name) === position
      )
    })
  const useAll = keep.length === 0
  const columns = useAll ? header.map((name, index) => ({ name, index })) : keep
  const droppedColumns = useAll
    ? []
    : header.filter((name, index) => name && !keep.some((column) => column.index === index))
  const headerLine = csvLine(columns.map((column) => column.name))
  const headerBytes = byteLength(headerLine) + 2

  /** @type {CsvBatch[]} */
  const batches = []
  /** @type {string[]} */
  let lines = []
  /** @type {number[]} */
  let sourceRows = []
  let bytes = headerBytes
  let rowCount = 0
  const flush = () => {
    if (!lines.length) return
    batches.push({ csv: `${headerLine}\r\n${lines.join('\r\n')}\r\n`, sourceRows })
    lines = []
    sourceRows = []
    bytes = headerBytes
  }
  for (let r = 1; r < rows.length; r++) {
    const values = rows[r]
    if (values.every((value) => value.trim() === '')) continue
    const line = csvLine(columns.map((column) => values[column.index] ?? ''))
    const lineBytes = byteLength(line) + 2
    if (lines.length && (lines.length >= maxRows || bytes + lineBytes > maxBytes)) flush()
    lines.push(line)
    sourceRows.push(r + 1)
    bytes += lineBytes
    rowCount++
  }
  flush()
  return { batches, rowCount, droppedColumns }
}

/**
 * 後端每批各自從第 2 列開始算，換回原始檔案的列號。
 * @param {string[]} errors
 * @param {CsvBatch} batch
 */
export function mapErrorLines(errors, batch) {
  return errors.map((message) =>
    message.replace(/^第 (\d+) 列/, (match, line) => {
      const source = batch.sourceRows[Number(line) - 2]
      return source ? `第 ${source} 列` : match
    }),
  )
}
