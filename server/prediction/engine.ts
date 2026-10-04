import type { WinGoIssue } from '../wingo/client.js';
import type { WinGoSize, WinGoColor } from '../wingo/rules.js';

export interface IndicatorMetric {
  name: string;
  score: number; // -1.0 (strongly SMALL) to +1.0 (strongly BIG)
  weight: number;
  explanation: string;
}

export interface PredictionFactors {
  ngram: { pattern: string; bigNext: number; smallNext: number; bias: number; score: number };
  frequency: { totalBig: number; totalSmall: number; bias: number; score: number };
  bsTrend: { score: number; bias: number; recent4Big: number; prior4Big: number };
  rgTrend: { score: number; bias: number; redCount: number; greenCount: number };
  trendReversal: { currentStreak: number; streakType: WinGoSize; bias: number; score: number };
  weightedRecent: { score: number; bias: number; weightedRatio: number };
  wma: { wmaValue: number; bias: number; score: number };
  streakAnalysis: { streakLength: number; streakType: WinGoSize; bias: number; score: number };
  shortTermDistribution: { lowBucket: number; midBucket: number; highBucket: number; score: number; bias: number };
  indicatorAgreement: { agreeingIndicators: number; totalIndicators: number; agreementRatio: number; score: number };
  color: { predictedColor: 'RED' | 'GREEN'; colorConfidence: number };
  // Backwards compatibility aliases
  recency: { last5BigRatio: number; bias: number };
}

export interface PredictionResult {
  targetIssueNumber: string;
  prediction: WinGoSize;
  predictedColor: 'RED' | 'GREEN';
  confidence: number; // 0 - 100
  factors: PredictionFactors;
  meetsThreshold: boolean;
  threshold: number;
  disclaimer: string;
  sufficientData: boolean;
}

export class PredictionEngine {
  private readonly defaultThreshold: number;
  public static readonly MIN_VALID_HISTORY = 10;

  constructor(defaultThreshold = 65) {
    this.defaultThreshold = defaultThreshold;
  }

  /**
   * Cleans and validates incoming WinGo history to prevent unstable predictions
   * from corrupt, NaN, or malformed data.
   */
  public filterValidHistory(raw: WinGoIssue[]): WinGoIssue[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((item) => {
      if (!item || typeof item !== 'object') return false;
      if (typeof item.issueNumber !== 'string' || !item.issueNumber.trim()) return false;
      const num = Number(item.number);
      if (isNaN(num) || num < 0 || num > 9) return false;
      if (item.size !== 'BIG' && item.size !== 'SMALL') return false;
      if (!Array.isArray(item.colors) || item.colors.length === 0) return false;
      return true;
    });
  }

