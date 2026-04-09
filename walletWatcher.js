// walletWatcher.js — 24/7 on-chain buy detector for NEET Cartel wallets
// Polls Solana RPC every POLL_MS seconds, detects real DEX buys, pings Telegram.
// Ignores incoming transfers, sends, and dust.

const { Connection, PublicKey } = require('@solana/web3.js');
const fetch = require('node-fetch');

// ── CONFIG ─────────────────────────────────────────────────────
const RPC_URL =
  (process.env.RPC_URL && !process.env.RPC_URL.includes('ankr'))
    ? process.env.RPC_URL
    : 'https://api.mainnet-beta.solana.com';

const TG_TOKEN   = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID   || '';

const POLL_MS        = parseInt(process.env.WATCHER_POLL_MS || '15000', 10);
const MIN_SOL_SPEND  = parseFloat(process.env.WATCHER_MIN_SOL || '0.01');
const LAMPORTS_PER_SOL = 1_000_000_000;

// NEET Cartel — full list. Name : wallet.
const WALLETS = [
  { name: 'logjam',          addr: '5fkAwNVpT8A1UHEnY62VEFpqgagdoP8FYrv5ideiQp5c', tw: '@_logjam'        },
  { name: 'mitch',           addr: '4Be9CvxqHW6BYiRAxW9Q3xu1ycTMWaL5z8NX4HR3ha7t', tw: null             },
  { name: 'remus',           addr: 'BCrTEXmWutwPz8qv6w1S5gDbaLnSLpXKM5kSGVWyyfxu', tw: '@remusofmars'   },
  { name: 'neetguy',         addr: '8fR8rFuNvKg9Y2B19nwei9W9xRY3ViD3bhyLytD1V8CM', tw: '@theneetguy'    },
  { name: 'mattertrades',    addr: 'AA3HCUzD6CfgN5vTrsgsm77r1Tf1H7hSBBKdrbmQDUQd', tw: '@Mattertrades'  },
  { name: 'hugo martingale', addr: 'Au1GUWfcadx7jMzhsg6gHGUgViYJrnPfL1vbdqnvLK4i', tw: '@HugoMartingale'},
];

// Known DEX / aggregator program IDs we count as a "buy"
const DEX_PROGRAMS = new Set([
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',   // Jupiter v6
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',   // Jupiter v4
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',  // Raydium AMM v4
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',  // Raydium CPMM
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',  // Raydium CLMM
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',   // Pump.fun bonding curve
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',   // PumpSwap AMM
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',   // Meteora DLMM
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',   // Orca Whirlpool
]);

// Native SOL and wrapped SOL mint — we don't treat these as "buys"
const SOL_MINTS = new Set([
  'So11111111111111111111111111111111111111112',   // wSOL
]);

const connection = new Connection(RPC_URL, 'confirmed');

// ── STATE ──────────────────────────────────────────────────────
// wallet addr -> last seen signature (so we only alert on NEW txs)
const lastSig = new Map();
// signatures we've already processed this session (safety dedup)
const processed = new Set();

// ── TELEGRAM ───────────────────────────────────────────────────
async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT_ID) {
    console.warn('[watcher] TG_TOKEN or TG_CHAT_ID missing — skipping send');
    return;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
    if (!r.ok) console.warn('[watcher] tg failed:', r.status, await r.text());
  } catch (e) {
    console.warn('[watcher] tg error:', e.message);
  }
}

// ── DEXSCREENER LOOKUP (for nicer alerts) ──────────────────────
async function dexInfo(mint) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const d = await r.json();
    const p = (d.pairs || []).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (!p) return null;
    return {
      symbol: p.baseToken?.symbol || '?',
      name:   p.baseToken?.name   || '?',
      mc:     p.marketCap || p.fdv || 0,
      priceUsd: parseFloat(p.priceUsd || '0'),
      pair: p.pairAddress || '',
    };
  } catch (e) {
    return null;
  }
}

