import { describe, it, expect } from 'vitest'
import { levenshtein } from '../../../src/matching/levenshtein.js'

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0)
    expect(levenshtein('', '')).toBe(0)
  })

  it('returns 1 for a single character difference', () => {
    expect(levenshtein('cat', 'bat')).toBe(1) // substitution
    expect(levenshtein('cat', 'cats')).toBe(1) // insertion
    expect(levenshtein('cats', 'cat')).toBe(1) // deletion
  })

  it('returns length of non-empty string when other is empty', () => {
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('hello', '')).toBe(5)
  })

  it('computes expected edit distance for completely different strings', () => {
    expect(levenshtein('abc', 'xyz')).toBe(3)
    expect(levenshtein('kitten', 'sitting')).toBe(3)
  })

  it('is case-sensitive ("ABC" vs "abc" => 3)', () => {
    expect(levenshtein('ABC', 'abc')).toBe(3)
    expect(levenshtein('Hello', 'hello')).toBe(1)
  })
})
