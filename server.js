require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { getPrice } = require('./price');
const { verifyDeposit } = require('./solana');
const { insertBet, getBetByTxSig, getPositionsForWallet } = require('./db');
const { roundLoop, getCurrentRound, getRecentRounds, getBetsForRound, MIN_BET } = require('./rounds');

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.get('/round/current', async (req, res) => {
  try {
    const round = getCurrentRound();
    if (!round) return res.json({ round: null });
    const bets = getBetsForRound(round.id);
    const total_up = bets.filter(b => b.direction === 'UP').reduce((s, b) => s + b.amount, 0);
    const total_down = bets.filter(b => b.direction === 'DOWN').reduce((s, b) => s + b.amount, 0);
    const live_price = await getPrice();
    res.json({ round: { ...round, total_up, total_down, live_price, ms_left: Math.max(0, round.end_time - Date.now()) } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/rounds/history', (req, res) => {
  try { res.json({ rounds: getRecentRounds(10) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/bet', async (req, res) => {
  try {
    const { wallet, direction, amount, tx_sig } = req.body;
    if (!wallet || !direction || !amount || !tx_sig)
      return res.status(400).json({ error: 'Missing fields' });
    if (!['UP', 'DOWN'].includes(direction))
      return res.status(400).json({ error: 'direction must be UP or DOWN' });
    if (amount < MIN_BET)
      return res.status(400).json({ error: `Minimum bet is ${MIN_BET} SOL` });

    const round = getCurrentRound();
    if (!round) return res.status(400).json({ error: 'No active round' });
    if (round.end_time - Date.now() < 10000)
      return res.status(400).json({ error: 'Round closing — too late to bet' });
    if (getBetByTxSig(tx_sig))
      return res.status(400).json({ error: 'Transaction already used' });

    const verified = await verifyDeposit(tx_sig, wallet, amount);
    if (!verified) return res.status(400).json({ error: 'Could not verify transaction' });

    insertBet({ round_id: round.id, wallet, direction, amount: verified.amount, tx_sig });
    console.log(`[bet] ${wallet} → ${direction} ${verified.amount} SOL (round #${round.id})`);
    res.json({ success: true, round_id: round.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/positions/:wallet', (req, res) => {
  try { res.json({ positions: getPositionsForWallet(req.params.wallet) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/price', async (_, res) => {
  res.json({ price: await getPrice() });
});

app.listen(PORT, () => {
  console.log(`[server] NEET predict backend running on port ${PORT}`);
  roundLoop();
});
