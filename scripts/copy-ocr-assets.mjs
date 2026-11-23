// 把收據 OCR 需要的 Tesseract 檔案從 node_modules 複製到 public/ocr/（自架，不連第三方 CDN）。
// 由 npm 的 predev / prebuild 自動執行；public/ocr/ 已列在 .gitignore，不 commit 大檔。
// 只複製 LSTM 版的 core（另有 SIMD、relaxed SIMD 兩種，執行時依裝置能力挑一個下載）與
// 4.0.0_best_int 英文模型。
import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`))
const target = join(root, 'public', 'ocr')

const files = [
  [join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), 'worker.min.js'],
  ...['', '-simd', '-relaxedsimd'].map((variant) => {
    const name = `tesseract-core${variant}-lstm.wasm.js`
    return [join(pkgDir('tesseract.js-core'), name), name]
  }),
  [
    join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'),
    'eng.traineddata.gz',
  ],
]

mkdirSync(target, { recursive: true })
let bytes = 0
for (const [from, name] of files) {
  copyFileSync(from, join(target, name))
  bytes += statSync(from).size
}
console.log(`[ocr] copied ${files.length} files to public/ocr (${(bytes / 1e6).toFixed(1)} MB)`)
