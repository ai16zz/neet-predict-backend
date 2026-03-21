const db = require('./db');
const { getPrice } = require('./price');
const { sendPayout } = require('./solana');

const ROUND_DURATION = 5 * 60 * 1000; // 5 minutes
const FEE = parseFloat(process.env.FEE || '0.03');
const MIN_BET = parseFloat(process.env.MIN_BET || '0.05');

function getCurrentRound() {
  return db.prepare('SELECT * FROM rounds WHERE settled = 0 ORDER BY id DESC LIMIT 1').get();
}

function getRoundById(id) {
  return db.prepare('SELECT * FROM rounds WHERE id = ?').get(id);
}

function getRecentRounds(limit = 10) {
  return db.prepare('SELECT * FROM rounds WHERE settled = 1 ORDER BY id DESC LIMIT ?').all(limit);
}

function getBetsForRound(roundId) {
  return db.prepare('SELECT * FROM bets WHERE round_id = ?').all(roundId);
}

function getPositionsForWallet(wallet) {
  return db.prepare(`
    SELECT b.*, r.outcome, r.start_price, r.end_price, r.end_time
    FROM bets b
    JOIN rounds r ON b.round_id = r.id
    WHERE b.wallet = ?
    ORDER BY b.id DESC
    LIMIT 20
  `).all(wallet);
}

async function startNewRound() {
  const now = Date.now();
  const endTime = now + ROUND_DURATION;
  const startPrice = await getPrice();

  const result = db.prepare(
    'INSERT INTO rounds (start_time, end_time, start_price) VALUES (?, ?, ?)'
  ).run(now, endTime, startPrice);

  console.log(`[rounds] New round #${result.lastInsertRowid} started. Price: $${startPrice}`);
  return result.lastInsertRowid;
}

async function settleRound(roundId) {
  const round = getRoundById(roundId);
  if (!round || round.settled) return;

  const endPrice = await getPrice();
  if (!endPrice) {
    console.error('[rounds] Could not get price for settlement, retrying in 30s...');
    setTimeout(() => settleRound(roundId), 30000);
    return;
  }

  let outcome = 'DRAW';
  if (endPrice > round.start_price) outcome = 'UP';
  else if (endPrice < round.start_price) outcome = 'DOWN';

  db.prepare(
    'UPDATE rounds SET end_price = ?, outcome = ?, settled = 1 WHERE id = ?'
  ).run(endPrice, outcome, roundId);

  console.log(`[rounds] Round #${roundId} settled. Outcome: ${outcome} ($${round.start_price} → $${endPrice})`);

  // Pay out winners
  await payoutWinners(roundId, outcome);
}

async function payoutWinners(roundId, outcome) {
  if (outcome === 'DRAW') {
    // Refund everyone minus fee
    const bets = getBetsForRound(roundId);
    for (const bet of bets) {
      if (bet.paid_out) continue;
      try {
        const refund = bet.amount * (1 - FEE);
        const sig = await sendPayout(bet.wallet, refund);
        db.prepare('UPDATE bets SET paid_out = 1, payout_sig = ? WHERE id = ?').run(sig, bet.id);
        console.log(`[rounds] Refund ${refund.toFixed(4)} SOL → ${bet.wallet}`);
      } catch (e) {
        console.error(`[rounds] Payout failed for bet ${bet.id}:`, e.message);
      }
    }
    return;
  }

  const bets = getBetsForRound(roundId);
  const winners = bets.filter(b => b.direction === outcome);
  const losers = bets.filter(b => b.direction !== outcome);

  const totalWinPool = winners.reduce((s, b) => s + b.amount, 0);
  const totalLosePool = losers.reduce((s, b) => s + b.amount, 0);
  const totalPool = totalWinPool + totalLosePool;
  const payoutPool = totalPool * (1 - FEE);

  for (const bet of winners) {
    if (bet.paid_out) continue;
    try {
      const share = bet.amount / totalWinPool;
      const payout = payoutPool * share;
      const sig = await sendPayout(bet.wallet, payout);
      db.prepare('UPDATE bets SET paid_out = 1, payout_sig = ? WHERE id = ?').run(sig, bet.id);
      console.log(`[rounds] Payout ${payout.toFixed(4)} SOL → ${bet.wallet}`);
    } catch (e) {
      console.error(`[rounds] Payout failed for bet ${bet.id}:`, e.message);
    }
  }
}

async function roundLoop() {
  let current = getCurrentRound();

  if (!current) {
    const id = await startNewRound();
    current = getRoundById(id);
  }

  const now = Date.now();
  const msLeft = current.end_time - now;

  if (msLeft <= 0) {
    await settleRound(current.id);
    setTimeout(roundLoop, 2000);
  } else {
    console.log(`[rounds] Round #${current.id} active. ${Math.round(msLeft / 1000)}s remaining.`);
    setTimeout(async () => {
      await settleRound(current.id);
      setTimeout(roundLoop, 2000);
    }, msLeft);
  }
}

module.exports = { roundLoop, getCurrentRound, getRoundById, getRecentRounds, getBetsForRound, getPositionsForWallet, MIN_BET };
