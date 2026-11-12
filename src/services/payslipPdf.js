// 在裝置上讀取薪資單 PDF：檔案與密碼只在這台裝置的記憶體中處理，不會上傳，也不會寫入任何紀錄。
import { buildTextLines } from '../domain/payslip/textLines.js'

const MAX_PAGES = 3
export const MAX_PAYSLIP_BYTES = 5 * 1024 * 1024

let pdfjsPromise = null

/** 第一次使用時才下載 pdf.js，避免拖慢 App 開啟速度 */
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.min.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    })
  }
  return pdfjsPromise
}

export class PayslipPasswordError extends Error {
  /** @param {'NEED_PASSWORD' | 'WRONG_PASSWORD'} reason */
  constructor(reason) {
    super(reason === 'WRONG_PASSWORD' ? '密碼不正確，請再試一次' : '這份 PDF 需要密碼才能開啟')
    this.name = 'PayslipPasswordError'
    this.reason = reason
  }
}

/**
 * @param {ArrayBuffer} buffer PDF 檔案內容（每次會複製一份交給 pdf.js，原始內容可重複使用）
 * @param {string} [password]
 * @returns {Promise<{ lines: string[], pageCount: number, hasText: boolean }>}
 */
export async function readPayslipPdf(buffer, password) {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer.slice(0)),
    password: password || undefined,
    isEvalSupported: false,
    disableFontFace: true,
  })
  let doc
  try {
    doc = await task.promise
  } catch (error) {
    if (error?.name === 'PasswordException') {
      const wrong = error.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD
      throw new PayslipPasswordError(wrong ? 'WRONG_PASSWORD' : 'NEED_PASSWORD')
    }
    throw new Error('無法讀取這份 PDF，檔案可能已損壞')
  }
  try {
    const lines = []
    for (let pageNumber = 1; pageNumber <= Math.min(doc.numPages, MAX_PAGES); pageNumber += 1) {
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      lines.push(...buildTextLines(/** @type {any} */ (content.items)))
    }
    return { lines, pageCount: doc.numPages, hasText: lines.some((line) => line.trim() !== '') }
  } finally {
    await doc.destroy()
  }
}

/** 文件指紋（SHA-256），用來判斷是否重複匯入同一份檔案；不含檔案內容本身 */
export async function fingerprintFile(/** @type {ArrayBuffer} */ buffer) {
  if (!globalThis.crypto?.subtle) return null
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
