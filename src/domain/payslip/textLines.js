/**
 * 把 pdf.js 的文字片段（含座標）重建成「一行一字串」，欄位之間以兩個以上空白分隔，
 * 讓解析器可以用同一套規則處理不同的 PDF 產生器。
 *
 * @param {Array<{ str: string, transform: number[], width?: number }>} items
 * @returns {string[]}
 */
export function buildTextLines(items) {
  const pieces = items
    .filter((item) => item && typeof item.str === 'string' && item.str.trim() !== '')
    .map((item) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: Number(item.width) || item.str.length * 4,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x)

  /** @type {Array<{ y: number, pieces: typeof pieces }>} */
  const rows = []
  for (const piece of pieces) {
    const row = rows.find((candidate) => Math.abs(candidate.y - piece.y) <= 2.5)
    if (row) row.pieces.push(piece)
    else rows.push({ y: piece.y, pieces: [piece] })
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      const sorted = row.pieces.sort((a, b) => a.x - b.x)
      let line = ''
      let lastEnd = null
      for (const piece of sorted) {
        if (lastEnd !== null) {
          const gap = piece.x - lastEnd
          line += gap > 6 ? '   ' : gap > 0.8 ? ' ' : ''
        }
        line += piece.text
        lastEnd = piece.x + piece.width
      }
      return line.replace(/\s+$/, '')
    })
}
