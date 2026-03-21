// In-memory store — persists for the life of the process
// On Render free tier, this is fine for a prediction market

let rounds = [];
let bets = [];
let roundIdSeq = 1;
let betIdSeq = 1;

// ── Rounds ────────────────────────────────────────────────

function insertRound({ start_time, end_time, start_price }) {
  const round = {
    id: roundIdSeq++,
    start_time,
    end_time,
    start_price,
    end_price: null,
    outcome: null,
    settled: 0,
  };
  rounds.push(round);
  return round;
}

function updateRound(id, fields) {
  const r = rounds.find(r => r.id === id);
  if (r) Object.assign(r, fields);
}

function getCurrentRound() {
  return [...rounds].reverse().find(r => r.settled === 0) || null;
}

function getRoundById(id) {
  return rounds.find(r => r.id === id) || null;
}

function getRecentRounds(limit = 10) {
  return rounds.filter(r => r.settled === 1).slice(-limit).reverse();
}

// ── Bets ──────────────────────────────────────────────────

function insertBet({ round_id, wallet, direction, amount, tx_sig }) {
  const bet = {
    id: betIdSeq++,
    round_id,
    wallet,
    direction,
    amount,
    tx_sig,
    paid_out: 0,
    payout_sig: null,
    created_at: Date.now(),
  };
  bets.push(bet);
  return bet;
}

function updateBet(id, fields) {
  const b = bets.find(b => b.id === id);
  if (b) Object.assign(b, fields);
}

function getBetsForRound(round_id) {
  return bets.filter(b => b.round_id === round_id);
}

function getBetByTxSig(tx_sig) {
  return bets.find(b => b.tx_sig === tx_sig) || null;
}

function getPositionsForWallet(wallet) {
  return bets
    .filter(b => b.wallet === wallet)
    .map(b => {
      const round = getRoundById(b.round_id);
      return { ...b, outcome: round?.outcome, start_price: round?.start_price, end_price: round?.end_price, end_time: round?.end_time };
    })
    .reverse()
    .slice(0, 20);
}

module.exports = {
  insertRound, updateRound, getCurrentRound, getRoundById, getRecentRounds,
  insertBet, updateBet, getBetsForRound, getBetByTxSig, getPositionsForWallet,
};
