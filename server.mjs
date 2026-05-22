import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = typeof process === "undefined" ? {} : process.env;
const PORT = Number(env.PORT || 4173);
const PUBLIC_DIR = __dirname;
const DAY = 24 * 60 * 60 * 1000;
const AUTH_COOKIE = "daily_coin_auth";
const AUTH_SECRET = env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const cache = new Map();
let upbitRequestChain = Promise.resolve();
let binanceRequestChain = Promise.resolve();

const sourceNotes = {
  fearGreed: "Alternative.me",
  seasonYear: "BlockchainCenter",
  kimchiPremium: "Upbit / Coinbase / Frankfurter",
  coinbaseRank: "Apple 앱 순위 RSS",
  mvrvz: "BGeometrics / Newhedge",
  ism: "ISM 공식 페이지",
  globalM2: "MetricsMonster",
  dxy: "Yahoo Finance",
  btcRsi: "Binance Spot 8Y 14D RSI",
  btcVolume: "Binance Spot 8Y USDT Volume",
  ethRsi: "Binance Spot 8Y 14D RSI",
  ethVolume: "Binance Spot 8Y USDT Volume",
  xrpRsi: "Binance Spot 8Y 14D RSI",
  xrpVolume: "Binance Spot 8Y USDT Volume",
  solRsi: "Binance Spot 8Y 14D RSI",
  solVolume: "Binance Spot 8Y USDT Volume",
  cryptoTotal1: "CoinGecko / CoinPaprika",
  cryptoTotal2: "CoinGecko / CoinPaprika",
  cryptoTotal3: "CoinGecko / CoinPaprika",
  fundingRate: "Binance / Bybit / OKX Futures"
};

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function daysBack(count) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const d = new Date(now.getTime() - index * DAY);
    return d.toISOString().slice(0, 10);
  });
}

function parseCsv(text) {
  return text.trim().split(/\r?\n/).slice(1).map((line) => {
    const cols = [];
    let current = "";
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) {
        cols.push(current);
        current = "";
      } else current += ch;
    }
    cols.push(current);
    return cols;
  });
}

async function fetchText(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "DailyCoin/1.0",
      accept: "application/json,text/plain,text/html,*/*",
      ...options.headers
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  return JSON.parse(text);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchUpbitJson(url) {
  const run = upbitRequestChain.then(async () => {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const data = await fetchJson(url);
        await delay(140);
        return data;
      } catch (error) {
        lastError = error;
        if (!String(error.message || error).includes("429")) throw error;
        await delay(700 * (attempt + 1));
      }
    }
    throw lastError;
  });
  upbitRequestChain = run.catch(() => {});
  return run;
}

