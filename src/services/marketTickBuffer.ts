/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * In-memory RAM buffer for incoming WebSocket market ticks.
 * Ticks are aggregated and flushed periodically — never written per-tick.
 */

export interface BufferedTick {
  price: number;
  high24h: number;
  low24h: number;
  changePercent: number;
  volume24h: number;
  eventTime: number;
}

export interface AggregatedMarketSnapshot {
  symbol: string;
  open: number;
  close: number;
  high: number;
  low: number;
  avg: number;
  tickCount: number;
  windowStart: number;
  windowEnd: number;
  changePercentLast: number;
  volume24hLast: number;
  flushedAt: number;
}

export class MarketTickBuffer {
  private buffers = new Map<string, BufferedTick[]>();

  /** O(1) append — safe to call from the WebSocket message handler. */
  recordTick(symbol: string, tick: BufferedTick): void {
    const normalized = symbol.trim().toLowerCase();
    let bucket = this.buffers.get(normalized);
    if (!bucket) {
      bucket = [];
      this.buffers.set(normalized, bucket);
    }
    bucket.push(tick);
  }

  /** Atomically swap out all buffers so the relay can keep recording during flush. */
  swapBuffers(): Map<string, BufferedTick[]> {
    const drained = this.buffers;
    this.buffers = new Map();
    return drained;
  }

  /** Re-merge a failed flush back into the active buffer (preserves tick order). */
  mergeBuffers(previous: Map<string, BufferedTick[]>): void {
    for (const [symbol, ticks] of previous) {
      if (ticks.length === 0) continue;
      const existing = this.buffers.get(symbol) ?? [];
      this.buffers.set(symbol, [...ticks, ...existing]);
    }
  }

  aggregateFromMap(source: Map<string, BufferedTick[]>): AggregatedMarketSnapshot[] {
    const snapshots: AggregatedMarketSnapshot[] = [];

    for (const [symbol, ticks] of source) {
      if (ticks.length === 0) continue;
      snapshots.push(this.aggregateSymbol(symbol, ticks));
    }

    return snapshots;
  }

  getBufferedTickCount(): number {
    let total = 0;
    for (const ticks of this.buffers.values()) {
      total += ticks.length;
    }
    return total;
  }

  private aggregateSymbol(symbol: string, ticks: BufferedTick[]): AggregatedMarketSnapshot {
    const prices = ticks.map((t) => t.price);
    const sum = prices.reduce((acc, p) => acc + p, 0);
    const last = ticks[ticks.length - 1];

    return {
      symbol,
      open: ticks[0].price,
      close: last.price,
      high: Math.max(...prices),
      low: Math.min(...prices),
      avg: parseFloat((sum / ticks.length).toFixed(8)),
      tickCount: ticks.length,
      windowStart: ticks[0].eventTime,
      windowEnd: last.eventTime,
      changePercentLast: last.changePercent,
      volume24hLast: last.volume24h,
      flushedAt: Date.now(),
    };
  }
}
