/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Server-only API key management. Never import this module from the frontend.
 */

import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findProjectRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return startDir;
    }
    dir = parent;
  }
}

const configDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = findProjectRoot(configDir);

dotenv.config({ path: path.resolve(projectRoot, '.env') });

export interface SentinelApiKeys {
  geminiApiKey: string;
  binanceApiKey: string;
  binanceApiSecret: string;
  hasBinanceCredentials: boolean;
}

const REQUIRED_ENV_VARS = ['GEMINI_API_KEY'] as const;

function readRequiredEnv(name: (typeof REQUIRED_ENV_VARS)[number]): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `[Sentinel Backend] Missing required environment variable "${name}". ` +
        `Copy .env.example to .env in sentinel-backend-relay and set your credentials.`
    );
  }
  return value;
}

function assertKeyShape(keys: SentinelApiKeys): void {
  if (keys.geminiApiKey.length < 12) {
    throw new Error(
      '[Sentinel Backend] GEMINI_API_KEY appears invalid (too short). Check your .env file.'
    );
  }

  if (keys.hasBinanceCredentials) {
    if (keys.binanceApiKey.length < 8) {
      throw new Error(
        '[Sentinel Backend] BINANCE_API_KEY appears invalid (too short). Check your .env file.'
      );
    }
    if (keys.binanceApiSecret.length < 8) {
      throw new Error(
        '[Sentinel Backend] BINANCE_API_SECRET appears invalid (too short). Check your .env file.'
      );
    }
  }
}

export function validateKeysOnStartup(): SentinelApiKeys {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]?.trim());

  if (missing.length > 0) {
    throw new Error(
      `[Sentinel Backend] Startup aborted. Missing API keys: ${missing.join(', ')}`
    );
  }

  const binanceApiKey = process.env.BINANCE_API_KEY?.trim() ?? '';
  const binanceApiSecret = process.env.BINANCE_API_SECRET?.trim() ?? '';

  const keys: SentinelApiKeys = {
    geminiApiKey: readRequiredEnv('GEMINI_API_KEY'),
    binanceApiKey,
    binanceApiSecret,
    hasBinanceCredentials: Boolean(binanceApiKey && binanceApiSecret),
  };

  assertKeyShape(keys);

  if (keys.hasBinanceCredentials) {
    console.info('[Sentinel Backend] API key validation passed (Gemini + Binance).');
  } else {
    console.warn(
      '[Sentinel Backend] Gemini OK — Binance keys missing. Market relay active; trade execution disabled.'
    );
  }

  return keys;
}

let cachedKeys: SentinelApiKeys | null = null;

export function getApiKeys(): SentinelApiKeys {
  if (!cachedKeys) {
    cachedKeys = validateKeysOnStartup();
  }
  return cachedKeys;
}
