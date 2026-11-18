import { describe, expect, it } from 'vitest'
import { toQuery } from './adminRepository.js'

describe('admin query string', () => {
  it('drops empty filters and encodes values', () => {
    expect(toQuery({ q: 'a b@x.com', status: '', page: 0, userSeq: null })).toBe(
      '?q=a+b%40x.com&page=0',
    )
    expect(toQuery({})).toBe('')
  })
})
