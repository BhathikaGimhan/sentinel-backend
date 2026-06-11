/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Binance USD-M Futures API — signed leveraged order placement.
 */

import { createHmac } from 'node:crypto';
import { getApiKeys } from '../../config/keys.js';

const FUTURES_BASE = process.env.BINANCE_FUTURES_BASE_URL ?? 'https://fapi.binance.com';

export type FuturesCommand = 'OPEN_LONG' | 'OPEN_SHORT';

export interface PlaceLeveragedOrderInput {
  symbol: string;
  command: FuturesCommand;
  marginUSDT: number;
  leverage: number;
  entryPrice: number;
}

export interface PlaceLeveragedOrderResult {
  orderId: string;
  transmissionStatus: 'LIVE' | 'SIMULATED';
  binanceOrderId?: string;
}

function signQuery(query: string, secret: string): string {
  return createHmac('sha256', secret).update(query).digest('hex');
}

async function futuresRequest(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string | number>
): Promise<unknown> {
  const keys = getApiKeys();
  const timestamp = Date.now();
  const allParams = { ...params, timestamp };
  const query = Object.entries(allParams)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  const signature = signQuery(query, keys.binanceApiSecret);
  const url = `${FUTURES_BASE}${path}?${query}&signature=${signature}`;

  const res = await fetch(url, {
    method,
    headers: { 'X-MBX-APIKEY': keys.binanceApiKey },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof body === 'object' && body !== null && 'msg' in body
        ? String((body as { msg: string }).msg)
        : `HTTP ${res.status}`;
    throw new Error(`Binance Futures API error: ${msg}`);
  }
  return body;
}

function roundQuantity(qty: number, decimals = 3): string {
  const factor = Math.pow(10, decimals);
  return (Math.floor(qty * factor) / factor).toFixed(decimals);
}

/**
 * Place a market leveraged order on Binance USD-M Futures.
 * Falls back to simulated when BINANCE_FUTURES_EXECUTION !== 'live'.
 */
export async function placeLeveragedFuturesOrder(
  input: PlaceLeveragedOrderInput
): Promise<PlaceLeveragedOrderResult> {
  const mode = (process.env.BINANCE_FUTURES_EXECUTION ?? 'simulated').toLowerCase();
  const orderId = `LEV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  if (mode !== 'live') {
    console.info(
      `[BinanceFutures] SIMULATED ${input.command} ${input.symbol} | margin=${input.marginUSDT} | lev=${input.leverage}x`
    );
    return { orderId, transmissionStatus: 'SIMULATED' };
  }

  try {
    const symbol = input.symbol.toUpperCase();
    const side = input.command === 'OPEN_LONG' ? 'BUY' : 'SELL';
    const notional = input.marginUSDT * input.leverage;
    const quantity = roundQuantity(notional / input.entryPrice);

    await futuresRequest('POST', '/fapi/v1/leverage', {
      symbol,
      leverage: Math.min(125, Math.max(1, Math.floor(input.leverage))),
    });

    const result = (await futuresRequest('POST', '/fapi/v1/order', {
      symbol,
      side,
      type: 'MARKET',
      quantity,
    })) as { orderId?: number };

    console.info(
      `[BinanceFutures] LIVE ${input.command} ${symbol} qty=${quantity} | binanceId=${result.orderId ?? 'n/a'}`
    );

    return {
      orderId,
      transmissionStatus: 'LIVE',
      binanceOrderId: result.orderId !== undefined ? String(result.orderId) : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[BinanceFutures] Live order failed — simulating: ${message}`);
    return { orderId, transmissionStatus: 'SIMULATED' };
  }
}
