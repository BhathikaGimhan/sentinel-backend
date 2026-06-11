/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type MarketRegime = 'TRENDING' | 'REVERTING' | 'RANDOM';

export interface BollingerBands {
  upper: number;
  lower: number;
  basis: number;
}

export interface BinanceTickerTick {
  symbol: string;
  price: number;
  high24h: number;
  low24h: number;
  changePercent: number;
  volume24h: number;
  quoteVolume24h: number;
  eventTime: number;
}

export interface MarketMetricsPayload {
  symbol: string;
  price: number;
  high24h: number;
  low24h: number;
  changePercent: number;
  volume24h: number;
  lastUpdated: string;
  hurstExponent: number;
  rsi: number;
  vwap: number;
  marketRegime: MarketRegime;
  bollingerBands: BollingerBands;
  priceHistoryLength: number;
}

const MAX_HISTORY = 100;

export function calculateHurstExponent(prices: number[]): number {
  if (!prices || prices.length < 8) return 0.5;

  const n = prices.length;
  const chunkSizes: number[] = [];

  for (let size = 4; size <= n; size *= 2) {
    chunkSizes.push(size);
  }

  for (const size of [6, 12, 24, 48]) {
    if (size >= 4 && size <= n && !chunkSizes.includes(size)) {
      chunkSizes.push(size);
    }
  }

  chunkSizes.sort((a, b) => a - b);

  const logSizes: number[] = [];
  const logRS: number[] = [];

  for (const d of chunkSizes) {
    const numChunks = Math.floor(n / d);
    if (numChunks === 0) continue;

    const rsValues: number[] = [];

    for (let c = 0; c < numChunks; c++) {
      const chunk = prices.slice(c * d, (c + 1) * d);
      const chunkMean = chunk.reduce((sum, val) => sum + val, 0) / d;
      const meanAdjusted = chunk.map(val => val - chunkMean);

      let cumulativeSum = 0;
      const cumulativeDevs: number[] = [];
      for (let i = 0; i < d; i++) {
        cumulativeSum += meanAdjusted[i]!;
        cumulativeDevs.push(cumulativeSum);
      }

      const range = Math.max(...cumulativeDevs) - Math.min(...cumulativeDevs);
      const variance = chunk.reduce((acc, val) => acc + Math.pow(val - chunkMean, 2), 0) / d;
      const stdDev = Math.sqrt(variance);

      if (stdDev > 0 && range > 0) {
        rsValues.push(range / stdDev);
      }
    }

    if (rsValues.length > 0) {
      const avgRS = rsValues.reduce((sum, val) => sum + val, 0) / rsValues.length;
      logSizes.push(Math.log(d));
      logRS.push(Math.log(avgRS));
    }
  }

  if (logSizes.length >= 2) {
    const nPoints = logSizes.length;
    const sumX = logSizes.reduce((sum, val) => sum + val, 0);
    const sumY = logRS.reduce((sum, val) => sum + val, 0);
    const sumXY = logSizes.reduce((sum, val, idx) => sum + val * logRS[idx]!, 0);
    const sumXX = logSizes.reduce((sum, val) => sum + val * val, 0);
    const denominator = nPoints * sumXX - sumX * sumX;

    if (denominator !== 0) {
      const slope = (nPoints * sumXY - sumX * sumY) / denominator;
      if (!Number.isNaN(slope)) {
        return Math.min(0.99, Math.max(0.01, slope));
      }
    }
  }

  return 0.5;
}

export function calculateRSI(prices: number[], periods: number = 14): number {
  if (!prices || prices.length <= periods) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= periods; i++) {
    const diff = prices[i]! - prices[i - 1]!;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / periods;
  let avgLoss = losses / periods;

  for (let i = periods + 1; i < prices.length; i++) {
    const diff = prices[i]! - prices[i - 1]!;
    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (periods - 1) + currentGain) / periods;
    avgLoss = (avgLoss * (periods - 1) + currentLoss) / periods;
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  return Number.isNaN(rsi) ? 50 : rsi;
}

