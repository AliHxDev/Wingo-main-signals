import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

const ENV_PATH = path.join(process.cwd(), '.env');

/**
 * Mask passwords inside connection strings or sensitive values for secure UI display
 */
export function maskSensitiveValue(key: string, value: string): string {
  if (!value) return '';
  if (key.includes('PASSWORD') || key.includes('SECRET')) {
    return '••••••••';
  }
  if (key === 'DATABASE_URL' || key.includes('URL') && (value.startsWith('postgres') || value.startsWith('http'))) {
    try {
      const url = new URL(value);
      if (url.password) {
        url.password = '••••••••';
        return url.toString();
      }
    } catch {
      // Regex fallback for postgres strings
      return value.replace(/:(.*?)@/, ':••••••••@');
    }
  }
  return value;
}

/**
 * Read key-value pairs from .env
 */
export function readEnvFile(): Record<string, string> {
  const envVars: Record<string, string> = {};
  if (!fs.existsSync(ENV_PATH)) {
    return envVars;
  }

  try {
    const content = fs.readFileSync(ENV_PATH, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        envVars[key] = val;
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to parse .env file');
  }

  return envVars;
}

/**
 * Write or update key-value pairs in .env and process.env
 */
export function updateEnvVariables(updates: Record<string, string>): { success: boolean; updated: string[] } {
  try {
    let content = '';
    if (fs.existsSync(ENV_PATH)) {
      content = fs.readFileSync(ENV_PATH, 'utf-8');
    }

    const currentLines = content.split('\n');
    const existingKeys = new Set<string>();
    const updatedLines: string[] = [];

    for (const line of currentLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        updatedLines.push(line);
        continue;
      }
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        existingKeys.add(key);
        if (key in updates) {
          updatedLines.push(`${key}=${updates[key]}`);
          process.env[key] = updates[key];
        } else {
          updatedLines.push(line);
        }
      } else {
        updatedLines.push(line);
      }
    }

    // Add any new keys that did not exist before
    for (const [key, val] of Object.entries(updates)) {
      if (!existingKeys.has(key)) {
        updatedLines.push(`${key}=${val}`);
        process.env[key] = val;
      }
    }

    fs.writeFileSync(ENV_PATH, updatedLines.join('\n'), 'utf-8');
    logger.info({ keys: Object.keys(updates) }, 'Updated .env file and process.env');
    return { success: true, updated: Object.keys(updates) };
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to update .env file');
    // Still update in-memory process.env
    for (const [key, val] of Object.entries(updates)) {
      process.env[key] = val;
    }
    return { success: false, updated: Object.keys(updates) };
  }
}