  /**
   * Deterministically predicts the next issue result given past history (newest first).
   * Adheres strictly to the 10-indicator deterministic architecture.
   */
  predict(historyNewestFirst: WinGoIssue[], threshold = this.defaultThreshold): PredictionResult {
    const disclaimer = 'Predictions are deterministic statistical probabilities. Play responsibly.';
    const validHistory = this.filterValidHistory(historyNewestFirst);

    // Requirement 16: Minimum history stability requirement
    if (validHistory.length < PredictionEngine.MIN_VALID_HISTORY) {
      const latestIssue = validHistory[0]?.issueNumber || historyNewestFirst[0]?.issueNumber || '0';
      const targetIssue = this.calculateNextIssue(latestIssue);
      return {
        targetIssueNumber: targetIssue,
        prediction: 'BIG',
        predictedColor: 'GREEN',
        confidence: 50,
        factors: {
          ngram: { pattern: 'none', bigNext: 0, smallNext: 0, bias: 0, score: 0 },
          frequency: { totalBig: 0, totalSmall: 0, bias: 0, score: 0 },
          bsTrend: { score: 0, bias: 0, recent4Big: 0, prior4Big: 0 },
          rgTrend: { score: 0, bias: 0, redCount: 0, greenCount: 0 },
          trendReversal: { currentStreak: 0, streakType: 'BIG', bias: 0, score: 0 },
          weightedRecent: { score: 0, bias: 0, weightedRatio: 0.5 },
          wma: { wmaValue: 4.5, bias: 0, score: 0 },
          streakAnalysis: { streakLength: 0, streakType: 'BIG', bias: 0, score: 0 },
          shortTermDistribution: { lowBucket: 0, midBucket: 0, highBucket: 0, score: 0, bias: 0 },
          indicatorAgreement: { agreeingIndicators: 0, totalIndicators: 9, agreementRatio: 0, score: 0 },
          color: { predictedColor: 'GREEN', colorConfidence: 50 },
          recency: { last5BigRatio: 0.5, bias: 0 },
        },
        meetsThreshold: false,
        threshold,
        disclaimer,
        sufficientData: false,
      };
    }

    const latest = validHistory[0];
    const targetIssueNumber = this.calculateNextIssue(latest.issueNumber);

    // Convert to chronological order (oldest to newest)
    const chrono = [...validHistory].reverse();
    const n = chrono.length;

    // ==========================================
    // 1. 3-GRAM PATTERN ANALYSIS
    // ==========================================
    const last2Pattern = `${chrono[n - 2].size}-${chrono[n - 1].size}`;
    let ngramBigNext = 0;
    let ngramSmallNext = 0;
    for (let i = 0; i < n - 2; i++) {
      const p = `${chrono[i].size}-${chrono[i + 1].size}`;
      if (p === last2Pattern) {
        if (chrono[i + 2].size === 'BIG') ngramBigNext++;
        else ngramSmallNext++;
      }
    }
    const totalNgramMatches = ngramBigNext + ngramSmallNext;
    let ngramScore = 0; // -1 to +1
    if (totalNgramMatches > 0) {
      ngramScore = (ngramBigNext - ngramSmallNext) / totalNgramMatches;
    }

    // ==========================================
    // 2. RECENT RESULT FREQUENCY
    // ==========================================
    const freqWindow = validHistory.slice(0, Math.min(25, validHistory.length));
    const totalBig = freqWindow.filter((x) => x.size === 'BIG').length;
    const totalSmall = freqWindow.length - totalBig;
    // Mean reversion pressure: if BIG has dominated, pressure is towards SMALL (-score)
    const freqDiff = (totalBig - totalSmall) / freqWindow.length;
    const freqScore = -freqDiff;

    // ==========================================
    // 3. BIG / SMALL TREND (MOMENTUM)
    // ==========================================
    const recent4 = validHistory.slice(0, 4);
    const prior4 = validHistory.slice(4, 8);
    const recent4Big = recent4.filter((x) => x.size === 'BIG').length;
    const prior4Big = prior4.filter((x) => x.size === 'BIG').length;
    const bsTrendScore = (recent4Big - prior4Big) / 4; // -1 to +1

    // ==========================================
    // 4. RED / GREEN TREND
    // ==========================================
    const colorWindow = validHistory.slice(0, 10);
    const redCount = colorWindow.filter((x) => x.colors.includes('RED')).length;
    const greenCount = colorWindow.filter((x) => x.colors.includes('GREEN')).length;
    // In WinGo: 1,3,7,9 are GREEN, 2,4,6,8 are RED.
    // GREEN numbers have a 7,9 bias (BIG), RED numbers have a 2,4 bias (SMALL).
    const rgTrendScore = (greenCount - redCount) / colorWindow.length; // -1 to +1

    // ==========================================
    // 5. TREND REVERSAL DETECTION
    // ==========================================
    let currentStreak = 1;
    const streakType = latest.size;
    for (let i = 1; i < validHistory.length; i++) {
      if (validHistory[i].size === streakType) {
        currentStreak++;
      } else {
        break;
      }
    }
    let trendReversalScore = 0;
    if (currentStreak >= 3) {
      const revStrength = Math.min((currentStreak - 2) * 0.35, 1.0);
      trendReversalScore = streakType === 'BIG' ? -revStrength : revStrength;
    } else if (currentStreak === 1) {
      // Single outcome continuation tendency
      trendReversalScore = streakType === 'BIG' ? 0.2 : -0.2;
    }

    // ==========================================
    // 6. WEIGHTED RECENT RESULTS (DECAY WEIGHTING)
    // ==========================================
    const decayWindow = Math.min(10, validHistory.length);
    let weightedSizeSum = 0;
    let decayWeightTotal = 0;
    for (let i = 0; i < decayWindow; i++) {
      const weight = decayWindow - i; // Newest has highest weight
      const val = validHistory[i].size === 'BIG' ? 1 : -1;
      weightedSizeSum += val * weight;
      decayWeightTotal += weight;
    }
    const weightedRecentScore = weightedSizeSum / decayWeightTotal; // -1 to +1

    // ==========================================
    // 7. WEIGHTED MOVING AVERAGE (WMA) OF NUMBERS
    // ==========================================
    const wmaWindow = Math.min(10, chrono.length);
    let numWeightedSum = 0;
    let numWeightTotal = 0;
    for (let i = 0; i < wmaWindow; i++) {
      const idx = n - wmaWindow + i;
      const weight = i + 1;
      numWeightedSum += chrono[idx].number * weight;
      numWeightTotal += weight;
    }
    const wmaValue = numWeightedSum / numWeightTotal; // Range: 0 to 9, center 4.5
    const wmaScore = Math.max(-1, Math.min(1, (wmaValue - 4.5) / 3.5));

    // ==========================================
    // 8. RECENT STREAK ANALYSIS (STREAK VELOCITY)
    // ==========================================
    // Streak intensity metric based on acceleration
    let streakScore = 0;
    if (currentStreak >= 4) {
      // Deep streak exhaustion: strong push opposite
      streakScore = streakType === 'BIG' ? -0.85 : 0.85;
    } else if (currentStreak === 2 || currentStreak === 3) {
      // Moderate streak momentum: continuation push
      streakScore = streakType === 'BIG' ? 0.4 : -0.4;
    } else {
      streakScore = streakType === 'BIG' ? -0.1 : 0.1;
    }

    // ==========================================
    // 9. SHORT-TERM VALUE DISTRIBUTION (BUCKETS)
    // ==========================================
    const distWindow = validHistory.slice(0, Math.min(15, validHistory.length));
    let lowBucket = 0; // 0, 1, 2
    let midBucket = 0; // 3, 4, 5, 6
    let highBucket = 0; // 7, 8, 9
    for (const item of distWindow) {
      if (item.number <= 2) lowBucket++;
      else if (item.number >= 7) highBucket++;
      else midBucket++;
    }
    // If high bucket is underrepresented, mean pull is upward (+ score for BIG)
    const distScore = (lowBucket - highBucket) / distWindow.length; // -1 to +1

    // ==========================================
    // 10. AGREEMENT BETWEEN INDICATORS
    // ==========================================
    const primaryScores = [
      { name: 'ngram', score: ngramScore, weight: 0.16 },
      { name: 'frequency', score: freqScore, weight: 0.11 },
      { name: 'bsTrend', score: bsTrendScore, weight: 0.11 },
      { name: 'rgTrend', score: rgTrendScore, weight: 0.08 },
      { name: 'trendReversal', score: trendReversalScore, weight: 0.15 },
      { name: 'weightedRecent', score: weightedRecentScore, weight: 0.13 },
      { name: 'wma', score: wmaScore, weight: 0.10 },
      { name: 'streak', score: streakScore, weight: 0.08 },
      { name: 'distribution', score: distScore, weight: 0.08 },
    ];

    // Calculate preliminary weighted directional score
    let compositeScore = 0;
    for (const ind of primaryScores) {
      compositeScore += ind.score * ind.weight;
    }

    const proposedPrediction: WinGoSize = compositeScore >= 0 ? 'BIG' : 'SMALL';

    // Count how many primary indicators agree with proposed prediction
    let agreeingCount = 0;
    for (const ind of primaryScores) {
      if (proposedPrediction === 'BIG' && ind.score > 0) agreeingCount++;
      else if (proposedPrediction === 'SMALL' && ind.score < 0) agreeingCount++;
    }
    const agreementRatio = agreeingCount / primaryScores.length;
    // Agreement metric contributes up to 0.10 boost in alignment
    const agreementScore = (agreementRatio - 0.5) * 2; // -1 to +1

    // Final composite score incorporates agreement
    const finalDirectionScore = compositeScore * 0.85 + agreementScore * 0.15;
    const finalPrediction: WinGoSize = finalDirectionScore >= 0 ? 'BIG' : 'SMALL';

    // Calculate deterministic confidence (Scale 50 - 95%)
    // Base 66% + magnitude of agreement & composite score
    const magnitudeBonus = Math.min(22, Math.abs(finalDirectionScore) * 26);
    const agreementBonus = Math.min(8, agreementRatio * 8);
    const rawConfidence = Math.round(66 + magnitudeBonus + agreementBonus);
    const confidence = Math.max(50, Math.min(95, rawConfidence));

    // ==========================================
    // COLOR PREDICTION
    // ==========================================
    let predictedColor: 'RED' | 'GREEN';
    if (finalPrediction === 'BIG') {
      // In WinGo: 6,8 are RED, 7,9 are GREEN, 5 is GREEN+VIOLET
      predictedColor = redCount > greenCount ? 'GREEN' : 'RED';
    } else {
      // In WinGo: 2,4 are RED, 1,3 are GREEN, 0 is RED+VIOLET
      predictedColor = greenCount > redCount ? 'RED' : 'GREEN';
    }
    const colorConfidence = Math.round(50 + (Math.abs(redCount - greenCount) / colorWindow.length) * 35);

    const meetsThreshold = confidence >= threshold;

    return {
      targetIssueNumber,
      prediction: finalPrediction,
      predictedColor,
      confidence,
      factors: {
        ngram: {
          pattern: last2Pattern,
          bigNext: ngramBigNext,
          smallNext: ngramSmallNext,
          bias: Math.round(ngramScore * 100) / 100,
          score: Math.round(ngramScore * 100) / 100,
        },
        frequency: {
          totalBig,
          totalSmall,
          bias: Math.round(freqScore * 100) / 100,
          score: Math.round(freqScore * 100) / 100,
        },
        bsTrend: {
          score: Math.round(bsTrendScore * 100) / 100,
          bias: Math.round(bsTrendScore * 100) / 100,
          recent4Big,
          prior4Big,
        },
        rgTrend: {
          score: Math.round(rgTrendScore * 100) / 100,
          bias: Math.round(rgTrendScore * 100) / 100,
          redCount,
          greenCount,
        },
        trendReversal: {
          currentStreak,
          streakType,
          bias: Math.round(trendReversalScore * 100) / 100,
          score: Math.round(trendReversalScore * 100) / 100,
        },
        weightedRecent: {
          score: Math.round(weightedRecentScore * 100) / 100,
          bias: Math.round(weightedRecentScore * 100) / 100,
          weightedRatio: Math.round((weightedSizeSum / decayWeightTotal) * 100) / 100,
        },
        wma: {
          wmaValue: Math.round(wmaValue * 100) / 100,
          bias: Math.round(wmaScore * 100) / 100,
          score: Math.round(wmaScore * 100) / 100,
        },
        streakAnalysis: {
          streakLength: currentStreak,
          streakType,
          bias: Math.round(streakScore * 100) / 100,
          score: Math.round(streakScore * 100) / 100,
        },
        shortTermDistribution: {
          lowBucket,
          midBucket,
          highBucket,
          score: Math.round(distScore * 100) / 100,
          bias: Math.round(distScore * 100) / 100,
        },
        indicatorAgreement: {
          agreeingIndicators: agreeingCount,
          totalIndicators: primaryScores.length,
          agreementRatio: Math.round(agreementRatio * 100) / 100,
          score: Math.round(agreementScore * 100) / 100,
        },
        color: {
          predictedColor,
          colorConfidence,
        },
        recency: {
          last5BigRatio: Math.round((recent4Big / 4) * 100) / 100,
          bias: Math.round(bsTrendScore * 100) / 100,
        },
      },
      meetsThreshold,
      threshold,
      disclaimer,
      sufficientData: true,
    };
  }

  /**
   * Helper to derive the sequential next issue number
   * (e.g. 20260922100010135 -> 20260922100010136)
   */
  calculateNextIssue(currentIssueNumber: string): string {
    try {
      const trimmed = currentIssueNumber.trim();
      const nextBig = BigInt(trimmed) + 1n;
      return nextBig.toString();
    } catch {
      return (Date.now() + 60000).toString();
    }
  }
}

export const predictionEngine = new PredictionEngine();