function fmtMC(n) {
  if (!n) return '?';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

// ── CLASSIFY A TRANSACTION ─────────────────────────────────────
// Returns {isBuy, mint, tokenDelta, solSpent} or null.
function classifyBuy(tx, walletAddr) {
  try {
    if (!tx || !tx.meta || tx.meta.err) return null;

    const msg = tx.transaction.message;
    const keys = (msg.accountKeys || msg.staticAccountKeys || []).map(k =>
      typeof k === 'string' ? k : k.pubkey?.toString?.() || k.toString()
    );
    const walletIdx = keys.indexOf(walletAddr);
    if (walletIdx < 0) return null;

    // 1. Is a DEX program in the account keys?
    const touchedDex = keys.some(k => DEX_PROGRAMS.has(k));
    if (!touchedDex) return null;

    // 2. SOL balance change for this wallet
    const preSol  = tx.meta.preBalances[walletIdx]  || 0;
    const postSol = tx.meta.postBalances[walletIdx] || 0;
    const solDelta = (postSol - preSol) / LAMPORTS_PER_SOL; // negative = spent SOL
    if (solDelta > -MIN_SOL_SPEND) return null; // not enough SOL out to count

    // 3. Token balance changes for this wallet
    const pre  = tx.meta.preTokenBalances  || [];
    const post = tx.meta.postTokenBalances || [];
    const walletPre  = pre .filter(b => b.owner === walletAddr);
    const walletPost = post.filter(b => b.owner === walletAddr);

    // Find a token where post > pre (new balance or increase), excluding wSOL
    let bought = null;
    for (const p of walletPost) {
      if (SOL_MINTS.has(p.mint)) continue;
      const prior = walletPre.find(x => x.mint === p.mint);
      const preAmt  = prior ? parseFloat(prior.uiTokenAmount.uiAmountString || '0') : 0;
      const postAmt = parseFloat(p.uiTokenAmount.uiAmountString || '0');
      if (postAmt > preAmt) {
        bought = { mint: p.mint, delta: postAmt - preAmt };
        break;
      }
    }
    if (!bought) return null;

    return {
      isBuy: true,
      mint: bought.mint,
      tokenDelta: bought.delta,
      solSpent: Math.abs(solDelta),
    };
  } catch (e) {
    return null;
  }
}

// ── PROCESS ONE TX ─────────────────────────────────────────────
async function processSig(wallet, sig) {
  if (processed.has(sig)) return;
  processed.add(sig);
  if (processed.size > 5000) {
    // trim to avoid unbounded growth
    const arr = [...processed];
    processed.clear();
    arr.slice(-2500).forEach(s => processed.add(s));
  }

  const tx = await connection.getTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  });
  const verdict = classifyBuy(tx, wallet.addr);
  if (!verdict || !verdict.isBuy) return;

  const info = await dexInfo(verdict.mint);
  const sym  = info ? '$' + info.symbol : verdict.mint.slice(0, 6) + '…';
  const mc   = info ? fmtMC(info.mc) : '?';
  const dexUrl = info && info.pair
    ? `https://dexscreener.com/solana/${info.pair}`
    : `https://dexscreener.com/solana/${verdict.mint}`;

  const msg =
    `🟢 *${wallet.name.toUpperCase()} BUY*\n` +
    `Token: *${sym}*\n` +
    `MC: ${mc}\n` +
    `Spent: ${verdict.solSpent.toFixed(3)} SOL\n` +
    `Got: ${verdict.tokenDelta.toLocaleString()} ${sym}\n` +
    (wallet.tw ? `X: ${wallet.tw}\n` : '') +
    `\n[DexScreener](${dexUrl}) · [Tx](https://solscan.io/tx/${sig})`;

  console.log(`[watcher] BUY ${wallet.name} ${sym} ${verdict.solSpent.toFixed(3)} SOL`);
  await sendTelegram(msg);
}

// ── POLL LOOP ──────────────────────────────────────────────────
async function pollWallet(wallet) {
  try {
    const sigs = await connection.getSignaturesForAddress(
      new PublicKey(wallet.addr),
      { limit: 10 }
    );
    if (!sigs.length) return;

    const prev = lastSig.get(wallet.addr);
    // First run per wallet: record newest sig and don't alert on history
    if (!prev) {
      lastSig.set(wallet.addr, sigs[0].signature);
      return;
    }

    // Collect every sig newer than prev, oldest first
    const fresh = [];
    for (const s of sigs) {
      if (s.signature === prev) break;
      fresh.push(s.signature);
    }
    if (!fresh.length) return;

    lastSig.set(wallet.addr, sigs[0].signature);
    fresh.reverse();
    for (const sig of fresh) {
      await processSig(wallet, sig);
    }
  } catch (e) {
    console.warn(`[watcher] ${wallet.name} poll error:`, e.message);
  }
}

async function tick() {
  for (const w of WALLETS) {
    await pollWallet(w);
    // small stagger so we don't hammer RPC with 6 concurrent calls
    await new Promise(r => setTimeout(r, 300));
  }
}

function start() {
  console.log(`[watcher] starting — ${WALLETS.length} wallets, poll ${POLL_MS}ms, RPC ${RPC_URL.slice(0, 50)}`);
  // Prime state so we don't spam historical txs on boot
  tick().then(() => {
    setInterval(tick, POLL_MS);
  });
}

module.exports = { start };
