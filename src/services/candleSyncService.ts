/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sync closed 15M candles to Firestore — invoked by Cloud Scheduler or local dev.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type {
  CandleSyncResult,
  CandleSyncSymbolResult,
  ChartCandle,
  ChartCandleDocument,
} from '../types/chartCandle.js';
import { fetchBinance15m } from './binanceKlines.js';

const COLLECTION = 'chart_candles';
export const CANDLE_STORE_LIMIT = 1280;
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const BINANCE_FETCH_LIMIT = 500;

function parseSymbols(): string[] {
  const raw = process.env.CANDLE_SYNC_SYMBOLS?.trim();
  if (!raw) return DEFAULT_SYMBOLS;
  return raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function docId(symbol: string): string {
  return `${symbol.replace(/\//g, '_')}_15m`;
}

export function mergeCandleSeries(base: ChartCandle[], incoming: ChartCandle[]): ChartCandle[] {
  const map = new Map<number, ChartCandle>();
  for (const c of base) map.set(c.time, c);
  for (const c of incoming) map.set(c.time, c);
  const merged = [...map.values()].sort((a, b) => a.time - b.time);
  return merged.length > CANDLE_STORE_LIMIT ? merged.slice(-CANDLE_STORE_LIMIT) : merged;
}

export class CandleSyncService {
  private syncInProgress = false;

  constructor(private readonly db: Firestore) {}

  getSymbols(): string[] {
    return parseSymbols();
  }

  async syncSymbol(symbol: string): Promise<CandleSyncSymbolResult> {
    const normalized = symbol.toUpperCase();
    try {
      const ref = this.db.collection(COLLECTION).doc(docId(normalized));
      const snap = await ref.get();
      const existing = snap.exists
        ? ((snap.data() as ChartCandleDocument).candles ?? [])
        : [];

      const fresh = await fetchBinance15m(normalized, BINANCE_FETCH_LIMIT);
      const merged = mergeCandleSeries(existing, fresh);

      const payload: ChartCandleDocument = {
        symbol: normalized,
        interval: '15m',
        updatedAt: Date.now(),
        candles: merged,
        savedBy: 'worker',
        candleCount: merged.length,
      };

      await ref.set(payload, { merge: true });

      console.info(`[CandleSync] ${normalized} → ${merged.length} candles`);
      return { symbol: normalized, candleCount: merged.length, ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[CandleSync] ${normalized} failed:`, message);
      return { symbol: normalized, candleCount: 0, ok: false, error: message };
    }
  }

  async syncAll(): Promise<CandleSyncResult> {
    if (this.syncInProgress) {
      throw new Error('Candle sync already in progress');
    }

    this.syncInProgress = true;
    const symbols = parseSymbols();
    const results: CandleSyncSymbolResult[] = [];

    try {
      console.info(`[CandleSync] cycle start — ${symbols.join(', ')}`);
      for (const symbol of symbols) {
        results.push(await this.syncSymbol(symbol));
      }
      return { syncedAt: Date.now(), symbols: results };
    } finally {
      this.syncInProgress = false;
    }
  }
}

/** Ms until next 15M UTC close (+ buffer for Binance publish). */
export function msUntilNext15mClose(bufferMs = 8000): number {
  const now = Date.now();
  const interval = 15 * 60 * 1000;
  const next = Math.ceil(now / interval) * interval + bufferMs;
  return Math.max(5000, next - now);
}
