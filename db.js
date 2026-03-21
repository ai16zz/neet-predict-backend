const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'neet.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    start_price REAL,
    end_price REAL,
    outcome TEXT,
    settled INTEGER DEFAULT 0,
    total_up REAL DEFAULT 0,
    total_down REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    wallet TEXT NOT NULL,
    direction TEXT NOT NULL,
    amount REAL NOT NULL,
    tx_sig TEXT NOT NULL,
    paid_out INTEGER DEFAULT 0,
    payout_sig TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (round_id) REFERENCES rounds(id)
  );
`);

module.exports = db;
