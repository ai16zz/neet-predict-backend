const fetch = require('node-fetch');

const MARKETS = {
  NEET: { symbol:'NEET', name:'$NEET', source:'dexscreener', pair:'5wNu5QhdpRGrL37ffcd6TMMqZugQgxwafgz477rShtHy', chain:'solana' },
  BTC:  { symbol:'BTC',  name:'Bitcoin',    source:'binance', id:'BTCUSDT' },
  SOL:  { symbol:'SOL',  name:'Solana',     source:'binance', id:'SOLUSDT' },
  HYPE: { symbol:'HYPE', name:'Hyperliquid',source:'binance', id:'HYPEUSDT' },
};

// Cache prices for 10s to avoid rate limits
const cache = {};

async function getPrice(marketSymbol = 'NEET') {
  const market = MARKETS[marketSymbol];
  if (!market) throw new Error(`Unknown market: ${marketSymbol}`);

  // Return cache if fresh
  if (cache[marketSymbol] && Date.now() - cache[marketSymbol].ts < 10000) {
    return cache[marketSymbol].price;
  }

  try {
    let price = null;

    if (market.source === 'dexscreener') {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${market.pair}`, { timeout: 8000 });
      const data = await res.json();
      price = parseFloat(data?.pair?.priceUsd);
    }

    if (market.source === 'binance') {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${market.id}`, { timeout: 8000 });
      const data = await res.json();
      price = parseFloat(data?.price);
    }

    if (!price || isNaN(price)) throw new Error('Bad price');
    cache[marketSymbol] = { price, ts: Date.now() };
    return price;

  } catch (e) {
    console.error(`[price] ${marketSymbol} failed:`, e.message);
    // Return stale cache if available
    if (cache[marketSymbol]) return cache[marketSymbol].price;
    return null;
  }
}

module.exports = { getPrice, MARKETS };
