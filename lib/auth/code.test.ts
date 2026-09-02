import { describe, expect, it } from 'vitest';
import { CODE_LENGTH, generateSigninCode, isWellFormedCode, normaliseCode } from './code';

/**
 * The code is the whole security boundary once OTP is offered, so the
 * properties that matter are tested directly rather than inferred from a
 * successful sign-in.
 */
describe('generateSigninCode', () => {
  it('always returns exactly six digits', () => {
    for (let i = 0; i < 2000; i++) {
      const code = generateSigninCode();
      expect(code).toMatch(/^\d{6}$/);
      expect(code.length).toBe(CODE_LENGTH);
    }
  });

  it('zero-pads small values instead of emitting a short code', () => {
    // ~10% of the keyspace is below 100000. Unpadded they render as five
    // digits, and someone typing the leading zero they were shown is told
    // their correct code is wrong. Assert a padded one actually turns up.
    let sawLeadingZero = false;
    for (let i = 0; i < 5000 && !sawLeadingZero; i++) {
      if (generateSigninCode().startsWith('0')) sawLeadingZero = true;
    }
    expect(sawLeadingZero).toBe(true);
  });

  it('spans the whole keyspace rather than a narrow band', () => {
    // A crude smoke test that the generator is not, say, stuck in one decade.
    const firstDigits = new Set<string>();
    for (let i = 0; i < 3000; i++) firstDigits.add(generateSigninCode()[0]);
    expect(firstDigits.size).toBe(10);
  });

  it('does not repeat itself over a large sample', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateSigninCode());
    // Birthday collisions in 500 draws from 10^6 are possible but rare; a
    // generator returning a constant would collapse to 1.
    expect(seen.size).toBeGreaterThan(480);
  });
});

describe('normaliseCode', () => {
  it('leaves a clean code alone', () => {
    expect(normaliseCode('483920')).toBe('483920');
  });

  it('strips the spaces people paste in', () => {
    expect(normaliseCode('483 920')).toBe('483920');
    expect(normaliseCode(' 483920 ')).toBe('483920');
  });

  it('strips separators a mail client might introduce', () => {
    expect(normaliseCode('483-920')).toBe('483920');
  });

  it('truncates rather than accepting a longer string', () => {
    expect(normaliseCode('4839201234')).toBe('483920');
  });

  it('handles empty and non-numeric input without throwing', () => {
    expect(normaliseCode('')).toBe('');
    expect(normaliseCode('abcdef')).toBe('');
  });
});

describe('isWellFormedCode', () => {
  it('accepts exactly six digits, including leading zeros', () => {
    expect(isWellFormedCode('483920')).toBe(true);
    expect(isWellFormedCode('000000')).toBe(true);
    expect(isWellFormedCode('012345')).toBe(true);
  });

  it('rejects the wrong length', () => {
    expect(isWellFormedCode('48392')).toBe(false);
    expect(isWellFormedCode('4839201')).toBe(false);
    expect(isWellFormedCode('')).toBe(false);
  });

  it('rejects anything non-numeric', () => {
    expect(isWellFormedCode('48392a')).toBe(false);
    expect(isWellFormedCode('483 92')).toBe(false);
  });

  it('accepts everything the generator produces', () => {
    for (let i = 0; i < 1000; i++) {
      expect(isWellFormedCode(generateSigninCode())).toBe(true);
    }
  });
});
