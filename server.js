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

    const newBet = insertBet({ round_id: round.id, wallet, direction, amount: verified.amount, tx_sig });
    console.log(`[bet] ${wallet} → ${direction} ${verified.amount} SOL (round #${round.id})`);
    res.json({ success: true, round_id: round.id, bet_id: newBet.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/positions/:wallet', (req, res) => {
  try { res.json({ positions: getPositionsForWallet(req.params.wallet) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/price', async (_, res) => {
  res.json({ price: await getPrice() });
});

// ── Early exit ────────────────────────────────────────────
app.post('/exit', async (req, res) => {
  try {
    const { wallet, bet_id } = req.body;
    if (!wallet || !bet_id) return res.status(400).json({ error: 'Missing fields' });

    const round = getCurrentRound();
    if (!round) return res.status(400).json({ error: 'No active round' });
    if (round.end_time - Date.now() < 15000) return res.status(400).json({ error: 'Too close to settlement to exit' });

    const { getBetById } = require('./db');
    const bet = getBetById(bet_id);
    if (!bet) return res.status(404).json({ error: 'Bet not found' });
    if (bet.wallet !== wallet) return res.status(403).json({ error: 'Not your bet' });
    if (bet.paid_out) return res.status(400).json({ error: 'Already settled' });
    if (bet.exited) return res.status(400).json({ error: 'Already exited' });
    if (bet.round_id !== round.id) return res.status(400).json({ error: 'Bet is not in current round' });

    // Calculate exit value at current odds
    const bets = getBetsForRound(round.id).filter(b => !b.exited);
    const totalUp = bets.filter(b => b.direction === 'UP').reduce((s, b) => s + b.amount, 0);
    const totalDown = bets.filter(b => b.direction === 'DOWN').reduce((s, b) => s + b.amount, 0);
    const totalPool = totalUp + totalDown;
    const myPool = bet.direction === 'UP' ? totalUp : totalDown;
    const multiplier = myPool > 0 ? (totalPool * (1 - FEE)) / myPool : 1;
    const exitValue = Math.min(bet.amount * multiplier, bet.amount * 1.95); // cap at 1.95x
    const payout = Math.max(exitValue * (1 - FEE), bet.amount * 0.5); // min 50% back

    const { updateBet } = require('./db');
    updateBet(bet_id, { exited: 1, paid_out: 1 });

    const sig = await require('./solana').sendPayout(wallet, payout);
    updateBet(bet_id, { payout_sig: sig });

    console.log(`[exit] ${wallet} exited bet#${bet_id} → ${payout.toFixed(4)} SOL`);
    res.json({ success: true, payout, signature: sig });
  } catch (e) {
    console.error('[exit]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Send TX proxy ─────────────────────────────────────────
app.post('/send-tx', async (req, res) => {
  try {
    const { tx } = req.body;
    if (!tx) return res.status(400).json({ error: 'Missing tx' });
    const { connection } = require('./solana');
    const raw = Buffer.from(tx);
    const signature = await connection.sendRawTransaction(raw, { skipPreflight: false });
    await connection.confirmTransaction(signature, 'confirmed');
    res.json({ signature });
  } catch (e) {
    console.error('[send-tx]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Blockhash proxy (browser can't call RPC directly) ─────
app.get('/blockhash', async (_, res) => {
  try {
    const { connection } = require('./solana');
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    res.json({ blockhash, lastValidBlockHeight });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => {
  console.log(`[server] NEET predict backend running on port ${PORT}`);
  roundLoop();
});
