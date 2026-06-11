/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Smart Write-Back: aggregate RAM-buffered ticks and batch-write to Firestore
 * every 5 minutes — one write per symbol per interval, not per tick.
 */

import type { Firestore } from 'firebase-admin/firestore';
import {
  MarketTickBuffer,
  type AggregatedMarketSnapshot,
  type BufferedTick,
} from './marketTickBuffer.js';

const DEFAULT_FLUSH_INTERVAL_MS = 5 * 60 * 1000;
const MARKET_DATA_COLLECTION = 'market_data';

export class FirebaseWriteBackService {
  private readonly buffer = new MarketTickBuffer();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private flushInProgress = false;

  constructor(
    private readonly db: Firestore,
    private readonly flushIntervalMs = Number(process.env.FIREBASE_FLUSH_INTERVAL_MS ?? DEFAULT_FLUSH_INTERVAL_MS)
  ) {}

  /** Non-blocking tick capture — call from WebSocket handler. */
  recordTick(symbol: string, tick: BufferedTick): void {
    this.buffer.recordTick(symbol, tick);
  }

  start(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      void this.flushAsync();
    }, this.flushIntervalMs);

    console.info(
      `[FirebaseWriteBack] Smart write-back active — flush every ${this.flushIntervalMs / 1000}s → ${MARKET_DATA_COLLECTION}`
    );
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Trigger a final flush on shutdown (awaitable). */
  async flushNow(): Promise<void> {
    await this.flushAsync();
  }

  /**
   * Schedules flush without blocking the caller.
   * Uses buffer swap so the relay keeps ingesting ticks during the Firestore write.
   */
  private async flushAsync(): Promise<void> {
    if (this.flushInProgress) {
      console.warn('[FirebaseWriteBack] Previous flush still in progress — skipping this interval');
      return;
    }

    const swapped = this.buffer.swapBuffers();
    const snapshots = this.buffer.aggregateFromMap(swapped);

    if (snapshots.length === 0) {
      return;
    }

    this.flushInProgress = true;

    try {
      await this.batchWriteSnapshots(snapshots);
      console.info(
        `[FirebaseWriteBack] Batch write OK — ${snapshots.length} doc(s), ` +
          `${snapshots.reduce((n, s) => n + s.tickCount, 0)} ticks aggregated`
      );
    } catch (err) {
      this.buffer.mergeBuffers(swapped);
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[FirebaseWriteBack] Write failed — buffers restored for retry: ${message}`);
    } finally {
      this.flushInProgress = false;
    }
  }

  private async batchWriteSnapshots(snapshots: AggregatedMarketSnapshot[]): Promise<void> {
    const batch = this.db.batch();
    const collection = this.db.collection(MARKET_DATA_COLLECTION);

    for (const snapshot of snapshots) {
      const docRef = collection.doc();
      batch.set(docRef, snapshot);
    }

    await batch.commit();
  }
}
