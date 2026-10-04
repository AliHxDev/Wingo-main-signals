import type { WinGoSize } from '../wingo/rules.js';
import { templateService, DEFAULT_TEMPLATES } from '../services/templates.js';

export function formatTime(date = new Date()): string {
  return date.toTimeString().split(' ')[0]; // HH:MM:SS
}

export function formatDate(date = new Date()): string {
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Synchronous fallback formatters using default or cached template strings.
 */
export function formatSignalMessage(params: {
  issueNumber: string;
  prediction: WinGoSize;
  color: 'GREEN' | 'RED';
  confidence: number;
  time?: string;
}): string {
  const time = params.time || formatTime();
  const date = formatDate();
  return templateService.renderString(DEFAULT_TEMPLATES.SIGNAL.template, {
    issueNumber: params.issueNumber,
    prediction: params.prediction,
    size: params.prediction,
    predictionSize: params.prediction,
    color: params.color,
    predictionColor: params.color,
    confidence: params.confidence,
    time,
    date,
  });
}

export function formatWinMessage(params: {
  issueNumber: string;
  actualNumber: number;
  actualSize: string;
  actualColor: string;
  predictedSize: string;
  predictedColor: string;
  confidence?: number;
}): string {
  return templateService.renderString(DEFAULT_TEMPLATES.WIN.template, {
    issueNumber: params.issueNumber,
    resultNumber: params.actualNumber,
    resultSize: params.actualSize,
    resultColor: params.actualColor,
    prediction: params.predictedSize,
    predictionSize: params.predictedSize,
    predictionColor: params.predictedColor,
    size: params.actualSize,
    color: params.actualColor,
    confidence: params.confidence ?? 75,
    status: 'WIN',
    time: formatTime(),
    date: formatDate(),
  });
}

export function formatLossMessage(params: {
  issueNumber: string;
  actualNumber: number;
  actualSize: string;
  actualColor: string;
  predictedSize: string;
  predictedColor: string;
  confidence?: number;
}): string {
  return templateService.renderString(DEFAULT_TEMPLATES.LOSS.template, {
    issueNumber: params.issueNumber,
    resultNumber: params.actualNumber,
    resultSize: params.actualSize,
    resultColor: params.actualColor,
    prediction: params.predictedSize,
    predictionSize: params.predictedSize,
    predictionColor: params.predictedColor,
    size: params.actualSize,
    color: params.actualColor,
    confidence: params.confidence ?? 75,
    status: 'LOSS',
    time: formatTime(),
    date: formatDate(),
  });
}

export function formatTestMessage(destination: string): string {
  return templateService.renderString(DEFAULT_TEMPLATES.TEST.template, {
    issueNumber: '202609230000',
    prediction: 'BIG',
    predictionSize: 'BIG',
    size: 'BIG',
    color: 'GREEN',
    predictionColor: 'GREEN',
    confidence: 85,
    time: formatTime(),
    date: formatDate(),
    destination,
  });
}

/**
 * Async dynamic renderers that load the custom templates configured by admin in PostgreSQL.
 */
export async function renderDynamicSignal(params: {
  issueNumber: string;
  prediction: WinGoSize;
  color: 'GREEN' | 'RED';
  confidence: number;
  time?: string;
}): Promise<string> {
  const time = params.time || formatTime();
  const date = formatDate();
  return templateService.render('SIGNAL', {
    issueNumber: params.issueNumber,
    prediction: params.prediction,
    predictionSize: params.prediction,
    size: params.prediction,
    color: params.color,
    predictionColor: params.color,
    confidence: params.confidence,
    time,
    date,
  });
}

export async function renderDynamicWin(params: {
  issueNumber: string;
  actualNumber: number;
  actualSize: string;
  actualColor: string;
  predictedSize: string;
  predictedColor: string;
  confidence?: number;
}): Promise<string> {
  return templateService.render('WIN', {
    issueNumber: params.issueNumber,
    resultNumber: params.actualNumber,
    resultSize: params.actualSize,
    resultColor: params.actualColor,
    prediction: params.predictedSize,
    predictionSize: params.predictedSize,
    predictionColor: params.predictedColor,
    size: params.actualSize,
    color: params.actualColor,
    confidence: params.confidence ?? 75,
    status: 'WIN',
    time: formatTime(),
    date: formatDate(),
  });
}

export async function renderDynamicLoss(params: {
  issueNumber: string;
  actualNumber: number;
  actualSize: string;
  actualColor: string;
  predictedSize: string;
  predictedColor: string;
  confidence?: number;
}): Promise<string> {
  return templateService.render('LOSS', {
    issueNumber: params.issueNumber,
    resultNumber: params.actualNumber,
    resultSize: params.actualSize,
    resultColor: params.actualColor,
    prediction: params.predictedSize,
    predictionSize: params.predictedSize,
    predictionColor: params.predictedColor,
    size: params.actualSize,
    color: params.actualColor,
    confidence: params.confidence ?? 75,
    status: 'LOSS',
    time: formatTime(),
    date: formatDate(),
  });
}

export async function renderDynamicTest(destination: string): Promise<string> {
  return templateService.render('TEST', {
    issueNumber: '202609230000',
    prediction: 'BIG',
    predictionSize: 'BIG',
    size: 'BIG',
    color: 'GREEN',
    predictionColor: 'GREEN',
    confidence: 85,
    time: formatTime(),
    date: formatDate(),
    destination,
  });
}

export async function renderDynamicTargetComplete(params: {
  targetWins: number;
  wins: number;
  losses: number;
  totalSignals: number;
  winRate: number | string;
  sessionName: string;
  startTime: string;
  endTime: string;
  signals?: Array<{ status: string; issue_number?: string }>;
}): Promise<string> {
  let wins = params.wins;
  let losses = params.losses;
  let totalSignals = params.totalSignals;
  let winRate = params.winRate;

  // If signal records are provided, calculate authoritative stats directly from records
  if (params.signals && params.signals.length > 0) {
    const uniqueMap = new Map<string, any>();
    for (const s of params.signals) {
      if (s && s.issue_number && !uniqueMap.has(s.issue_number)) {
        uniqueMap.set(s.issue_number, s);
      }
    }
    const settled = Array.from(uniqueMap.values()).filter((s) => s.status === 'WIN' || s.status === 'LOSS');
    wins = settled.filter((s) => s.status === 'WIN').length;
    losses = settled.filter((s) => s.status === 'LOSS').length;
    totalSignals = wins + losses; // Guaranteed: TOTAL = WIN + LOSS
    const rawRate = totalSignals > 0 ? (wins / totalSignals) * 100 : 0;
    winRate = rawRate % 1 === 0 ? rawRate.toFixed(0) : (Math.round(rawRate * 100) / 100).toFixed(2);
  } else {
    // Invariant: TOTAL = WIN + LOSS
    totalSignals = wins + losses;
    if (winRate === undefined || winRate === null || winRate === '' || winRate === 0 || winRate === '0') {
      const rawRate = totalSignals > 0 ? (wins / totalSignals) * 100 : 0;
      winRate = rawRate % 1 === 0 ? rawRate.toFixed(0) : (Math.round(rawRate * 100) / 100).toFixed(2);
    }
  }

  const winRateStr = String(winRate);

  return templateService.render('TARGET_COMPLETE', {
    targetWins: params.targetWins,
    target: params.targetWins,
    wins,
    losses,
    totalSignals,
    winRate: winRateStr,
    actual_total: totalSignals,
    actual_win_count: wins,
    actual_loss_count: losses,
    actual_win_rate: winRateStr,
    sessionName: params.sessionName,
    session_name: params.sessionName,
    startTime: params.startTime,
    start_time: params.startTime,
    endTime: params.endTime,
    completion_time: params.endTime,
  });
}

export async function renderDynamicSessionHistory(params: {
  sessionName: string;
  startTime: string;
  endTime: string;
  targetWins: number;
  wins?: number;
  losses?: number;
  totalSignals?: number;
  winRate?: number | string;
  status: string;
  signals: Array<{
    issue_number: string;
    prediction: string;
    predicted_color?: string;
    actual_number?: number | null;
    actual_size?: string | null;
    actual_color?: string | null;
    status: string;
  }>;
}): Promise<string> {
  // SINGLE SOURCE OF TRUTH:
  // Both the summary counts and the detailed list MUST come from the exact same records.
  // 1. Deduplicate by period / issue_number (One period = one record)
  const uniqueSignalsMap = new Map<string, typeof params.signals[0]>();
  for (const s of params.signals || []) {
    if (s && s.issue_number && !uniqueSignalsMap.has(s.issue_number)) {
      uniqueSignalsMap.set(s.issue_number, s);
    }
  }
  const uniqueSignals = Array.from(uniqueSignalsMap.values());

  // 2. Only settled recorded results (WIN or LOSS) form the history
  const settled = uniqueSignals.filter((s) => s.status === 'WIN' || s.status === 'LOSS');

  // 3. Authoritative calculation:
  // TOTAL = number of unique recorded signal results
  // WIN = number of those results whose outcome = WIN
  // LOSS = number of those results whose outcome = LOSS
  // INVARIANT: TOTAL = WIN + LOSS ALWAYS
  const derivedWins = settled.filter((s) => s.status === 'WIN').length;
  const derivedLosses = settled.filter((s) => s.status === 'LOSS').length;
  const derivedTotal = derivedWins + derivedLosses;

  let wins = derivedWins;
  let losses = derivedLosses;
  let totalSignals = derivedTotal;

  const rawDerivedRate = derivedTotal > 0 ? (derivedWins / derivedTotal) * 100 : 0;
  let winRate =
    derivedTotal > 0
      ? (rawDerivedRate % 1 === 0 ? rawDerivedRate.toFixed(0) : (Math.round(rawDerivedRate * 100) / 100).toFixed(2))
      : '0.00';

  // Support valid test/partial previews where signals is an explicit subset sample AND summary satisfies TOTAL = WIN + LOSS
  if (
    params.totalSignals !== undefined &&
    params.wins !== undefined &&
    params.losses !== undefined &&
    params.signals &&
    params.signals.length > 0 &&
    params.signals.length < (params.wins + params.losses) &&
    params.wins + params.losses === params.totalSignals
  ) {
    wins = params.wins;
    losses = params.losses;
    totalSignals = params.totalSignals;
    const rawProvidedRate = totalSignals > 0 ? (wins / totalSignals) * 100 : 0;
    winRate = String(
      params.winRate ?? (rawProvidedRate % 1 === 0 ? rawProvidedRate.toFixed(0) : (Math.round(rawProvidedRate * 100) / 100).toFixed(2))
    );
  }

  // 4. Format detail list using the EXACT same settled records
  const signalItems = settled
    .map((s, idx) => {
      const emoji = s.status === 'WIN' ? '✅' : '❌';
      const sigColor = s.predicted_color ? ` ${s.predicted_color}` : '';
      const resultParts = [s.actual_number, s.actual_size, s.actual_color]
        .filter((v) => v !== null && v !== undefined && v !== '')
        .join(' ');
      const resultStr = resultParts || s.status;
      return `${idx + 1}. Period: ${s.issue_number}\n   Signal: ${s.prediction}${sigColor}\n   Result: ${resultStr}\n   ${emoji} ${s.status}`;
    })
    .join('\n\n');

  const winRateStr = String(winRate);

  return templateService.render('SESSION_HISTORY', {
    sessionName: params.sessionName,
    session_name: params.sessionName,
    startTime: params.startTime,
    start_time: params.startTime,
    endTime: params.endTime,
    completion_time: params.endTime,
    targetWins: params.targetWins,
    target: params.targetWins,
    wins,
    losses,
    totalSignals,
    winRate: winRateStr,
    actual_total: totalSignals,
    actual_win_count: wins,
    actual_loss_count: losses,
    actual_win_rate: winRateStr,
    status: params.status || 'TARGET COMPLETED',
    signalsList: signalItems || 'No resolved signals in this session.',
  });
}

