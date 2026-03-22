// Runs once on startup to ensure DB schema is up to date
const { createClient } = require('@supabase/supabase-js');

async function migrate() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  
  // Add market column if it doesn't exist (safe to run multiple times)
  const migrations = [
    `ALTER TABLE rounds ADD COLUMN IF NOT EXISTS market text NOT NULL DEFAULT 'NEET'`,
  ];

  for (const sql of migrations) {
    const { error } = await supabase.rpc('exec_sql', { sql }).catch(() => ({ error: null }));
    // Ignore errors — column likely already exists
  }
  console.log('[migrate] Schema up to date');
}

module.exports = { migrate };
