/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fetches CryptoCompare news on a schedule, persists one Firestore doc,
 * and serves all users from in-memory cache (zero Firestore reads per request).
 */

import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type {
  CachedNewsPayload,
  NewsArticleRecord,
  NewsFeedDocument,
  NewsSyncResult,
} from '../types/newsFeed.js';

const COLLECTION = 'news_feed';
const DOC_ID = 'latest';
const CRYPTOCOMPARE_NEWS_URL = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN';
const MAX_ARTICLES = 20;

function getApiKey(): string | undefined {
  return process.env.CRYPTOCOMPARE_API_KEY?.trim() || undefined;
}

function hashArticles(articles: NewsArticleRecord[]): string {
  const ids = articles.map((a) => a.id).join('|');
  return createHash('sha256').update(ids).digest('hex').slice(0, 16);
}

function toEtag(syncedAt: number, contentHash: string): string {
  return `"news-${syncedAt}-${contentHash}"`;
}

function normalizeArticle(raw: Record<string, unknown>): NewsArticleRecord | null {
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) return null;

  const sourceInfo = raw.source_info as { name?: string } | undefined;
  const id =
    raw.id != null ? String(raw.id) : createHash('md5').update(title).digest('hex').slice(0, 12);

  return {
    id,
    title,
    body: typeof raw.body === 'string' ? raw.body : '',
    source:
      sourceInfo?.name ??
      (typeof raw.source === 'string' ? raw.source : 'Aggregated'),
    published_on:
      typeof raw.published_on === 'number'
        ? raw.published_on
        : Math.floor(Date.now() / 1000),
    url: typeof raw.url === 'string' ? raw.url : undefined,
    imageurl: typeof raw.imageurl === 'string' ? raw.imageurl : undefined,
  };
}

export class NewsSyncService {
  private syncInProgress = false;
  private memoryCache: CachedNewsPayload | null = null;

  constructor(private readonly db: Firestore) {}

  getEtag(): string | null {
    return this.memoryCache?.etag ?? null;
  }

  getCachedPayload(): CachedNewsPayload | null {
    return this.memoryCache;
  }

  /** Cold start only — one Firestore read per instance boot. */
  async hydrateFromFirestore(): Promise<boolean> {
    try {
      const snap = await this.db.collection(COLLECTION).doc(DOC_ID).get();
      if (!snap.exists) return false;

      const doc = snap.data() as NewsFeedDocument;
      if (!Array.isArray(doc.articles) || doc.articles.length === 0) return false;

      this.memoryCache = {
        syncedAt: doc.syncedAt,
        etag: toEtag(doc.syncedAt, doc.contentHash),
        Data: doc.articles,
      };
      console.info(
        `[NewsSync] Hydrated ${doc.articles.length} articles from Firestore (synced ${new Date(doc.syncedAt).toISOString()})`
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[NewsSync] Firestore hydrate failed:', message);
      return false;
    }
  }

  /** Cron / startup — single CryptoCompare call; Firestore write only when content changes. */
  async syncFromUpstream(): Promise<NewsSyncResult> {
    if (this.syncInProgress) {
      return {
        ok: false,
        syncedAt: this.memoryCache?.syncedAt ?? 0,
        articleCount: this.memoryCache?.Data.length ?? 0,
        skipped: true,
        reason: 'sync already in progress',
      };
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      return {
        ok: false,
        syncedAt: 0,
        articleCount: 0,
        error: 'CRYPTOCOMPARE_API_KEY not configured',
      };
    }

    this.syncInProgress = true;
    try {
      const response = await fetch(CRYPTOCOMPARE_NEWS_URL, {
        headers: {
          'User-Agent': 'sentinel-backend-relay/1.0',
          Authorization: `Apikey ${apiKey}`,
        },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`CryptoCompare ${response.status}: ${body.slice(0, 120)}`);
      }

      const json = (await response.json()) as { Data?: unknown[] };
      const rawList = Array.isArray(json.Data) ? json.Data : [];
      const articles = rawList
        .map((item) => normalizeArticle(item as Record<string, unknown>))
        .filter((a): a is NewsArticleRecord => a != null)
        .slice(0, MAX_ARTICLES);

      if (articles.length === 0) {
        throw new Error('CryptoCompare returned no articles');
      }

      const syncedAt = Date.now();
      const contentHash = hashArticles(articles);
      const etag = toEtag(syncedAt, contentHash);

      const prevHash = this.memoryCache?.etag.split('-').pop();
      const unchanged = prevHash === contentHash;

      if (!unchanged) {
        const payload: NewsFeedDocument = {
          syncedAt,
          source: 'cryptocompare',
          articleCount: articles.length,
          contentHash,
          articles,
        };
        await this.db.collection(COLLECTION).doc(DOC_ID).set(payload);
        console.info(`[NewsSync] Firestore updated — ${articles.length} articles`);
      } else {
        console.info('[NewsSync] Content unchanged — skipped Firestore write');
      }

      this.memoryCache = { syncedAt, etag, Data: articles };

      return {
        ok: true,
        syncedAt,
        articleCount: articles.length,
        skipped: unchanged,
        reason: unchanged ? 'content unchanged' : undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[NewsSync] Upstream sync failed:', message);
      return {
        ok: false,
        syncedAt: this.memoryCache?.syncedAt ?? 0,
        articleCount: this.memoryCache?.Data.length ?? 0,
        error: message,
      };
    } finally {
      this.syncInProgress = false;
    }
  }
}
