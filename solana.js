const { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58');

// Use env RPC if set, otherwise use Solana public mainnet
const RPC_URL = (process.env.RPC_URL && !process.env.RPC_URL.includes('ankr'))
  ? process.env.RPC_URL
  : 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');
console.log('[solana] Using RPC:', RPC_URL);

function getTreasury() {
  const key = process.env.TREASURY_PRIVATE_KEY;
  if (!key) throw new Error('TREASURY_PRIVATE_KEY not set');
  const decoded = bs58.decode(key);
  return Keypair.fromSecretKey(decoded);
}

async function sendPayout(toAddress, amountSol) {
  const treasury = getTreasury();
  const to = new PublicKey(toAddress);
  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: treasury.publicKey,
      toPubkey: to,
      lamports,
    })
  );

  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = treasury.publicKey;
  tx.sign(treasury);

  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

async function verifyDeposit(txSig, expectedWallet, minAmountSol) {
  try {
    const treasury = getTreasury();
    const tx = await connection.getParsedTransaction(txSig, { maxSupportedTransactionVersion: 0 });
    if (!tx) return false;

    const instructions = tx.transaction.message.instructions;
    for (const ix of instructions) {
      if (ix.parsed?.type === 'transfer') {
        const info = ix.parsed.info;
        const solAmount = info.lamports / LAMPORTS_PER_SOL;
        if (
          info.destination === treasury.publicKey.toBase58() &&
          info.source === expectedWallet &&
          solAmount >= minAmountSol - 0.001
        ) {
          return { verified: true, amount: solAmount };
        }
      }
    }
    return false;
  } catch (e) {
    console.error('[solana] verifyDeposit error:', e.message);
    return false;
  }
}

module.exports = { sendPayout, verifyDeposit, getTreasury, connection };
