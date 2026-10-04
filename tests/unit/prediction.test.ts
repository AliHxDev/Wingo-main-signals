import { describe, it, expect } from 'vitest';
import { predictionEngine } from '../../server/prediction/engine.js';
import type { WinGoIssue } from '../../server/wingo/client.js';

describe('Deterministic Prediction Engine', () => {
  const mockHistory: WinGoIssue[] = [
    { issueNumber: '202609210010', number: 8, size: 'BIG', colors: ['RED'] },
    { issueNumber: '202609210009', number: 7, size: 'BIG', colors: ['GREEN'] },
    { issueNumber: '202609210008', number: 6, size: 'BIG', colors: ['RED'] },
    { issueNumber: '202609210007', number: 2, size: 'SMALL', colors: ['RED'] },
    { issueNumber: '202609210006', number: 3, size: 'SMALL', colors: ['GREEN'] },
    { issueNumber: '202609210005', number: 9, size: 'BIG', colors: ['GREEN'] },
    { issueNumber: '202609210004', number: 1, size: 'SMALL', colors: ['GREEN'] },
    { issueNumber: '202609210003', number: 4, size: 'SMALL', colors: ['RED'] },
    { issueNumber: '202609210002', number: 5, size: 'BIG', colors: ['GREEN', 'VIOLET'] },
    { issueNumber: '202609210001', number: 0, size: 'SMALL', colors: ['RED', 'VIOLET'] },
  ];

  it('calculates the sequential next issue number correctly', () => {
    expect(predictionEngine.calculateNextIssue('202609210010')).toBe('202609210011');
    expect(predictionEngine.calculateNextIssue('202609210999')).toBe('202609211000');
  });

  it('generates deterministic predictions with confidence metrics', () => {
    const result1 = predictionEngine.predict(mockHistory, 60);
    const result2 = predictionEngine.predict(mockHistory, 60);

    // Must be completely deterministic
    expect(result1.prediction).toBe(result2.prediction);
    expect(result1.confidence).toBe(result2.confidence);
    expect(result1.targetIssueNumber).toBe('202609210011');
    expect(['BIG', 'SMALL']).toContain(result1.prediction);
    expect(['RED', 'GREEN']).toContain(result1.predictedColor);
    expect(result1.confidence).toBeGreaterThanOrEqual(50);
    expect(result1.confidence).toBeLessThanOrEqual(95);
  });

  it('correctly flags threshold filtering', () => {
    const lowThreshold = predictionEngine.predict(mockHistory, 50);
    expect(lowThreshold.meetsThreshold).toBe(true);

    const highThreshold = predictionEngine.predict(mockHistory, 99);
    expect(highThreshold.meetsThreshold).toBe(false);
  });

  it('evaluates all 10 independent indicators with measurable scores', () => {
    const result = predictionEngine.predict(mockHistory, 65);
    expect(result.sufficientData).toBe(true);

    // 1. 3-gram pattern analysis
    expect(result.factors.ngram).toBeDefined();
    expect(typeof result.factors.ngram.score).toBe('number');

    // 2. Recent result frequency
    expect(result.factors.frequency).toBeDefined();
    expect(typeof result.factors.frequency.score).toBe('number');

    // 3. Big/Small trend
    expect(result.factors.bsTrend).toBeDefined();
    expect(typeof result.factors.bsTrend.score).toBe('number');

    // 4. Red/Green trend
    expect(result.factors.rgTrend).toBeDefined();
    expect(typeof result.factors.rgTrend.score).toBe('number');

    // 5. Trend reversal detection
    expect(result.factors.trendReversal).toBeDefined();
    expect(typeof result.factors.trendReversal.score).toBe('number');

    // 6. Weighted recent results
    expect(result.factors.weightedRecent).toBeDefined();
    expect(typeof result.factors.weightedRecent.score).toBe('number');

    // 7. Moving average / WMA
    expect(result.factors.wma).toBeDefined();
    expect(typeof result.factors.wma.score).toBe('number');

    // 8. Recent streak analysis
    expect(result.factors.streakAnalysis).toBeDefined();
    expect(typeof result.factors.streakAnalysis.score).toBe('number');

    // 9. Short-term distribution
    expect(result.factors.shortTermDistribution).toBeDefined();
    expect(typeof result.factors.shortTermDistribution.score).toBe('number');

    // 10. Agreement between indicators
    expect(result.factors.indicatorAgreement).toBeDefined();
    expect(typeof result.factors.indicatorAgreement.agreementRatio).toBe('number');
    expect(result.factors.indicatorAgreement.totalIndicators).toBe(9);
  });

  it('enforces stability minimum history constraint without low-quality predictions', () => {
    const shortHistory = mockHistory.slice(0, 4); // Only 4 items
    const result = predictionEngine.predict(shortHistory, 65);
    expect(result.sufficientData).toBe(false);
    expect(result.meetsThreshold).toBe(false);
  });
});
