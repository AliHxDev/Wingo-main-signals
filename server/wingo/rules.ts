export type WinGoSize = 'SMALL' | 'BIG';
export type WinGoColor = 'RED' | 'GREEN' | 'VIOLET';

/**
 * Returns the size category for a given WinGo number (0-9).
 * 0 - 4 = SMALL
 * 5 - 9 = BIG
 */
export function getSize(numInput: number | string): WinGoSize {
  const num = typeof numInput === 'string' ? parseInt(numInput, 10) : numInput;
  if (isNaN(num) || num < 0 || num > 9) {
    throw new Error(`Invalid WinGo number: ${numInput}. Must be an integer between 0 and 9.`);
  }

  return num <= 4 ? 'SMALL' : 'BIG';
}

export const classifySize = getSize;

export function isValidWinGoNumber(num: any): boolean {
  if (typeof num !== 'number' || isNaN(num) || !Number.isInteger(num)) return false;
  return num >= 0 && num <= 9;
}

export function isSpecialVioletNumber(num: number): boolean {
  return num === 0 || num === 5;
}

/**
 * Returns the color array for a given WinGo number (0-9).
 * 0 = RED + VIOLET
 * 5 = GREEN + VIOLET
 * Even (2, 4, 6, 8) = RED
 * Odd (1, 3, 7, 9) = GREEN
 */
export function getColors(numInput: number | string): WinGoColor[] {
  const num = typeof numInput === 'string' ? parseInt(numInput, 10) : numInput;
  if (isNaN(num) || num < 0 || num > 9) {
    throw new Error(`Invalid WinGo number: ${numInput}. Must be an integer between 0 and 9.`);
  }

  if (num === 0) {
    return ['RED', 'VIOLET'];
  }
  if (num === 5) {
    return ['GREEN', 'VIOLET'];
  }
  if (num % 2 === 0) {
    return ['RED'];
  }
  return ['GREEN'];
}

export const classifyColor = getColors;

export function classifyWinGoNumber(num: number) {
  return {
    number: num,
    size: getSize(num),
    colors: getColors(num),
  };
}

/**
 * Primary display color string (e.g. "RED+VIOLET", "RED", "GREEN")
 */
export function getPrimaryColorDisplay(numInput: number | string): string {
  const colors = getColors(numInput);
  return colors.join('+');
}

/**
 * Check if a predicted size and color matched the actual result
 */
export function evaluateWin(
  predictedSize: WinGoSize,
  actualNumber: number | string
): { isWin: boolean; actualSize: WinGoSize; actualColors: WinGoColor[] } {
  const actualSize = getSize(actualNumber);
  const actualColors = getColors(actualNumber);
  const isWin = predictedSize === actualSize;
  return { isWin, actualSize, actualColors };
}

export interface SignalPredictionInput {
  prediction?: string | null;
  predictedSize?: string | null;
  predictedColor?: string | null;
  color?: string | null;
  size?: string | null;
}

export interface SignalActualInput {
  number?: number | string | null;
  actualNumber?: number | string | null;
  size?: string | null;
  actualSize?: string | null;
  colors?: string[] | string | null;
  actualColor?: string | null;
}

export interface SignalOutcomeResult {
  isWin: boolean;
  outcome: 'WIN' | 'LOSS';
  actualNumber: number;
  actualSize: WinGoSize;
  actualColors: WinGoColor[];
  actualColorDisplay: string;
}

/**
 * Single authoritative WIN/LOSS comparison function.
 * Matches predictions according to defined contract:
 * - Size: SMALL (0-4), BIG (5-9)
 * - Color: RED (even, 0), GREEN (odd, 5), supporting dual-color violet (0=RED+VIOLET, 5=GREEN+VIOLET).
 */
export function calculateSignalOutcome(
  predictionInput: string | SignalPredictionInput,
  actualInput: number | string | SignalActualInput
): SignalOutcomeResult {
  let predictedSize: string | null = null;
  let predictedColor: string | null = null;

  if (typeof predictionInput === 'string') {
    const parts = predictionInput.trim().toUpperCase().split(/\s+/);
    if (parts.length > 0) {
      if (parts[0] === 'BIG' || parts[0] === 'SMALL') {
        predictedSize = parts[0];
      }
      if (parts[1] === 'RED' || parts[1] === 'GREEN' || parts[1] === 'VIOLET') {
        predictedColor = parts[1];
      }
    }
  } else if (predictionInput && typeof predictionInput === 'object') {
    const rawPred = (predictionInput.prediction || '').trim().toUpperCase();
    const parts = rawPred.split(/\s+/);
    if (parts[0] === 'BIG' || parts[0] === 'SMALL') {
      predictedSize = parts[0];
    } else if (predictionInput.predictedSize || predictionInput.size) {
      const s = String(predictionInput.predictedSize || predictionInput.size).trim().toUpperCase();
      if (s === 'BIG' || s === 'SMALL') predictedSize = s;
    }

    if (parts[1] === 'RED' || parts[1] === 'GREEN' || parts[1] === 'VIOLET') {
      predictedColor = parts[1];
    } else if (predictionInput.predictedColor || predictionInput.color) {
      const c = String(predictionInput.predictedColor || predictionInput.color).trim().toUpperCase();
      if (c === 'RED' || c === 'GREEN' || c === 'VIOLET') predictedColor = c;
    }
  }

  let actualNum: number;
  if (typeof actualInput === 'number') {
    actualNum = actualInput;
  } else if (typeof actualInput === 'string') {
    actualNum = parseInt(actualInput, 10);
  } else if (actualInput && typeof actualInput === 'object') {
    const raw = actualInput.actualNumber !== undefined ? actualInput.actualNumber : actualInput.number;
    actualNum = typeof raw === 'number' ? raw : parseInt(String(raw ?? '0'), 10);
  } else {
    actualNum = 0;
  }

  if (isNaN(actualNum) || actualNum < 0 || actualNum > 9) {
    actualNum = 0;
  }

  const actualSize = getSize(actualNum);
  const actualColors = getColors(actualNum);
  const actualColorDisplay = actualColors.join('+');

  const sizeMatches = !predictedSize || predictedSize === actualSize;
  const colorMatches = !predictedColor || actualColors.includes(predictedColor as WinGoColor);

  const isWin = sizeMatches && colorMatches;
  const outcome: 'WIN' | 'LOSS' = isWin ? 'WIN' : 'LOSS';

  return {
    isWin,
    outcome,
    actualNumber: actualNum,
    actualSize,
    actualColors,
    actualColorDisplay,
  };
}
