{
  "name": "neet-predict-backend",
  "version": "1.0.0",
  "description": "NEET prediction market backend",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "@solana/web3.js": "^1.87.6",
    "better-sqlite3": "^9.4.3",
    "bs58": "^5.0.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.18.3",
    "node-fetch": "^2.7.0",
    "ws": "^8.16.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}