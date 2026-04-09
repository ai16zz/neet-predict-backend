require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { getPrice, MARKETS } = require('./price');
const { verifyDeposit, sendPayout, connection } = require('./solana');
const db = require('./db');
const { marketLoop, getCurrentRound, getRecentRounds, getBetsForRound, MIN_BET } = require('./rounds');
const walletWatcher = require('./walletWatcher');

const app = express();
const PORT = process.env.PORT || 3001;
const FEE = parseFloat(process.env.FEE || '0.03');

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok', markets: Object.keys(MARKETS) }));

// ── Markets list ──────────────────────────────────────────
app.get('/markets', (_, res) => res.json({ markets: MARKETS }));

// ── Current round for a market ────────────────────────────
app.get('/round/current', async (req, res) => {
  const market = (req.query.market || 'NEET').toUpperCase();
  try {
    const round = await getCurrentRound(market);
    if (!round) return res.json({ round: null });
    const bets = await getBetsForRound(round.id);
    const total_up = bets.filter(b=>b.direction==='UP').reduce((s,b)=>s+b.amount,0);
    const total_down = bets.filter(b=>b.direction==='DOWN').reduce((s,b)=>s+b.amount,0);
    const live_price = await getPrice(market);
    res.json({ round: { ...round, total_up, total_down, live_price, ms_left: Math.max(0, round.end_time - Date.now()) }});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Round history ─────────────────────────────────────────
app.get('/rounds/history', async (req, res) => {
  const market = (req.query.market || 'NEET').toUpperCase();
  try { res.json({ rounds: await getRecentRounds(market, 10) }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Place bet ─────────────────────────────────────────────
app.post('/bet', async (req, res) => {
  try {
    const { wallet, direction, amount, tx_sig, market = 'NEET' } = req.body;
    const mkt = market.toUpperCase();
    if (!wallet||!direction||!amount||!tx_sig) return res.status(400).json({ error:'Missing fields' });
    if (!['UP','DOWN'].includes(direction)) return res.status(400).json({ error:'direction must be UP or DOWN' });
    if (amount < MIN_BET) return res.status(400).json({ error:`Minimum bet is ${MIN_BET} SOL` });
    if (!MARKETS[mkt]) return res.status(400).json({ error:`Unknown market: ${mkt}` });
    const round = await getCurrentRound(mkt);
    if (!round) return res.status(400).json({ error:'No active round' });
    if (round.end_time - Date.now() < 10000) return res.status(400).json({ error:'Round closing — too late to bet' });
    if (await db.getBetByTxSig(tx_sig)) return res.status(400).json({ error:'Transaction already used' });
    const verified = await verifyDeposit(tx_sig, wallet, amount);
    if (!verified) return res.status(400).json({ error:'Could not verify transaction' });
    const newBet = await db.insertBet({ round_id:round.id, wallet, direction, amount:verified.amount, tx_sig });
    console.log(`[bet] ${mkt} ${wallet.slice(0,8)} → ${direction} ${verified.amount} SOL`);
    res.json({ success:true, round_id:round.id, bet_id:newBet.id });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── Positions ─────────────────────────────────────────────
app.get('/positions/:wallet', async (req, res) => {
  try { res.json({ positions: await db.getPositionsForWallet(req.params.wallet) }); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

// ── Price ─────────────────────────────────────────────────
app.get('/price', async (req, res) => {
  const market = (req.query.market || 'NEET').toUpperCase();
  res.json({ price: await getPrice(market), market });
});

// ── Early sell ────────────────────────────────────────────
app.post('/exit', async (req, res) => {
  try {
    const { wallet, bet_id } = req.body;
    if (!wallet||!bet_id) return res.status(400).json({ error:'Missing fields' });
    const bet = await db.getBetById(bet_id);
    if (!bet) return res.status(404).json({ error:'Bet not found' });
    if (bet.wallet !== wallet) return res.status(403).json({ error:'Not your bet' });
    if (bet.paid_out||bet.exited) return res.status(400).json({ error:'Already settled' });
    const round = await db.getRoundById(bet.round_id);
    if (!round || round.settled) return res.status(400).json({ error:'Round already settled' });
    if (round.end_time - Date.now() < 15000) return res.status(400).json({ error:'Too close to settlement' });
    const bets = await getBetsForRound(round.id);
    const totalUp = bets.filter(b=>b.direction==='UP'&&!b.exited).reduce((s,b)=>s+b.amount,0);
    const totalDown = bets.filter(b=>b.direction==='DOWN'&&!b.exited).reduce((s,b)=>s+b.amount,0);
    const total = totalUp + totalDown;
    const myPool = bet.direction==='UP' ? totalUp : totalDown;
    const multiplier = myPool>0 ? (total*(1-FEE))/myPool : 1;
    const payout = Math.max(Math.min(bet.amount*multiplier, bet.amount*1.95), bet.amount*0.5);
    await db.updateBet(bet_id, { exited:1, paid_out:1 });
    const sig = await sendPayout(wallet, payout);
    await db.updateBet(bet_id, { payout_sig:sig });
    res.json({ success:true, payout, signature:sig });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── Blockhash + send-tx proxies ───────────────────────────
app.get('/blockhash', async (_, res) => {
  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    res.json({ blockhash, lastValidBlockHeight });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/send-tx', async (req, res) => {
  try {
    const raw = Buffer.from(req.body.tx);
    const signature = await connection.sendRawTransaction(raw);
    await connection.confirmTransaction(signature, 'confirmed');
    res.json({ signature });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── Start all market loops ────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] NEET predict backend running on port ${PORT}`);
  // Start a round loop for each market
  Object.keys(MARKETS).forEach(market => {
    console.log(`[server] Starting market loop: ${market}`);
    marketLoop(market);
  });
  // Start cartel wallet buy watcher
  try { walletWatcher.start(); }
  catch (e) { console.error('[server] walletWatcher failed to start:', e); }
});
