const {
  insertRound, updateRound, getCurrentRound, getRoundById,
  getRecentRounds, getBetsForRound, updateBet
} = require('./db');
const { getPrice } = require('./price');
const { sendPayout } = require('./solana');

const ROUND_DURATION = 5 * 60 * 1000;
const FEE = parseFloat(process.env.FEE || '0.03');
const MIN_BET = parseFloat(process.env.MIN_BET || '0.05');

async function startNewRound(market) {
  const now = Date.now();
  const startPrice = await getPrice(market);
  const round = await insertRound({ start_time: now, end_time: now + ROUND_DURATION, start_price: startPrice, market });
  console.log(`[${market}] New round #${round.id} started. Price: $${startPrice}`);
  return round;
}

async function settleRound(roundId, market) {
  const round = await getRoundById(roundId);
  if (!round || round.settled) return;

  const endPrice = await getPrice(market);
  if (!endPrice) {
    console.error(`[${market}] Could not get price, retrying in 30s`);
    setTimeout(() => settleRound(roundId, market), 30000);
    return;
  }

  let outcome = 'DRAW';
  if (endPrice > round.start_price) outcome = 'UP';
  else if (endPrice < round.start_price) outcome = 'DOWN';

  await updateRound(roundId, { end_price: endPrice, outcome, settled: 1 });
  console.log(`[${market}] Round #${roundId} settled: ${outcome} ($${round.start_price} → $${endPrice})`);
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
      } catch (e) { console.error(`Refund failed bet#${bet.id}: ${e.message}`); }
    }
    return;
  }

  const active = bets.filter(b => !b.exited);
  const winners = active.filter(b => b.direction === outcome);
  const losers = active.filter(b => b.direction !== outcome);

  if (winners.length === 0 || losers.length === 0) {
    for (const bet of active) {
      if (bet.paid_out) continue;
      try {
        const sig = await sendPayout(bet.wallet, bet.amount);
        await updateBet(bet.id, { paid_out: 1, payout_sig: sig });
      } catch (e) { console.error(`Refund failed bet#${bet.id}: ${e.message}`); }
    }
    return;
  }

  const totalAll = active.reduce((s, b) => s + b.amount, 0);
  const totalWin = winners.reduce((s, b) => s + b.amount, 0);
  const payoutPool = totalAll * (1 - FEE);

  for (const bet of winners) {
    if (bet.paid_out) continue;
    try {
      const payout = payoutPool * (bet.amount / totalWin);
      const sig = await sendPayout(bet.wallet, payout);
      await updateBet(bet.id, { paid_out: 1, payout_sig: sig });
      console.log(`Paid ${payout.toFixed(4)} SOL → ${bet.wallet}`);
    } catch (e) { console.error(`Payout failed bet#${bet.id}: ${e.message}`); }
  }
}

async function marketLoop(market) {
  try {
    let current = await getCurrentRound(market);
    if (!current) current = await startNewRound(market);
    const msLeft = Math.max(0, current.end_time - Date.now());
    console.log(`[${market}] Round #${current.id} — ${Math.round(msLeft / 1000)}s left`);
    setTimeout(async () => {
      await settleRound(current.id, market);
      setTimeout(() => marketLoop(market), 2000);
    }, msLeft);
  } catch (e) {
    console.error(`[${market}] roundLoop error:`, e.message);
    setTimeout(() => marketLoop(market), 5000);
  }
}

module.exports = { marketLoop, getCurrentRound, getRoundById, getRecentRounds, getBetsForRound, MIN_BET };
