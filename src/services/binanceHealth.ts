/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SentinelApiKeys } from '../../config/keys.js';

export async function validateBinanceOnStartup(keys: SentinelApiKeys): Promise<void> {
  const response = await fetch('https://api.binance.com/api/v3/ping');

  if (!response.ok) {
    throw new Error(
      `[Sentinel Backend] Binance API ping failed with status ${response.status}.`
    );
  }

  if (!keys.hasBinanceCredentials) {
    console.warn(
      '[Sentinel Backend] Binance API keys not set — market relay works; spot/futures execution disabled.'
    );
    return;
  }

  console.info('[Sentinel Backend] Binance connectivity check passed.');
}
