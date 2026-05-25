import { describe, it, expect } from 'vitest';
import { normalizeTags } from './normalize';

describe('normalizeTags', () => {
  it('returns [] for undefined or empty array', () => {
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags([])).toEqual([]);
  });

  it('trims whitespace and lowercases each tag', () => {
    expect(normalizeTags(['  Work ', 'PREFERENCES'])).toEqual([
      'work',
      'preferences',
    ]);
  });

  it('drops empty / whitespace-only / oversize tags', () => {
    const longTag = 'x'.repeat(33);
    expect(normalizeTags(['', '   ', longTag, 'ok'])).toEqual(['ok']);
  });

  it('dedupes while preserving first-seen order', () => {
    expect(normalizeTags(['Work', 'work', 'food', 'WORK', 'food'])).toEqual([
      'work',
      'food',
    ]);
  });

  it('caps the result at 5 tags', () => {
    expect(normalizeTags(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('accepts a 32-char tag (boundary, inclusive)', () => {
    const t = 'x'.repeat(32);
    expect(normalizeTags([t])).toEqual([t]);
  });
});
