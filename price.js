const fetch = require('node-fetch');

// Market configs - all prices in USD
const MARKETS = {
  NEET: {
    symbol: 'NEET',
    name: '$NEET',
    source: 'dexscreener',
    pair: '5wNu5QhdpRGrL37ffcd6TMMqZugQgxwafgz477rShtHy',
    chain: 'solana',
  },
  BTC: {
    symbol: 'BTC',
    name: 'Bitcoin',
    source: 'coingecko',
    id: 'bitcoin',
  },
  SOL: {
    symbol: 'SOL',
    name: 'Solana',
    source: 'coingecko',
    id: 'solana',
  },
  HYPE: {
    symbol: 'HYPE',
    name: 'Hyperliquid',
    source: 'coingecko',
    id: 'hyperliquid',
  },
};

async function getPrice(marketSymbol = 'NEET') {
  const market = MARKETS[marketSymbol];
  if (!market) throw new Error(`Unknown market: ${marketSymbol}`);

  try {
    if (market.source === 'dexscreener') {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/pairs/${market.chain}/${market.pair}`,
        { timeout: 8000 }
      );
      const data = await res.json();
      const price = parseFloat(data?.pair?.priceUsd);
      if (!price || isNaN(price)) throw new Error('Bad price');
      return price;
    }

    if (market.source === 'coingecko') {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${market.id}&vs_currencies=usd`,
        { timeout: 8000 }
      );
      const data = await res.json();
      const price = data?.[market.id]?.usd;
      if (!price || isNaN(price)) throw new Error('Bad price');
      return price;
    }
  } catch (e) {
    console.error(`[price] ${marketSymbol} fetch failed:`, e.message);
    return null;
  }
}

module.exports = { getPrice, MARKETS };
