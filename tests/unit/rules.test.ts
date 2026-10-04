import { describe, it, expect } from 'vitest';
import {
  classifySize,
  classifyColor,
  classifyWinGoNumber,
  isSpecialVioletNumber,
  isValidWinGoNumber,
} from '../../server/wingo/rules.js';

describe('WinGo Rules & Classification', () => {
  it('correctly validates WinGo numbers 0-9', () => {
    for (let i = 0; i <= 9; i++) {
      expect(isValidWinGoNumber(i)).toBe(true);
    }
    expect(isValidWinGoNumber(-1)).toBe(false);
    expect(isValidWinGoNumber(10)).toBe(false);
    expect(isValidWinGoNumber(NaN)).toBe(false);
  });

  it('correctly classifies SMALL (0-4) and BIG (5-9)', () => {
    [0, 1, 2, 3, 4].forEach((num) => {
      expect(classifySize(num)).toBe('SMALL');
    });
    [5, 6, 7, 8, 9].forEach((num) => {
      expect(classifySize(num)).toBe('BIG');
    });
  });

  it('correctly classifies standard colors', () => {
    // Green: 1, 3, 7, 9
    [1, 3, 7, 9].forEach((num) => {
      expect(classifyColor(num)).toEqual(['GREEN']);
    });

    // Red: 2, 4, 6, 8
    [2, 4, 6, 8].forEach((num) => {
      expect(classifyColor(num)).toEqual(['RED']);
    });
  });

  it('correctly classifies dual-color special numbers (0 and 5)', () => {
    expect(isSpecialVioletNumber(0)).toBe(true);
    expect(isSpecialVioletNumber(5)).toBe(true);
    expect(isSpecialVioletNumber(1)).toBe(false);

    // 0 is RED + VIOLET
    expect(classifyColor(0)).toEqual(['RED', 'VIOLET']);

    // 5 is GREEN + VIOLET
    expect(classifyColor(5)).toEqual(['GREEN', 'VIOLET']);
  });

  it('classifies complete WinGo number outcomes', () => {
    const outcome0 = classifyWinGoNumber(0);
    expect(outcome0.number).toBe(0);
    expect(outcome0.size).toBe('SMALL');
    expect(outcome0.colors).toEqual(['RED', 'VIOLET']);

    const outcome7 = classifyWinGoNumber(7);
    expect(outcome7.number).toBe(7);
    expect(outcome7.size).toBe('BIG');
    expect(outcome7.colors).toEqual(['GREEN']);
  });
});
