/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChartCandle } from '../types/chartCandle.js';

const KLINES_URL = 'https://api.binance.com/api/v3/klines';

export async function fetchBinanceKlines(
  symbol: string,
  interval: string,
  limit: number
): Promise<ChartCandle[]> {
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    interval,
    limit: String(limit),
  });

  const response = await fetch(`${KLINES_URL}?${params.toString()}`, {
    headers: { 'User-Agent': 'sentinel-backend-relay/1.0' },
  });

  if (!response.ok) {
    throw new Error(`Binance klines ${symbol} ${interval} failed (${response.status})`);
  }

  const rows = (await response.json()) as unknown[][];
  return rows.map((row) => ({
    time: row[0] as number,
    open: parseFloat(row[1] as string),
    high: parseFloat(row[2] as string),
    low: parseFloat(row[3] as string),
    close: parseFloat(row[4] as string),
    volume: parseFloat(row[5] as string),
  }));
}

export async function fetchBinance15m(symbol: string, limit: number): Promise<ChartCandle[]> {
  return fetchBinanceKlines(symbol, '15m', limit);
}
