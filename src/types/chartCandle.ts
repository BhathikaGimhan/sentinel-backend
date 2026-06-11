/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartCandleDocument {
  symbol: string;
  interval: '15m';
  updatedAt: number;
  candles: ChartCandle[];
  savedBy: 'worker';
  candleCount: number;
}

export interface CandleSyncSymbolResult {
  symbol: string;
  candleCount: number;
  ok: boolean;
  error?: string;
}

export interface CandleSyncResult {
  syncedAt: number;
  symbols: CandleSyncSymbolResult[];
}
