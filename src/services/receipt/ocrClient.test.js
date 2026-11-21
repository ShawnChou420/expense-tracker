import { describe, expect, it } from 'vitest'
import { flattenOcrLines, mapOcrProgress } from './ocrClient.js'

describe('mapOcrProgress', () => {
  it('載入階段佔 0–30%，辨識佔 30–100%', () => {
    expect(mapOcrProgress({ status: 'loading tesseract core', progress: 0 })).toEqual({
      phase: 'LOADING',
      percent: 0,
    })
    expect(mapOcrProgress({ status: 'loading language traineddata', progress: 1 })).toEqual({
      phase: 'LOADING',
      percent: 27,
    })
    expect(mapOcrProgress({ status: 'initializing api', progress: 1 })).toEqual({
      phase: 'LOADING',
      percent: 30,
    })
    expect(mapOcrProgress({ status: 'recognizing text', progress: 0.5 })).toEqual({
      phase: 'RECOGNIZING',
      percent: 65,
    })
    expect(mapOcrProgress({ status: 'recognizing text', progress: 1 })).toEqual({
      phase: 'RECOGNIZING',
      percent: 100,
    })
  })

  it('進度超出範圍時夾住；未知階段忽略', () => {
    expect(mapOcrProgress({ status: 'recognizing text', progress: 3 })?.percent).toBe(100)
    expect(mapOcrProgress({ status: 'recognizing text', progress: -1 })?.percent).toBe(30)
    expect(mapOcrProgress({ status: 'something else', progress: 0.5 })).toBeNull()
    expect(mapOcrProgress(undefined)).toBeNull()
  })
})

describe('flattenOcrLines', () => {
  it('依 block → paragraph → line 攤平並保留信心分數', () => {
    const page = {
      text: 'ignored',
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                { text: 'WOOLWORTHS\n', confidence: 91.6 },
                { text: '   ', confidence: 10 },
              ],
            },
            { lines: [{ text: 'MILK 2L   3.10\n', confidence: 58.2 }] },
          ],
        },
      ],
    }
    expect(flattenOcrLines(page)).toEqual([
      { text: 'WOOLWORTHS', confidence: 92 },
      { text: 'MILK 2L   3.10', confidence: 58 },
    ])
  })

  it('沒有 blocks 時退回純文字，信心為 0', () => {
    expect(flattenOcrLines({ text: 'A\n\nB  \n', blocks: null })).toEqual([
      { text: 'A', confidence: 0 },
      { text: 'B', confidence: 0 },
    ])
    expect(flattenOcrLines(null)).toEqual([])
  })
})
