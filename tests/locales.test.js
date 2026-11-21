// 翻譯完整性：四份語系的 key 必須一致、{param} 插值不可缺漏，程式用到的 key 必須存在。
// 新增功能時請四份 JSON 同步加 key，這個測試會在 npm test 中擋下遺漏。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from '../src/domain/locale.js'

const root = join(import.meta.dirname, '..')
const load = (locale) =>
  JSON.parse(readFileSync(join(root, 'src/locales', `${locale}.json`), 'utf8'))

/** @returns {Record<string, unknown>} */
function flatten(object, prefix = '') {
  return Object.entries(object).reduce((all, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value))
      Object.assign(all, flatten(value, path))
    else all[path] = value
    return all
  }, {})
}

const params = (message) =>
  [...String(message).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

const reference = flatten(load('zh-TW'))
const referenceKeys = Object.keys(reference).sort()

describe.each(SUPPORTED_LOCALES)('語系 %s', (locale) => {
  const messages = flatten(load(locale))

  it('key 與繁體中文完全一致', () => {
    const keys = Object.keys(messages)
    expect(
      referenceKeys.filter((key) => !(key in messages)),
      '缺少的 key',
    ).toEqual([])
    expect(
      keys.filter((key) => !(key in reference)),
      '多出的 key',
    ).toEqual([])
  })

  it('每個值都是非空字串', () => {
    const invalid = Object.entries(messages)
      .filter(([, value]) => typeof value !== 'string' || !value.trim())
      .map(([key]) => key)
    expect(invalid).toEqual([])
  })

  it('{param} 插值參數與繁體中文相同', () => {
    const mismatched = referenceKeys
      .filter((key) => key in messages)
      .filter((key) => params(messages[key]).join() !== params(reference[key]).join())
      .map((key) => `${key}: ${params(reference[key])} ≠ ${params(messages[key])}`)
    expect(mismatched).toEqual([])
  })

  it('不含 vue-i18n 保留字元（@ | $），避免被解析成連結或複數', () => {
    const unsafe = Object.entries(messages)
      .filter(([, value]) => /[@|$]/.test(String(value)))
      .map(([key]) => key)
    expect(unsafe).toEqual([])
  })
})

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(vue|js)$/.test(name) && !/\.test\.js$/.test(name) ? [path] : []
  })
}

it('程式碼中 t()／$t() 使用的 key 都存在於語系檔', () => {
  const missing = new Set()
  for (const file of sourceFiles(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/(?<![\w.])\$?t\(\s*['"]([\w-]+(?:\.[\w-]+)+)['"]/g)) {
      if (!(match[1] in reference)) missing.add(`${match[1]} (${file.replace(root, '')})`)
    }
  }
  expect([...missing]).toEqual([])
})
