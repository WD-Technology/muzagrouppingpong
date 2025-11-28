const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const isVercel = process.env.VERCEL === '1';
let dbPath = 'pingpong.db';

if (true) {
    const tmpDbPath = path.join('/tmp', 'pingpong.db');
    // If the DB doesn't exist in /tmp, copy it from source or create new
    if (!fs.existsSync(tmpDbPath)) {
        const sourceDbPath = path.join(__dirname, 'pingpong.db');
        if (fs.existsSync(sourceDbPath)) {
            fs.copyFileSync(sourceDbPath, tmpDbPath);
            console.log('Copied database to /tmp');
        } else {
            console.log('No source database found, creating new one in /tmp');
        }
    }
    dbPath = tmpDbPath;
}

const db = new Database(dbPath, { verbose: console.log });

// Create tables
const createTables = () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tournaments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            status TEXT DEFAULT 'active', -- 'active', 'completed'
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER,
            round INTEGER,
            player1_id INTEGER,
            player2_id INTEGER,
            score1 INTEGER DEFAULT 0,
            score2 INTEGER DEFAULT 0,
            winner_id INTEGER,
            next_match_id INTEGER,
            sets_detail TEXT, -- JSON string of set scores e.g. "11-9, 5-11"
            FOREIGN KEY(tournament_id) REFERENCES tournaments(id),
            FOREIGN KEY(player1_id) REFERENCES players(id),
            FOREIGN KEY(player2_id) REFERENCES players(id),
            FOREIGN KEY(winner_id) REFERENCES players(id)
        );
    `);
    console.log('Tables created successfully.');
};

createTables();

module.exports = db;
