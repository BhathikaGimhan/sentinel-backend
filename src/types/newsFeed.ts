/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface NewsArticleRecord {
  id: string;
  title: string;
  body: string;
  source: string;
  published_on: number;
  url?: string;
  imageurl?: string;
}

/** Single Firestore document — one write per cron tick, one read on cold start. */
export interface NewsFeedDocument {
  syncedAt: number;
  source: 'cryptocompare';
  articleCount: number;
  contentHash: string;
  articles: NewsArticleRecord[];
}

export interface NewsSyncResult {
  ok: boolean;
  syncedAt: number;
  articleCount: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

/** CryptoCompare-compatible payload served from in-memory cache (no upstream on read). */
export interface CachedNewsPayload {
  syncedAt: number;
  etag: string;
  Data: NewsArticleRecord[];
}