export function calculateVWAP(data: { price: number; volume: number }[]): number {
  if (!data || data.length === 0) return 0;

  let totalPV = 0;
  let totalVolume = 0;

  for (const item of data) {
    if (item.price > 0 && item.volume > 0) {
      totalPV += item.price * item.volume;
      totalVolume += item.volume;
    }
  }

  if (totalVolume === 0) return data[0]?.price ?? 0;
  return totalPV / totalVolume;
}

export function calculateBollingerBands(
  prices: number[],
  periods: number = 20,
  multiplier: number = 2
): BollingerBands {
  const defaultVal = prices[prices.length - 1] ?? 0;
  if (!prices || prices.length < 2) {
    return { upper: defaultVal, lower: defaultVal, basis: defaultVal };
  }

  const windowSize = Math.min(prices.length, periods);
  const windowSlice = prices.slice(-windowSize);
  const basis = windowSlice.reduce((sum, val) => sum + val, 0) / windowSize;
  const variance = windowSlice.reduce((sum, val) => sum + Math.pow(val - basis, 2), 0) / windowSize;
  const stdDev = Math.sqrt(variance);

  return {
    basis,
    upper: basis + stdDev * multiplier,
    lower: basis - stdDev * multiplier,
  };
}

export function resolveMarketRegime(hurstExponent: number): MarketRegime {
  if (hurstExponent > 0.55) return 'TRENDING';
  if (hurstExponent < 0.45) return 'REVERTING';
  return 'RANDOM';
}

/**
 * Stateful per-symbol indicator engine. Updates on every Binance tick.
 */
export class IndicatorCalculator {
  private priceHistory: number[] = [];
  private volumeSamples: { price: number; volume: number }[] = [];
  private lastQuoteVolume24h = 0;

  constructor(private readonly symbol: string) {}

  updateFromTick(tick: BinanceTickerTick): MarketMetricsPayload {
    const price = tick.price;

    if (this.priceHistory.length === 0 || this.priceHistory[this.priceHistory.length - 1] !== price) {
      this.priceHistory.push(price);
      if (this.priceHistory.length > MAX_HISTORY) {
        this.priceHistory.shift();
        this.volumeSamples.shift();
      }
    }

    const quoteDelta =
      this.lastQuoteVolume24h > 0
        ? Math.max(tick.quoteVolume24h - this.lastQuoteVolume24h, 0)
        : tick.quoteVolume24h * 0.0001;

    this.lastQuoteVolume24h = tick.quoteVolume24h;

    const tickVolume = quoteDelta > 0 ? quoteDelta : Math.max(tick.volume24h * 0.00001, 1);
    const lastSample = this.volumeSamples[this.volumeSamples.length - 1];

    if (lastSample && lastSample.price === price) {
      lastSample.volume += tickVolume;
    } else {
      this.volumeSamples.push({ price, volume: tickVolume });
      if (this.volumeSamples.length > MAX_HISTORY) {
        this.volumeSamples.shift();
      }
    }

    const hurstExponent = calculateHurstExponent(this.priceHistory);
    const rsi = calculateRSI(this.priceHistory);
    const vwap = calculateVWAP(this.volumeSamples);
    const bollingerBands = calculateBollingerBands(this.priceHistory);
    const marketRegime = resolveMarketRegime(hurstExponent);

    return {
      symbol: this.symbol.toUpperCase(),
      price,
      high24h: tick.high24h,
      low24h: tick.low24h,
      changePercent: tick.changePercent,
      volume24h: tick.volume24h,
      lastUpdated: new Date(tick.eventTime || Date.now()).toISOString(),
      hurstExponent,
      rsi,
      vwap,
      marketRegime,
      bollingerBands,
      priceHistoryLength: this.priceHistory.length,
    };
  }
}
