/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import WebSocket from 'ws';
import type { Server, Socket } from 'socket.io';
import {
  IndicatorCalculator,
  type BinanceTickerTick,
  type MarketMetricsPayload,
} from './indicatorCalculator.js';
import type { FirebaseWriteBackService } from './firebaseWriteBack.js';

const BINANCE_WS_BASES = [
  'wss://stream.binance.com:9443/ws',
  'wss://stream.binance.com/ws',
  'wss://data-stream.binance.vision/ws',
];

interface SymbolRelayState {
  calculator: IndicatorCalculator;
  socket: WebSocket | null;
  subscribers: number;
  baseIndex: number;
  intentionalClose: boolean;
}

export class RelayService {
  private readonly relays = new Map<string, SymbolRelayState>();

  constructor(
    private readonly io: Server,
    private readonly writeBack?: FirebaseWriteBackService
  ) {}

  attachSocketHandlers(socket: Socket): void {
    const subscribedSymbols = new Set<string>();

    socket.on('subscribe-market', (rawSymbol: string) => {
      const symbol = this.normalizeSymbol(rawSymbol);
      if (!symbol || subscribedSymbols.has(symbol)) return;

      subscribedSymbols.add(symbol);
      socket.join(this.roomFor(symbol));
      this.incrementSubscribers(symbol);
      console.info(`[RelayService] Client ${socket.id} subscribed to ${symbol}`);
    });

    socket.on('unsubscribe-market', (rawSymbol: string) => {
      const symbol = this.normalizeSymbol(rawSymbol);
      if (!symbol || !subscribedSymbols.has(symbol)) return;

      subscribedSymbols.delete(symbol);
      socket.leave(this.roomFor(symbol));
      this.decrementSubscribers(symbol);
      console.info(`[RelayService] Client ${socket.id} unsubscribed from ${symbol}`);
    });

    socket.on('disconnect', () => {
      for (const symbol of subscribedSymbols) {
        this.decrementSubscribers(symbol);
      }
      subscribedSymbols.clear();
    });
  }

  private normalizeSymbol(symbol: string): string {
    return symbol.trim().toLowerCase();
  }

  private roomFor(symbol: string): string {
    return `market:${symbol}`;
  }

  private incrementSubscribers(symbol: string): void {
    const existing = this.relays.get(symbol);
    if (existing) {
      existing.subscribers += 1;
      if (!existing.socket || existing.socket.readyState !== WebSocket.OPEN) {
        this.connectBinanceStream(symbol, existing, existing.baseIndex);
      }
      return;
    }

    const state: SymbolRelayState = {
      calculator: new IndicatorCalculator(symbol),
      socket: null,
      subscribers: 1,
      baseIndex: 0,
      intentionalClose: false,
    };
    this.relays.set(symbol, state);
    this.connectBinanceStream(symbol, state, 0);
  }

  private decrementSubscribers(symbol: string): void {
    const state = this.relays.get(symbol);
    if (!state) return;

    state.subscribers = Math.max(0, state.subscribers - 1);
    const room = this.io.sockets.adapter.rooms.get(this.roomFor(symbol));
    const roomSize = room?.size ?? 0;

    if (state.subscribers === 0 && roomSize === 0) {
      this.stopRelay(symbol);
    }
  }

  private connectBinanceStream(symbol: string, state: SymbolRelayState, baseIndex: number): void {
    if (state.socket && state.socket.readyState === WebSocket.OPEN) return;

    const wsUrl = `${BINANCE_WS_BASES[baseIndex]}/${symbol}@ticker`;
    const ws = new WebSocket(wsUrl);
    state.socket = ws;
    state.baseIndex = baseIndex;
    state.intentionalClose = false;

    ws.on('open', () => {
      console.info(`[RelayService] Binance ticker stream connected for ${symbol}`);
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data?.e !== '24hrTicker') return;

        const tick: BinanceTickerTick = {
          symbol,
          price: parseFloat(data.c),
          high24h: parseFloat(data.h),
          low24h: parseFloat(data.l),
          changePercent: parseFloat(data.P),
          volume24h: parseFloat(data.v),
          quoteVolume24h: parseFloat(data.q),
          eventTime: Number(data.E) || Date.now(),
        };

        if (!Number.isFinite(tick.price)) return;

        // Non-blocking RAM capture for periodic Firebase batch write
        this.writeBack?.recordTick(symbol, {
          price: tick.price,
          high24h: tick.high24h,
          low24h: tick.low24h,
          changePercent: tick.changePercent,
          volume24h: tick.volume24h,
          eventTime: tick.eventTime,
        });

        const metrics: MarketMetricsPayload = state.calculator.updateFromTick(tick);
        this.io.to(this.roomFor(symbol)).emit('market-metrics', metrics);
      } catch (err) {
        console.error(`[RelayService] Tick parse error for ${symbol}:`, err);
      }
    });

    ws.on('error', () => {
      if (!state.intentionalClose) {
        console.warn(`[RelayService] Binance WS error on ${symbol} via ${BINANCE_WS_BASES[baseIndex]}`);
      }
    });

    ws.on('close', () => {
      state.socket = null;
      if (state.intentionalClose) return;

      const nextBase = baseIndex + 1;
      if (nextBase < BINANCE_WS_BASES.length && state.subscribers > 0) {
        setTimeout(() => this.connectBinanceStream(symbol, state, nextBase), 1500);
        return;
      }

      if (state.subscribers > 0) {
        setTimeout(() => this.connectBinanceStream(symbol, state, 0), 5000);
      }
    });
  }

  private stopRelay(symbol: string): void {
    const state = this.relays.get(symbol);
    if (!state) return;

    state.intentionalClose = true;
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.close(1000, 'no subscribers');
    }

    this.relays.delete(symbol);
    console.info(`[RelayService] Stopped relay for ${symbol}`);
  }
}
