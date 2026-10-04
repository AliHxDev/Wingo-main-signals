import { describe, it, expect } from 'vitest';
import {
  formatSignalMessage,
  formatWinMessage,
  formatLossMessage,
  formatTestMessage,
} from '../../server/utils/formatters.js';

describe('Message Formatters', () => {
  it('formats WinGo Signal message matching requirements', () => {
    const signal = formatSignalMessage({
      issueNumber: '202609210100',
      prediction: 'BIG',
      color: 'GREEN',
      confidence: 82,
    });

    expect(signal).toContain('WinGo 1M Signal');
    expect(signal).toContain('202609210100');
    expect(signal).toContain('Prediction: BIG');
    expect(signal).toContain('Color: GREEN');
    expect(signal).toContain('82%');
    expect(signal).toContain('Play responsibly');
  });

  it('formats WIN message matching requirements', () => {
    const win = formatWinMessage({
      issueNumber: '202609210100',
      actualNumber: 7,
      actualSize: 'BIG',
      actualColor: 'GREEN',
      predictedSize: 'BIG',
      predictedColor: 'GREEN',
    });

    expect(win).toContain('WIN!');
    expect(win).toContain('202609210100');
    expect(win).toContain('7');
    expect(win).toContain('BIG');
    expect(win).toContain('GREEN');
  });

  it('formats LOSS message matching requirements', () => {
    const loss = formatLossMessage({
      issueNumber: '202609210100',
      actualNumber: 3,
      actualSize: 'SMALL',
      actualColor: 'GREEN',
      predictedSize: 'BIG',
      predictedColor: 'RED',
    });

    expect(loss).toContain('LOSS');
    expect(loss).toContain('202609210100');
    expect(loss).toContain('3');
    expect(loss).toContain('SMALL');
  });

  it('formats Test message matching requirements', () => {
    const test = formatTestMessage('120363411395110604@newsletter');
    expect(test.toUpperCase()).toContain('TEST MESSAGE');
    expect(test).toContain('202609230000');
  });
});
