const fetch = require('node-fetch');

const PAIR = '5wNu5QhdpRGrL37ffcd6TMMqZugQgxwafgz477rShtHy';

async function getPrice() {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${PAIR}`, {
      timeout: 8000
    });
    const data = await res.json();
    const price = parseFloat(data?.pair?.priceUsd);
    if (!price || isNaN(price)) throw new Error('Bad price');
    return price;
  } catch (e) {
    console.error('[price] fetch failed:', e.message);
    return null;
  }
}

module.exports = { getPrice };
