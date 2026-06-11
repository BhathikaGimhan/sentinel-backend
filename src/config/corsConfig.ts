/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const PRODUCTION_ORIGINS = [
  'https://forex-market-ai.web.app',
  'https://forex-market-ai.firebaseapp.com',
];

export function resolveCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN ?? 'http://localhost:3000';
  const fromEnv = raw.split(',').map((o) => o.trim()).filter(Boolean);

  if (process.env.NODE_ENV === 'production') {
    return [...new Set([...fromEnv, ...PRODUCTION_ORIGINS])];
  }

  return fromEnv;
}

export function createCorsOriginChecker(origins: string[]) {
  const allowed = new Set(origins);
  return (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) => {
    if (!origin || allowed.has(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  };
}
