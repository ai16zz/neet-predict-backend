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
  const round = await insertRound({ start_time: now, end_time: now + ROUND_DURATION, start_price: startPrice });
  console.log(`[rounds] New round #${round.id} started. Price: $${startPrice}`);
  return round;
}

async function settleRound(roundId) {
  const round = await getRoundById(roundId);
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

  await updateRound(roundId, { end_price: endPrice, outcome, settled: 1 });
  console.log(`[rounds] Round #${roundId} settled: ${outcome} ($${round.start_price} → $${endPrice})`);

  await payoutWinners(roundId, outcome);
}

async function payoutWinners(roundId, outcome) {
  const bets = await getBetsForRound(roundId);
  if (!bets.length) return;

  if (outcome === 'DRAW') {
    for (const bet of bets) {
      if (bet.paid_out) continue;
      try {
        const sig = await sendPayout(bet.wallet, bet.amount);
        await updateBet(bet.id, { paid_out: 1, payout_sig: sig });
        console.log(`[rounds] DRAW refund ${bet.amount} SOL → ${bet.wallet}`);
      } catch (e) { console.error(`[rounds] Refund failed bet#${bet.id}: ${e.message}`); }
    }
    return;
  }

  const winners = bets.filter(b => b.direction === outcome && !b.exited);
  const losers = bets.filter(b => b.direction !== outcome && !b.exited);
  const totalAll = bets.filter(b => !b.exited).reduce((s, b) => s + b.amount, 0);
  const totalWin = winners.reduce((s, b) => s + b.amount, 0);

  // One-sided: refund everyone
  if (winners.length === 0 || losers.length === 0) {
    console.log(`[rounds] One-sided round #${roundId} — refunding all`);
    for (const bet of bets) {
      if (bet.paid_out || bet.exited) continue;
      try {
        const sig = await sendPayout(bet.wallet, bet.amount);
        await updateBet(bet.id, { paid_out: 1, payout_sig: sig });
        console.log(`[rounds] Full refund ${bet.amount} SOL → ${bet.wallet}`);
      } catch (e) { console.error(`[rounds] Refund failed bet#${bet.id}: ${e.message}`); }
    }
    return;
  }

  const payoutPool = totalAll * (1 - FEE);
  for (const bet of winners) {
    if (bet.paid_out) continue;
    try {
      const payout = payoutPool * (bet.amount / totalWin);
      const sig = await sendPayout(bet.wallet, payout);
      await updateBet(bet.id, { paid_out: 1, payout_sig: sig });
      console.log(`[rounds] Paid ${payout.toFixed(4)} SOL → ${bet.wallet}`);
    } catch (e) { console.error(`[rounds] Payout failed bet#${bet.id}: ${e.message}`); }
  }
}

async function roundLoop() {
  try {
    let current = await getCurrentRound();
    if (!current) current = await startNewRound();
    const msLeft = Math.max(0, current.end_time - Date.now());
    console.log(`[rounds] Round #${current.id} — ${Math.round(msLeft / 1000)}s left`);
    setTimeout(async () => {
      await settleRound(current.id);
      setTimeout(roundLoop, 2000);
    }, msLeft);
  } catch (e) {
    console.error('[roundLoop] error:', e.message);
    setTimeout(roundLoop, 5000);
  }
}

module.exports = { roundLoop, getCurrentRound, getRoundById, getRecentRounds, getBetsForRound, getPositionsForWallet, MIN_BET };
