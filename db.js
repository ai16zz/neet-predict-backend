const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── Rounds ────────────────────────────────────────────────

async function insertRound({ start_time, end_time, start_price, market = 'NEET' }) {
  const { data, error } = await supabase
    .from('rounds')
    .insert({ start_time, end_time, start_price, settled: 0, market })
    .select().single();
  if (error) throw error;
  return data;
}

async function updateRound(id, fields) {
  const { error } = await supabase.from('rounds').update(fields).eq('id', id);
  if (error) throw error;
}

async function getCurrentRound(market = 'NEET') {
  const { data } = await supabase
    .from('rounds').select('*')
    .eq('settled', 0).eq('market', market)
    .order('id', { ascending: false }).limit(1).single();
  return data || null;
}

async function getRoundById(id) {
  const { data } = await supabase.from('rounds').select('*').eq('id', id).single();
  return data || null;
}

async function getRecentRounds(market = 'NEET', limit = 10) {
  const { data } = await supabase
    .from('rounds').select('*')
    .eq('settled', 1).eq('market', market)
    .order('id', { ascending: false }).limit(limit);
  return data || [];
}

// ── Bets ──────────────────────────────────────────────────

async function insertBet({ round_id, wallet, direction, amount, tx_sig }) {
  const { data, error } = await supabase
    .from('bets')
    .insert({ round_id, wallet, direction, amount, tx_sig, paid_out: 0, exited: 0, created_at: Date.now() })
    .select().single();
  if (error) throw error;
  return data;
}

async function updateBet(id, fields) {
  const { error } = await supabase.from('bets').update(fields).eq('id', id);
  if (error) throw error;
}

async function getBetsForRound(round_id) {
  const { data } = await supabase.from('bets').select('*').eq('round_id', round_id);
  return data || [];
}

async function getBetByTxSig(tx_sig) {
  const { data } = await supabase.from('bets').select('*').eq('tx_sig', tx_sig).single();
  return data || null;
}

async function getBetById(id) {
  const { data } = await supabase.from('bets').select('*').eq('id', parseInt(id)).single();
  return data || null;
}

async function getPositionsForWallet(wallet) {
  const { data } = await supabase
    .from('bets').select('*, rounds(outcome, start_price, end_price, end_time, settled, market)')
    .eq('wallet', wallet).order('id', { ascending: false }).limit(20);
  return (data || []).map(b => ({
    ...b,
    outcome: b.rounds?.outcome,
    start_price: b.rounds?.start_price,
    end_price: b.rounds?.end_price,
    end_time: b.rounds?.end_time,
    settled: b.rounds?.settled || 0,
    market: b.rounds?.market || 'NEET',
  }));
}

module.exports = {
  insertRound, updateRound, getCurrentRound, getRoundById, getRecentRounds,
  insertBet, updateBet, getBetsForRound, getBetByTxSig, getBetById, getPositionsForWallet,
};
