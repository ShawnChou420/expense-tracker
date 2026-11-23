// 瀏覽器端收據 OCR（Tesseract.js，Apache-2.0，免費、不連付費服務）。
// - 辨識在 Web Worker 裡跑，不會卡住畫面。
// - Worker、核心 wasm 與英文模型都放在自己的網站 /ocr/ 下（scripts/copy-ocr-assets.mjs），不連第三方 CDN。
// - 模型第一次下載後存在 IndexedDB，之後不用重新下載。
// - 辨識出的文字只回傳給呼叫端，這裡不寫 log、不送事件。

/** 模型快取 key 的前綴；換模型版本時改這裡，舊快取就不會被誤用 */
const CACHE_PATH = 'receipt-ocr/eng-4.0.0_best_int'

export class OcrCancelledError extends Error {
  constructor() {
    super('OCR_CANCELLED')
    this.name = 'OcrCancelledError'
  }
}

/** @typedef {{ phase: 'LOADING' | 'RECOGNIZING', percent: number }} OcrProgress */

/**
 * 把 Tesseract 的各階段進度換算成單一百分比：載入（核心＋模型＋初始化）佔 0–30%，辨識佔 30–100%。
 * @param {{ status?: string, progress?: number } | null | undefined} message
 * @returns {OcrProgress | null}
 */
export function mapOcrProgress(message) {
  const ratio = Math.min(1, Math.max(0, Number(message?.progress) || 0))
  const stages = {
    'loading tesseract core': [0, 10],
    'initializing tesseract': [10, 12],
    'loading language traineddata': [12, 27],
    'initializing api': [27, 30],
  }
  if (message?.status === 'recognizing text')
    return { phase: 'RECOGNIZING', percent: Math.round(30 + ratio * 70) }
  const stage = stages[message?.status ?? '']
  if (!stage) return null
  return { phase: 'LOADING', percent: Math.round(stage[0] + ratio * (stage[1] - stage[0])) }
}

/**
 * 把 Tesseract 的 blocks 攤平成「一行一筆」，保留每行的信心分數（0–100）。
 * @param {any} page Tesseract 的 data
 * @returns {Array<{ text: string, confidence: number }>}
 */
export function flattenOcrLines(page) {
  const lines = []
  for (const block of page?.blocks || [])
    for (const paragraph of block?.paragraphs || [])
      for (const line of paragraph?.lines || []) {
        const text = String(line?.text || '').replace(/\s+$/, '')
        if (text.trim()) lines.push({ text, confidence: Math.round(Number(line.confidence) || 0) })
      }
  if (!lines.length && page?.text)
    for (const text of String(page.text).split('\n'))
      if (text.trim()) lines.push({ text: text.replace(/\s+$/, ''), confidence: 0 })
  return lines
}

function assetUrl(name) {
  // Worker 以 blob URL 啟動，路徑必須是絕對網址；Capacitor（https://localhost）也適用
  const base = new URL(import.meta.env.BASE_URL || '/', window.location.href)
  return new URL(`ocr/${name}`, base).href
}

/**
 * 建立一個可重複使用的 OCR 工作者。同一時間只跑一張圖。
 * cancel() 會直接終止 Worker（最可靠的停止方式），下次辨識時自動重建。
 */
export function createReceiptOcr() {
  /** @type {any} */
  let worker = null
  /** @type {Promise<any> | null} */
  let starting = null
  /** @type {((progress: OcrProgress) => void) | null} */
  let onProgress = null
  /** @type {((error: Error) => void) | null} */
  let rejectCurrent = null
  /** 每次取消就加一；建立到一半的 Worker 若已被取消就直接終止，不留在背景 */
  let generation = 0

  async function ensureWorker() {
    if (worker) return worker
    const startedIn = generation
    if (!starting) {
      starting = (async () => {
        const Tesseract = await import('tesseract.js')
        const created = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
          workerPath: assetUrl('worker.min.js'),
          corePath: assetUrl(''),
          langPath: assetUrl(''),
          cachePath: CACHE_PATH,
          logger: (message) => {
            const progress = mapOcrProgress(message)
            if (progress && onProgress) onProgress(progress)
          },
          errorHandler: () => {},
        })
        await created.setParameters({
          // PSM 6（單一文字區塊）：品名與右側金額留在同一行；PSM 4 會把金額欄拆成獨立的行
          tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
          preserve_interword_spaces: '1',
          // 照片沒有 DPI 資訊；不指定時 Tesseract 會自行估算，小圖常估錯而整張辨識不到字
          user_defined_dpi: '300',
        })
        return created
      })()
    }
    const pending = starting
    const created = await pending.finally(() => {
      if (starting === pending) starting = null
    })
    if (startedIn !== generation) {
      await created.terminate().catch(() => {})
      throw new OcrCancelledError()
    }
    worker = created
    return created
  }

  async function terminate() {
    const current = worker
    worker = null
    if (current) await current.terminate().catch(() => {})
  }

  return {
    /**
     * @param {Blob} image 已前處理的圖片
     * @param {{ onProgress?: (progress: OcrProgress) => void }} [options]
     * @returns {Promise<{ text: string, lines: Array<{ text: string, confidence: number }>, confidence: number }>}
     */
    recognize(image, options = {}) {
      if (rejectCurrent) return Promise.reject(new Error('OCR_BUSY'))
      onProgress = options.onProgress || null
      return new Promise((resolve, reject) => {
        rejectCurrent = reject
        ensureWorker()
          .then((ready) => {
            if (rejectCurrent !== reject) return null
            return ready.recognize(image, {}, { text: true, blocks: true })
          })
          .then((result) => {
            if (!result || rejectCurrent !== reject) return
            const page = result.data
            resolve({
              text: String(page.text || ''),
              lines: flattenOcrLines(page),
              confidence: Math.round(Number(page.confidence) || 0),
            })
          })
          .catch((error) => {
            if (rejectCurrent === reject)
              reject(error instanceof Error ? error : new Error(String(error)))
          })
          .finally(() => {
            if (rejectCurrent === reject) rejectCurrent = null
            onProgress = null
          })
      })
    },
    /** 取消進行中的辨識（含模型下載）；呼叫端會收到 OcrCancelledError */
    async cancel() {
      generation += 1
      starting = null // 建立到一半的 Worker 由原本的呼叫者自行終止，下次辨識另建新的
      const reject = rejectCurrent
      rejectCurrent = null
      onProgress = null
      if (reject) reject(new OcrCancelledError())
      await terminate()
    },
    /** 離開畫面時釋放 Worker 與 wasm 記憶體 */
    async dispose() {
      await this.cancel()
    },
  }
}
