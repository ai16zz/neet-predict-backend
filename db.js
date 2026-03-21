const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data.json');

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) { console.error('[db] load error:', e.message); }
  return { rounds: [], bets: [], roundIdSeq: 1, betIdSeq: 1 };
}

function save(state) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(state)); }
  catch (e) { console.error('[db] save error:', e.message); }
}

let state = load();
console.log(`[db] Loaded: ${state.rounds.length} rounds, ${state.bets.length} bets`);

// ── Rounds ────────────────────────────────────────────────

function insertRound({ start_time, end_time, start_price }) {
  const round = { id: state.roundIdSeq++, start_time, end_time, start_price, end_price: null, outcome: null, settled: 0 };
  state.rounds.push(round);
  save(state);
  return round;
}

function updateRound(id, fields) {
  const r = state.rounds.find(r => r.id === id);
  if (r) { Object.assign(r, fields); save(state); }
}

function getCurrentRound() {
  return [...state.rounds].reverse().find(r => r.settled === 0) || null;
}

function getRoundById(id) {
  return state.rounds.find(r => r.id === id) || null;
}

function getRecentRounds(limit = 10) {
  return state.rounds.filter(r => r.settled === 1).slice(-limit).reverse();
}

// ── Bets ──────────────────────────────────────────────────

function insertBet({ round_id, wallet, direction, amount, tx_sig }) {
  const bet = { id: state.betIdSeq++, round_id, wallet, direction, amount, tx_sig, paid_out: 0, exited: 0, payout_sig: null, created_at: Date.now() };
  state.bets.push(bet);
  save(state);
  return bet;
}

function updateBet(id, fields) {
  const b = state.bets.find(b => b.id === id);
  if (b) { Object.assign(b, fields); save(state); }
}

function getBetsForRound(round_id) {
  return state.bets.filter(b => b.round_id === round_id);
}

function getBetByTxSig(tx_sig) {
  return state.bets.find(b => b.tx_sig === tx_sig) || null;
}

function getBetById(id) {
  return state.bets.find(b => b.id === parseInt(id)) || null;
}

function getPositionsForWallet(wallet) {
  return state.bets
    .filter(b => b.wallet === wallet)
    .map(b => {
      const round = getRoundById(b.round_id);
      return { ...b, outcome: round?.outcome, start_price: round?.start_price, end_price: round?.end_price, end_time: round?.end_time, settled: round?.settled || 0 };
    })
    .reverse()
    .slice(0, 20);
}

module.exports = {
  insertRound, updateRound, getCurrentRound, getRoundById, getRecentRounds,
  insertBet, updateBet, getBetsForRound, getBetByTxSig, getBetById, getPositionsForWallet,
};
