require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { getPrice } = require('./price');
const { verifyDeposit } = require('./solana');
const { roundLoop, getCurrentRound, getRecentRounds, getBetsForRound, getPositionsForWallet, MIN_BET } = require('./rounds');

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

// ── Health check ──────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Current round ─────────────────────────────────────────
app.get('/round/current', async (req, res) => {
  try {
    const round = getCurrentRound();
    if (!round) return res.json({ round: null });

    const bets = getBetsForRound(round.id);
    const totalUp = bets.filter(b => b.direction === 'UP').reduce((s, b) => s + b.amount, 0);
    const totalDown = bets.filter(b => b.direction === 'DOWN').reduce((s, b) => s + b.amount, 0);
    const livePrice = await getPrice();

    res.json({
      round: {
        ...round,
        total_up: totalUp,
        total_down: totalDown,
        live_price: livePrice,
        ms_left: Math.max(0, round.end_time - Date.now()),
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Recent settled rounds ─────────────────────────────────
app.get('/rounds/history', (req, res) => {
  try {
    const rounds = getRecentRounds(10);
    res.json({ rounds });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Place a bet ───────────────────────────────────────────
app.post('/bet', async (req, res) => {
  try {
    const { wallet, direction, amount, tx_sig } = req.body;

    if (!wallet || !direction || !amount || !tx_sig) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    if (!['UP', 'DOWN'].includes(direction)) {
      return res.status(400).json({ error: 'direction must be UP or DOWN' });
    }
    if (amount < MIN_BET) {
      return res.status(400).json({ error: `Minimum bet is ${MIN_BET} SOL` });
    }

    const round = getCurrentRound();
    if (!round) return res.status(400).json({ error: 'No active round' });

    const msLeft = round.end_time - Date.now();
    if (msLeft < 10000) {
      return res.status(400).json({ error: 'Round closing — too late to bet' });
    }

    // Check tx not already used
    const existing = db.prepare('SELECT id FROM bets WHERE tx_sig = ?').get(tx_sig);
    if (existing) return res.status(400).json({ error: 'Transaction already used' });

    // Verify on-chain deposit
    const verified = await verifyDeposit(tx_sig, wallet, amount);
    if (!verified) {
      return res.status(400).json({ error: 'Could not verify transaction. Make sure it is confirmed.' });
    }

    db.prepare(
      'INSERT INTO bets (round_id, wallet, direction, amount, tx_sig, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(round.id, wallet, direction, verified.amount, tx_sig, Date.now());

    console.log(`[bet] ${wallet} → ${direction} ${verified.amount} SOL (round #${round.id})`);
    res.json({ success: true, round_id: round.id });

  } catch (e) {
    console.error('[bet] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Wallet positions ──────────────────────────────────────
app.get('/positions/:wallet', (req, res) => {
  try {
    const positions = getPositionsForWallet(req.params.wallet);
    res.json({ positions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Price ─────────────────────────────────────────────────
app.get('/price', async (req, res) => {
  const price = await getPrice();
  res.json({ price });
});

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] NEET predict backend running on port ${PORT}`);
  roundLoop();
});
