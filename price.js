const fetch = require('node-fetch');

const MARKETS = {
  NEET: { symbol:'NEET', name:'$NEET', source:'dexscreener', pair:'5wNu5QhdpRGrL37ffcd6TMMqZugQgxwafgz477rShtHy' },
  BTC:  { symbol:'BTC',  name:'Bitcoin',     source:'multi', ids:['BTCUSDT','BTC-USD','bitcoin'] },
  SOL:  { symbol:'SOL',  name:'Solana',      source:'multi', ids:['SOLUSDT','SOL-USD','solana'] },
  HYPE: { symbol:'HYPE', name:'Hyperliquid', source:'multi', ids:['HYPEUSDT','HYPE-USD','hyperliquid'] },
};

const cache = {};

async function fetchBinance(symbol) {
  const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, { timeout: 6000 });
  const d = await res.json();
  const p = parseFloat(d?.price);
  if (!p || isNaN(p)) throw new Error(`Binance bad: ${JSON.stringify(d).slice(0,80)}`);
  return p;
}

async function fetchCoinbase(id) {
  const res = await fetch(`https://api.coinbase.com/v2/prices/${id}/spot`, { timeout: 6000 });
  const d = await res.json();
  const p = parseFloat(d?.data?.amount);
  if (!p || isNaN(p)) throw new Error(`Coinbase bad: ${JSON.stringify(d).slice(0,80)}`);
  return p;
}

async function fetchCoingecko(id) {
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`, { timeout: 6000 });
  const d = await res.json();
  const p = d?.[id]?.usd;
  if (!p || isNaN(p)) throw new Error(`CoinGecko bad: ${JSON.stringify(d).slice(0,80)}`);
  return p;
}

async function getPrice(marketSymbol = 'NEET') {
  const market = MARKETS[marketSymbol];
  if (!market) throw new Error(`Unknown market: ${marketSymbol}`);

  if (cache[marketSymbol] && Date.now() - cache[marketSymbol].ts < 15000) {
    return cache[marketSymbol].price;
  }

  try {
    let price = null;

    if (market.source === 'dexscreener') {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${market.pair}`, { timeout: 8000 });
      const data = await res.json();
      price = parseFloat(data?.pair?.priceUsd);
      if (!price || isNaN(price)) throw new Error('DexScreener bad price');
    }

    if (market.source === 'multi') {
      const [binanceId, coinbaseId, geckoId] = market.ids;
      // Try each source in order
      const sources = [
        () => fetchBinance(binanceId),
        () => fetchCoinbase(coinbaseId),
        () => fetchCoingecko(geckoId),
      ];
      for (const fn of sources) {
        try { price = await fn(); if (price) break; }
        catch(e) { console.log(`[price] ${marketSymbol} source failed: ${e.message}`); }
      }
    }

    if (!price || isNaN(price)) throw new Error('All sources failed');
    cache[marketSymbol] = { price, ts: Date.now() };
    console.log(`[price] ${marketSymbol}: $${price}`);
    return price;

  } catch (e) {
    console.error(`[price] ${marketSymbol} FINAL FAIL:`, e.message);
    if (cache[marketSymbol]) return cache[marketSymbol].price;
    return null;
  }
}

module.exports = { getPrice, MARKETS };
