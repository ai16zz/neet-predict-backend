const {
  insertRound, updateRound, getCurrentRound, getRoundById,
  getRecentRounds, getBetsForRound, updateBet, getPositionsForWallet
} = require('./db');
const { getPrice } = require('./price');
const { sendPayout } = require('./solana');

const ROUND_DURATION = 5 * 60 * 1000;
const FEE = parseFloat(process.env.FEE || '0.03');
const MIN_BET = parseFloat(process.env.MIN_BET || '0.05');

async function startNewRound() {
  const now = Date.now();
  const startPrice = await getPrice();
  const round = insertRound({ start_time: now, end_time: now + ROUND_DURATION, start_price: startPrice });
  console.log(`[rounds] New round #${round.id} started. Price: $${startPrice}`);
  return round;
}

async function settleRound(roundId) {
  const round = getRoundById(roundId);
  if (!round || round.settled) return;

  const endPrice = await getPrice();
  if (!endPrice) {
    console.error('[rounds] Could not get price, retrying in 30s');
    setTimeout(() => settleRound(roundId), 30000);
    return;
  }

  let outcome = 'DRAW';
  if (endPrice > round.start_price) outcome = 'UP';
  else if (endPrice < round.start_price) outcome = 'DOWN';

  updateRound(roundId, { end_price: endPrice, outcome, settled: 1 });
  console.log(`[rounds] Round #${roundId} settled: ${outcome} ($${round.start_price} → $${endPrice})`);

  await payoutWinners(roundId, outcome, round);
}

async function payoutWinners(roundId, outcome, round) {
  const bets = getBetsForRound(roundId);
  if (!bets.length) return;

  if (outcome === 'DRAW') {
    for (const bet of bets) {
      if (bet.paid_out) continue;
      try {
        const refund = bet.amount * (1 - FEE);
        const sig = await sendPayout(bet.wallet, refund);
        updateBet(bet.id, { paid_out: 1, payout_sig: sig });
        console.log(`[rounds] Refunded ${refund.toFixed(4)} SOL → ${bet.wallet}`);
      } catch (e) {
        console.error(`[rounds] Refund failed bet#${bet.id}: ${e.message}`);
      }
    }
    return;
  }

  const winners = bets.filter(b => b.direction === outcome);
  const losers = bets.filter(b => b.direction !== outcome);
  const totalWin = winners.reduce((s, b) => s + b.amount, 0);
  const totalAll = bets.reduce((s, b) => s + b.amount, 0);

  // If nobody bet the winning side OR nobody bet the losing side = no real game, refund all
  if (winners.length === 0 || losers.length === 0) {
    console.log(`[rounds] One-sided round #${roundId} (${outcome}) — refunding all ${bets.length} bets`);
    for (const bet of bets) {
      if (bet.paid_out) continue;
      try {
        const sig = await sendPayout(bet.wallet, bet.amount);
        updateBet(bet.id, { paid_out: 1, payout_sig: sig });
        console.log(`[rounds] Full refund ${bet.amount} SOL → ${bet.wallet}`);
      } catch (e) {
        console.error(`[rounds] Refund failed bet#${bet.id}: ${e.message}`);
      }
    }
    return;
  }

  const payoutPool = totalAll * (1 - FEE);

  for (const bet of winners) {
    if (bet.paid_out) continue;
    try {
      const payout = payoutPool * (bet.amount / totalWin);
      const sig = await sendPayout(bet.wallet, payout);
      updateBet(bet.id, { paid_out: 1, payout_sig: sig });
      console.log(`[rounds] Paid ${payout.toFixed(4)} SOL → ${bet.wallet}`);
    } catch (e) {
      console.error(`[rounds] Payout failed bet#${bet.id}: ${e.message}`);
    }
  }
}

async function roundLoop() {
  let current = getCurrentRound();
  if (!current) current = await startNewRound();

  const msLeft = Math.max(0, current.end_time - Date.now());
  console.log(`[rounds] Round #${current.id} — ${Math.round(msLeft / 1000)}s left`);

  setTimeout(async () => {
    await settleRound(current.id);
    setTimeout(roundLoop, 2000);
  }, msLeft);
}

module.exports = { roundLoop, getCurrentRound, getRoundById, getRecentRounds, getBetsForRound, getPositionsForWallet, MIN_BET };