function fetchBinanceJson(pathAndQuery) {
  const run = binanceRequestChain.then(async () => {
    let lastError = null;
    for (const baseUrl of ["https://data-api.binance.vision", "https://api.binance.com"]) {
      try {
        const data = await fetchJson(`${baseUrl}${pathAndQuery}`);
        await delay(120);
        return data;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  });
  binanceRequestChain = run.catch(() => {});
  return run;
}

function latestKnown(rows, date) {
  const candidates = rows
    .filter((row) => row.date <= date && (row.label || (row.value !== null && row.value !== undefined && row.value !== "")))
    .sort((a, b) => b.date.localeCompare(a.date));
  return candidates[0] || null;
}

function latestAny(rows) {
  return rows
    .filter((row) => row.label || (row.value !== null && row.value !== undefined && row.value !== ""))
    .sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

function normalizePercent(value) {
  return Number.isFinite(value) && value > 0 && value <= 1 ? value * 100 : value;
}

async function getBtcDominance() {
  let value = null;
  try {
    const json = await fetchJson("https://api.coingecko.com/api/v3/global");
    value = Number(json?.data?.market_cap_percentage?.btc);
  } catch (error) {
    const json = await fetchJson("https://api.alternative.me/v2/global/");
    value = Number(json?.data?.bitcoin_percentage_of_market_cap);
  }
  value = normalizePercent(value);
  if (!Number.isFinite(value)) throw new Error("BTC dominance data not found");
  return [{ date: todayUtc(), value: Number(value), label: `${Number(value).toFixed(1)}%` }];
}

async function getFearGreed() {
  const json = await fetchJson("https://api.alternative.me/fng/?limit=0&format=json");
  return (json.data || []).map((item) => {
    const date = new Date(Number(item.timestamp) * 1000).toISOString().slice(0, 10);
    return {
      date,
      value: Number(item.value),
      label: `${item.value} (${item.value_classification})`
    };
  });
}

async function getAltSeason() {
  const html = await fetchText("https://www.blockchaincenter.net/en/altcoin-season-index/");
  const normalized = html.replace(/\\"/g, '"');
  const historyMatch = normalized.match(/"90":\{([\s\S]*?)\},"365":/);
  if (historyMatch) {
    const rows = [...historyMatch[1].matchAll(/"(\d{4}-\d{2}-\d{2})":"(\d{1,3})"/g)]
      .map((match) => {
        const value = Number(match[2]);
        return { date: match[1], value, label: `${value}/100` };
      });
    if (rows.length) return rows;
  }
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const match = text.match(/Altcoin Season\s*\(\s*(\d{1,3})\s*\)/i)
    || text.match(/It(?:&#x27;|'|’)s [A-Za-z ]+ Season!\s*(\d{1,3})/i);
  if (!match) throw new Error("Altcoin Season Index not found");
  const value = Number(match[1]);
  return [{ date: todayUtc(), value, label: `${value.toFixed(0)}/100` }];
}

async function getSeasonYear() {
  const html = await fetchText("https://www.blockchaincenter.net/en/altcoin-season-index/");
  const normalized = html.replace(/\\"/g, '"');
  const historyMatch = normalized.match(/"365":\{([\s\S]*?)\}(?:,\")?/);
  if (historyMatch) {
    const rows = [...historyMatch[1].matchAll(/"(\d{4}-\d{2}-\d{2})":"(\d{1,3})"/g)]
      .map((match) => {
        const value = Number(match[2]);
        return { date: match[1], value, label: `${value}/100` };
      });
    if (rows.length) return rows;
  }
  return getAltSeason();
}

async function getCoinbaseRank() {
  const url = "https://rss.applemarketingtools.com/api/v2/us/apps/top-free/100/apps.json";
  const json = await fetchJson(url);
  const apps = json?.feed?.results || [];
  const index = apps.findIndex((app) => /coinbase/i.test(`${app.name} ${app.artistName}`));
  if (index < 0) return [{ date: todayUtc(), value: 101, label: ">100위" }];
  const rank = index + 1;
  return [{ date: todayUtc(), value: rank, label: `#${rank}` }];
}

async function getKimchiPremium() {
  const [upbit, coinbase, fx] = await Promise.all([
    fetchJson("https://api.upbit.com/v1/ticker?markets=KRW-BTC"),
    fetchJson("https://api.coinbase.com/v2/prices/BTC-USD/spot"),
    fetchJson("https://api.frankfurter.app/latest?from=USD&to=KRW")
  ]);
  const krwPrice = Number(upbit?.[0]?.trade_price);
  const usdPrice = Number(coinbase?.data?.amount);
  const usdKrw = Number(fx?.rates?.KRW);
  if (!Number.isFinite(krwPrice) || !Number.isFinite(usdPrice) || !Number.isFinite(usdKrw)) {
    throw new Error("Kimchi premium data not found");
  }
  const value = ((krwPrice / (usdPrice * usdKrw)) - 1) * 100;
  return [{ date: todayUtc(), value, label: `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` }];
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toFixed(0)}`;
}

function formatKrw(value) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 1e12) return `${(value / 1e12).toFixed(2)}조`;
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(1)}억`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(1)}만`;
  return value.toFixed(0);
}

function buildCryptoMarketCapRows(total, btcMarketCap, ethMarketCap) {
  const rows = {
    cryptoTotal1: total,
    cryptoTotal2: total - btcMarketCap,
    cryptoTotal3: total - btcMarketCap - ethMarketCap
  };
  return Object.fromEntries(Object.entries(rows).map(([key, value]) => [
    key,
    [{ date: todayUtc(), value, label: formatUsd(value) }]
  ]));
}

async function getCoinGeckoMarketCaps() {
  const json = await fetchJson("https://api.coingecko.com/api/v3/global");
  const total = Number(json?.data?.total_market_cap?.usd);
  const btcShare = normalizePercent(Number(json?.data?.market_cap_percentage?.btc)) / 100;
  const ethShare = normalizePercent(Number(json?.data?.market_cap_percentage?.eth)) / 100;
  if (!Number.isFinite(total) || !Number.isFinite(btcShare) || !Number.isFinite(ethShare)) {
    throw new Error("Crypto total market cap data not found");
  }
  return buildCryptoMarketCapRows(total, total * btcShare, total * ethShare);
}

async function getCoinPaprikaMarketCaps() {
  const [global, btc, eth] = await Promise.all([
    fetchJson("https://api.coinpaprika.com/v1/global"),
    fetchJson("https://api.coinpaprika.com/v1/tickers/btc-bitcoin"),
    fetchJson("https://api.coinpaprika.com/v1/tickers/eth-ethereum")
  ]);
  const total = Number(global?.market_cap_usd);
  const btcMarketCap = Number(btc?.quotes?.USD?.market_cap);
  const ethMarketCap = Number(eth?.quotes?.USD?.market_cap);
  if (!Number.isFinite(total) || !Number.isFinite(btcMarketCap) || !Number.isFinite(ethMarketCap)) {
    throw new Error("CoinPaprika market cap data not found");
  }
  return buildCryptoMarketCapRows(total, btcMarketCap, ethMarketCap);
}

async function getCryptoMarketCaps() {
  try {
    return await getCoinGeckoMarketCaps();
  } catch {
    return getCoinPaprikaMarketCaps();
  }
}

let cryptoMarketCapsSnapshot = null;

async function getCryptoMarketCapRows(key) {
  if (!cryptoMarketCapsSnapshot) cryptoMarketCapsSnapshot = await getCryptoMarketCaps();
  return cryptoMarketCapsSnapshot[key] || [];
}

async function getMvrvz(start, end) {
  const key = env.BITBO_API_KEY;
  if (key) {
    const url = `https://charts.bitbo.io/api/v1/mvrv-z/?start_date=${start}&end_date=${end}&api_key=${encodeURIComponent(key)}`;
    const json = await fetchJson(url);
    return (json.data || []).map(([date, value]) => ({
      date,
      value: Number(value),
      label: Number(value).toFixed(2)
    }));
  }
  try {
    const json = await fetchJson("https://api.bgeometrics.com/mvrvZscores?size=30&sort=d,desc");
    const rows = (json?._embedded?.mvrvZscores || []).map((item) => {
      const date = item?._links?.self?.href?.match(/(\d{4}-\d{2}-\d{2})$/)?.[1]
        || new Date(Number(item.unixTs) * 1000).toISOString().slice(0, 10);
      const value = Number(item.mvrvZscore);
      return { date, value, label: value.toFixed(2) };
    });
    if (rows.length) return rows;
  } catch (error) {
    // BGeometrics has a small free hourly quota; Newhedge gives a public latest snapshot.
  }
  const text = await fetchText("https://r.jina.ai/http://https://newhedge.io/bitcoin/mvrv-z-score");
  const match = text.match(/#### MVRV Z Score\s+([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) throw new Error("MVRV Z-Score value not found");
  const value = Number(match[1]);
  return [{ date: todayUtc(), value, label: value.toFixed(2) }];
}

async function getIsm() {
  const html = await fetchText("https://go.weareism.org/ism-manufacturing-pmi");
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const match = text.match(/Manufacturing PMI[^0-9]{0,80}([0-9]+(?:\.[0-9]+)?)/i)
    || text.match(/PMI[^0-9]{0,80}([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) throw new Error("ISM PMI value not found");
  const value = Number(match[1]);
  return [{ date: todayUtc(), value, label: value.toFixed(1) }];
}

async function getGlobalM2() {
  const html = await fetchText("https://www.metricsmonster.com/global-liquidity-data");
  const matches = [...html.matchAll(/\$([0-9]+(?:\.[0-9]+)?)T/g)];
  if (!matches.length) throw new Error("Global M2 values not found");
  const total = matches.slice(0, 3).reduce((sum, match) => sum + Number(match[1]), 0);
  return [{ date: todayUtc(), value: total, label: `$${total.toFixed(1)}T` }];
}

async function fetchYahooChart(symbol, range, interval = "1d") {
  const encoded = encodeURIComponent(symbol);
  const path = `/v8/finance/chart/${encoded}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
  try {
    return await fetchJson(`https://query1.finance.yahoo.com${path}`);
  } catch (error) {
    return fetchJson(`https://query2.finance.yahoo.com${path}`);
  }
}

async function getDxy() {
  const json = await fetchYahooChart("DX-Y.NYB", "8y");
  const result = json?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  return timestamps
    .map((time, index) => ({
      date: new Date(time * 1000).toISOString().slice(0, 10),
      value: Number(closes[index]),
      open: Number(opens[index]),
      high: Number(highs[index]),
      low: Number(lows[index]),
      close: Number(closes[index])
    }))
    .filter((row) => (
      Number.isFinite(row.value)
      && Number.isFinite(row.open)
      && Number.isFinite(row.high)
      && Number.isFinite(row.low)
      && row.value > 0
      && row.open > 0
      && row.high > 0
      && row.low > 0
    ))
    .map((row) => ({ ...row, label: row.value.toFixed(2) }));
}

async function getFundingRate() {
  let value = null;
  try {
    const json = await fetchJson("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT");
    value = Number(json?.lastFundingRate) * 100;
  } catch (binanceError) {
    try {
      const json = await fetchJson("https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=1");
      value = Number(json?.result?.list?.[0]?.fundingRate) * 100;
    } catch (bybitError) {
      const json = await fetchJson("https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP");
      value = Number(json?.data?.[0]?.fundingRate) * 100;
    }
  }
  if (!Number.isFinite(value)) throw new Error("Funding rate not found");
  return [{ date: todayUtc(), value, label: `${value >= 0 ? "+" : ""}${value.toFixed(4)}%` }];
}

function calculateRsiRows(priceRows, period = 14) {
  const rows = priceRows
    .map(([time, price]) => ({
      date: new Date(Number(time)).toISOString().slice(0, 10),
      price: Number(price)
    }))
    .filter((row) => Number.isFinite(row.price))
    .sort((a, b) => a.date.localeCompare(b.date));
  const rsiRows = [];
  for (let i = period; i < rows.length; i += 1) {
    let gains = 0;
    let losses = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const change = rows[j].price - rows[j - 1].price;
      if (change >= 0) gains += change;
      else losses += Math.abs(change);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    const value = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    rsiRows.push({ date: rows[i].date, value, label: value.toFixed(1) });
  }
  return rsiRows;
}

function completedDailyPriceRows(timestamps, closes) {
  const today = todayUtc();
  return timestamps
    .map((time, index) => [Number(time) * 1000, Number(closes[index])])
    .filter(([time, price]) => {
      const date = new Date(time).toISOString().slice(0, 10);
      return date < today && Number.isFinite(price) && price > 0;
    });
}

function completedDailyMarketRows(timestamps, closes, volumes) {
  const today = todayUtc();
  return timestamps
    .map((time, index) => ({
      date: new Date(Number(time) * 1000).toISOString().slice(0, 10),
      price: Number(closes[index]),
      volume: Number(volumes[index])
    }))
    .filter((row) => row.date < today && Number.isFinite(row.price) && row.price > 0);
}

const binanceSymbols = {
  bitcoin: "BTCUSDT",
  ethereum: "ETHUSDT",
  ripple: "XRPUSDT",
  solana: "SOLUSDT"
};

const coinMarketRowsCache = new Map();

async function getCoinMarketRows(coinId) {
  const symbol = binanceSymbols[coinId];
  if (!symbol) throw new Error(`${coinId} market symbol not found`);
  if (coinMarketRowsCache.has(symbol)) return coinMarketRowsCache.get(symbol);
  const rowsPromise = getBinanceMarketRows(coinId, symbol);
  coinMarketRowsCache.set(symbol, rowsPromise);
  try {
    const rows = await rowsPromise;
    coinMarketRowsCache.set(symbol, rows);
    return rows;
  } catch (error) {
    coinMarketRowsCache.delete(symbol);
    throw error;
  }
}

async function getBinanceMarketRows(coinId, symbol) {
  const today = todayUtc();
  const cutoffDate = new Date();
  cutoffDate.setUTCFullYear(cutoffDate.getUTCFullYear() - 8);
  let startTime = Date.UTC(cutoffDate.getUTCFullYear(), cutoffDate.getUTCMonth(), cutoffDate.getUTCDate());
  const endTime = Date.now();
  const rows = [];
  const seen = new Set();
  for (let page = 0; page < 5 && startTime < endTime; page += 1) {
    const params = new URLSearchParams({
      symbol,
      interval: "1d",
      limit: "1000",
      startTime: String(startTime),
      endTime: String(endTime)
    });
    const candles = await fetchBinanceJson(`/api/v3/klines?${params.toString()}`);
    if (!Array.isArray(candles) || !candles.length) break;
    for (const candle of candles) {
      const openTime = Number(candle[0]);
      const date = new Date(openTime).toISOString().slice(0, 10);
      const price = Number(candle[4]);
      const volume = Number(candle[7]);
      if (date >= today || seen.has(date) || !Number.isFinite(price) || price <= 0) continue;
      seen.add(date);
      rows.push({ date, price, volume });
    }
    const lastOpenTime = Number(candles[candles.length - 1]?.[0]);
    if (!Number.isFinite(lastOpenTime) || lastOpenTime <= startTime) break;
    startTime = lastOpenTime + DAY;
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) throw new Error(`${coinId} market data not found`);
  return rows;
}

async function getCoinRsi(coinId) {
  const marketRows = await getCoinMarketRows(coinId);
  const priceRows = marketRows.map((row) => [new Date(`${row.date}T00:00:00Z`).getTime(), row.price]);
  const rows = calculateRsiRows(priceRows);
  if (!rows.length) throw new Error(`${coinId} RSI data not found`);
  return rows;
}

async function getCoinVolume(coinId) {
  const rows = await getCoinMarketRows(coinId);
  return rows
    .filter((row) => Number.isFinite(row.volume) && row.volume > 0)
    .map((row) => ({ date: row.date, value: row.volume, label: formatUsd(row.volume) }));
}

async function safeMetric(key, loader) {
  try {
    const rows = await loader();
    return { key, rows, ok: true };
  } catch (error) {
    const fallbackRows = cache.get("history")?.data?.chartHistory?.[key] || [];
    if (fallbackRows.length) {
      return { key, rows: fallbackRows, ok: true, fallback: true, error: error.message };
    }
    return { key, rows: [], ok: false, error: error.message };
  }
}

async function buildHistory() {
  const dates = daysBack(31);
  const start = dates[dates.length - 1];
  const end = dates[0];
  cryptoMarketCapsSnapshot = null;
  coinMarketRowsCache.clear();
  const carryLatestAcrossDates = new Set(["coinbaseRank", "kimchiPremium", "mvrvz", "ism", "globalM2", "fundingRate", "cryptoTotal1", "cryptoTotal2", "cryptoTotal3"]);
  const metrics = await Promise.all([
    safeMetric("btcRsi", () => getCoinRsi("bitcoin")),
    safeMetric("btcVolume", () => getCoinVolume("bitcoin")),
    safeMetric("ethRsi", () => getCoinRsi("ethereum")),
    safeMetric("ethVolume", () => getCoinVolume("ethereum")),
    safeMetric("xrpRsi", () => getCoinRsi("ripple")),
    safeMetric("xrpVolume", () => getCoinVolume("ripple")),
    safeMetric("solRsi", () => getCoinRsi("solana")),
    safeMetric("solVolume", () => getCoinVolume("solana")),
    safeMetric("seasonYear", getSeasonYear),
    safeMetric("kimchiPremium", getKimchiPremium),
    safeMetric("dxy", getDxy),
    safeMetric("cryptoTotal1", () => getCryptoMarketCapRows("cryptoTotal1")),
    safeMetric("cryptoTotal2", () => getCryptoMarketCapRows("cryptoTotal2")),
    safeMetric("cryptoTotal3", () => getCryptoMarketCapRows("cryptoTotal3")),
    safeMetric("coinbaseRank", getCoinbaseRank),
    safeMetric("fearGreed", getFearGreed),
    safeMetric("mvrvz", () => getMvrvz(start, end)),
    safeMetric("fundingRate", getFundingRate),
    safeMetric("ism", getIsm),
    safeMetric("globalM2", getGlobalM2)
  ]);

  const history = dates.map((date) => {
    const values = {};
    for (const metric of metrics) {
      const row = latestKnown(metric.rows, date) || (carryLatestAcrossDates.has(metric.key) ? latestAny(metric.rows) : null);
      values[metric.key] = row
        ? { value: row.value, label: row.label, date: row.date, stale: row.date !== date }
        : { value: null, label: metric.ok ? "데이터 없음" : "연결 필요", error: metric.error };
    }
    return { date, values };
  });

  return {
    generatedAt: new Date().toISOString(),
    dates,
    history,
    chartHistory: Object.fromEntries(metrics.map((metric) => [
      metric.key,
      metric.rows
        .filter((row) => Number.isFinite(Number(row.value)))
        .sort((a, b) => a.date.localeCompare(b.date))
    ])),
    sources: sourceNotes,
    status: Object.fromEntries(metrics.map((m) => [m.key, { ok: m.ok, fallback: Boolean(m.fallback), error: m.error || null }]))
  };
}

async function apiHistory(res) {
  const cached = cache.get("history");
  if (cached && Date.now() - cached.time < 30 * 60 * 1000) {
    sendJson(res, cached.data);
    return;
  }
  const data = await buildHistory();
  cache.set("history", { time: Date.now(), data });
  sendJson(res, data);
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function authToken() {
  return crypto.createHmac("sha256", AUTH_SECRET).update(env.APP_PASSWORD || "").digest("hex");
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map((part) => {
    const [name, ...rest] = part.trim().split("=");
    return [name, decodeURIComponent(rest.join("=") || "")];
  }).filter(([name]) => name));
}

function sameText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isAuthenticated(req) {
  if (!env.APP_PASSWORD) return true;
  return sameText(parseCookies(req)[AUTH_COOKIE] || "", authToken());
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000) {
        req.destroy();
        reject(new Error("Request too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendLoginPage(req, res) {
  const failed = new URL(req.url, `http://${req.headers.host}`).searchParams.get("login") === "failed";
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Daily Coin Login</title>
    <style>
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        background: linear-gradient(145deg, #101213, #16191b 52%, #0f1414);
        color: #f3f5f2;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(360px, calc(100% - 32px));
        padding: 22px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        background: rgba(24, 28, 31, 0.92);
      }
      .logo {
        width: 74px;
        height: 74px;
        display: grid;
        place-items: center;
        margin-bottom: 18px;
        border-radius: 20px;
        background: linear-gradient(155deg, #66d28f, #f0bd5b 58%, #79b8ff);
        color: #101213;
        font-size: 24px;
        font-weight: 900;
      }
      h1 { margin: 0 0 6px; font-size: 26px; }
      p { margin: 0 0 18px; color: #9ea8a5; font-size: 13px; }
      input, button {
        width: 100%;
        height: 46px;
        border-radius: 8px;
        font: inherit;
      }
      input {
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.06);
        color: #f3f5f2;
        padding: 0 12px;
      }
      button {
        margin-top: 10px;
        border: 0;
        background: #66d28f;
        color: #101213;
        font-weight: 900;
      }
      .error { color: #f36f69; }
    </style>
  </head>
  <body>
    <main>
      <div class="logo">DC</div>
      <h1>Daily Coin</h1>
      <p>${failed ? '<span class="error">비밀번호가 맞지 않습니다.</span>' : "비밀번호를 입력하세요."}</p>
      <form method="post" action="/api/login">
        <input name="password" type="password" autocomplete="current-password" placeholder="Password" autofocus>
        <button type="submit">Enter</button>
      </form>
    </main>
  </body>
</html>`);
}

async function handleLogin(req, res) {
  if (!env.APP_PASSWORD) {
    res.writeHead(302, { location: "/" });
    res.end();
    return;
  }
  const body = await readBody(req);
  const password = new URLSearchParams(body).get("password") || "";
  if (!sameText(password, env.APP_PASSWORD)) {
    res.writeHead(302, { location: "/?login=failed" });
    res.end();
    return;
  }
  res.writeHead(302, {
    location: "/",
    "set-cookie": `${AUTH_COOKIE}=${encodeURIComponent(authToken())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${env.NODE_ENV === "production" ? "; Secure" : ""}`
  });
  res.end();
}

function serveStatic(req, res) {
  const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const filePath = path.join(PUBLIC_DIR, urlPath === "/" ? "index.html" : decodeURIComponent(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, buffer) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(buffer);
  });
}

export const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/login") && req.method === "POST") {
    handleLogin(req, res).catch((error) => sendJson(res, { error: error.message }, 500));
    return;
  }
  if (!isAuthenticated(req)) {
    if (req.url.startsWith("/api/")) {
      sendJson(res, { error: "Unauthorized" }, 401);
      return;
    }
    sendLoginPage(req, res);
    return;
  }
  if (req.url.startsWith("/api/history")) {
    apiHistory(res).catch((error) => sendJson(res, { error: error.message }, 500));
    return;
  }
  serveStatic(req, res);
});

if (!env.DONSOL_LALA_NO_LISTEN) {
  server.listen(PORT, () => {
    console.log(`Daily Coin is running at http://localhost:${PORT}`);
  });
}
