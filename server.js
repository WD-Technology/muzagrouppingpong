const express = require('express');
const db = require('./database');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- API ROUTES ---

// Get all players
app.get('/api/players', (req, res) => {
    try {
        const players = db.prepare('SELECT * FROM players ORDER BY name').all();
        res.json(players);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add a player
app.post('/api/players', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    try {
        const info = db.prepare('INSERT INTO players (name) VALUES (?)').run(name);
        res.json({ id: info.lastInsertRowid, name });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a player
app.delete('/api/players/:id', (req, res) => {
    const playerId = req.params.id;
    try {
        // Remove references in matches first (to avoid FK constraint errors)
        db.prepare('UPDATE matches SET player1_id = NULL WHERE player1_id = ?').run(playerId);
        db.prepare('UPDATE matches SET player2_id = NULL WHERE player2_id = ?').run(playerId);
        db.prepare('UPDATE matches SET winner_id = NULL WHERE winner_id = ?').run(playerId);

        // Now delete the player
        db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete ALL players
app.delete('/api/players', (req, res) => {
    try {
        // Remove references in matches first
        db.prepare('UPDATE matches SET player1_id = NULL').run();
        db.prepare('UPDATE matches SET player2_id = NULL').run();
        db.prepare('UPDATE matches SET winner_id = NULL').run();

        // Delete all players
        db.prepare('DELETE FROM players').run();

        // Also reset auto-increment if desired, but not strictly necessary.
        // db.prepare('DELETE FROM sqlite_sequence WHERE name="players"').run();

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create Tournament (Generate Bracket)
app.post('/api/tournaments', (req, res) => {
    try {
        // 1. Create Tournament Record
        const info = db.prepare('INSERT INTO tournaments (status) VALUES (?)').run('active');
        const tournamentId = info.lastInsertRowid;

        // 2. Get all players
        const players = db.prepare('SELECT * FROM players').all();
        if (players.length < 2) {
            return res.status(400).json({ error: 'Need at least 2 players' });
        }

        // 3. Shuffle players
        for (let i = players.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [players[i], players[j]] = [players[j], players[i]];
        }

        // 4. Generate First Round Matches
        // Simple pairing: 1vs2, 3vs4, etc.
        // If odd, the last player gets a bye (we'll handle byes by creating a match with no opponent and auto-winner? Or just not creating it yet?
        // Better: Create a match with player2_id = NULL and immediately set winner_id = player1_id

        const matches = [];
        const round = 1;

        for (let i = 0; i < players.length; i += 2) {
            const p1 = players[i];
            const p2 = players[i + 1]; // undefined if odd

            if (p2) {
                const matchInfo = db.prepare(`
                    INSERT INTO matches (tournament_id, round, player1_id, player2_id)
                    VALUES (?, ?, ?, ?)
                `).run(tournamentId, round, p1.id, p2.id);
                matches.push({ id: matchInfo.lastInsertRowid, ...p1, p2 });
            } else {
                // Bye for p1
                const matchInfo = db.prepare(`
                    INSERT INTO matches (tournament_id, round, player1_id, winner_id)
                    VALUES (?, ?, ?, ?)
                `).run(tournamentId, round, p1.id, p1.id);
                matches.push({ id: matchInfo.lastInsertRowid, ...p1, bye: true });
            }
        }

        // We need to pre-generate the structure for next rounds? 
        // For simplicity in this "Foda" MVP, we will generate next round matches dynamically 
        // when both previous matches feeding into it are done.
        // ACTUALLY, standard brackets usually pre-allocate slots.
        // Let's stick to: When a match finishes, we check if we can create/update the next match.
        // But to visualize the bracket, we need to know the structure.
        // Let's just return the current matches for now. The frontend can visualize "Round 1".

        res.json({ tournamentId, matches });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Active or Completed Tournament Data (Latest visible)
app.get('/api/tournaments/active', (req, res) => {
    try {
        // Fetch the latest tournament that is NOT archived (so active or completed)
        const tournament = db.prepare("SELECT * FROM tournaments WHERE status IN ('active', 'completed') ORDER BY id DESC LIMIT 1").get();
        if (!tournament) return res.json(null);

        const matches = db.prepare(`
            SELECT m.*, p1.name as p1_name, p2.name as p2_name, w.name as winner_name
            FROM matches m
            LEFT JOIN players p1 ON m.player1_id = p1.id
            LEFT JOIN players p2 ON m.player2_id = p2.id
            LEFT JOIN players w ON m.winner_id = w.id
            WHERE m.tournament_id = ?
            ORDER BY m.round, m.id
        `).all(tournament.id);

        res.json({ tournament, matches });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update Match Score & Winner
app.post('/api/matches/:id/update', (req, res) => {
    const { score1, score2, sets_detail } = req.body;
    const matchId = req.params.id;

    try {
        const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
        if (!match) return res.status(404).json({ error: 'Match not found' });

        let winnerId = null;
        // Winner logic is now handled by frontend sending the final winner
        // But for security/validation, we could check sets.
        // For MVP, we trust the frontend "winner" logic or we infer it from sets if provided?
        // Let's rely on the frontend sending the winner_id if the match is over, 
        // OR we calculate it here based on sets_detail if we want to be robust.
        // User prompt implies "passing the champion to the next phase".

        // Let's assume frontend sends the final set scores and we determine winner based on sets won.
        // Actually, simpler: Frontend sends who won the match if it's over.
        // But let's stick to the previous signature + sets_detail.

        // If score1 and score2 represent SETS won (e.g. 2-1), then we can determine winner.
        if (score1 > score2 && score1 >= 2) winnerId = match.player1_id;
        if (score2 > score1 && score2 >= 2) winnerId = match.player2_id;

        db.prepare(`
            UPDATE matches 
            SET score1 = ?, score2 = ?, winner_id = ?, sets_detail = ?
            WHERE id = ?
        `).run(score1, score2, winnerId, JSON.stringify(sets_detail), matchId);

        // Logic to advance to next round
        if (winnerId) {
            // Find if there's already a next match waiting for this winner?
            // Or create a new one?
            // This is the tricky part of dynamic brackets.
            // Simplified logic:
            // 1. Get all matches of current round
            // 2. Pair them up 1-2, 3-4... based on ID order?
            // 3. If both 1 and 2 have winners, create match in round+1.

            // Let's try to find a match in the next round that has an empty slot.
            // This is hard without pre-linking.

            // ALTERNATIVE: When generating the tournament, we assign "next_match_id" links?
            // Too complex for 5 mins.

            // DYNAMIC PAIRING STRATEGY:
            // Check if all matches in current round are finished.
            // If so, generate next round matches from the winners.

            const currentRound = match.round;
            const roundMatches = db.prepare('SELECT * FROM matches WHERE tournament_id = ? AND round = ?').all(match.tournament_id, currentRound);

            const allFinished = roundMatches.every(m => m.winner_id !== null);

            if (allFinished) {
                // Check if we already generated the next round (race condition check essentially)
                const nextRoundMatches = db.prepare('SELECT * FROM matches WHERE tournament_id = ? AND round = ?').all(match.tournament_id, currentRound + 1);

                if (nextRoundMatches.length === 0 && roundMatches.length > 1) {
                    // Generate next round
                    const winners = roundMatches.map(m => ({ id: m.winner_id }));
                    // We assume roundMatches are in bracket order.

                    for (let i = 0; i < winners.length; i += 2) {
                        const w1 = winners[i];
                        const w2 = winners[i + 1];

                        if (w2) {
                            db.prepare(`
                                INSERT INTO matches (tournament_id, round, player1_id, player2_id)
                                VALUES (?, ?, ?, ?)
                            `).run(match.tournament_id, currentRound + 1, w1.id, w2.id);
                        } else {
                            // Final winner or Bye?
                            // If only 1 winner left, tournament is over!
                            if (winners.length === 1) {
                                db.prepare('UPDATE tournaments SET status = ? WHERE id = ?').run('completed', match.tournament_id);
                            } else {
                                // Odd number of winners? Bye to next round
                                db.prepare(`
                                    INSERT INTO matches (tournament_id, round, player1_id, winner_id)
                                    VALUES (?, ?, ?, ?)
                                `).run(match.tournament_id, currentRound + 1, w1.id, w1.id);
                            }
                        }
                    }
                } else if (roundMatches.length === 1) {
                    // Tournament Over
                    db.prepare('UPDATE tournaments SET status = ? WHERE id = ?').run('completed', match.tournament_id);
                }
            }
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Reset Tournament
app.post('/api/tournaments/reset', (req, res) => {
    try {
        // Option 1: Delete everything (Hard Reset)
        // db.prepare('DELETE FROM matches').run();
        // db.prepare('DELETE FROM tournaments').run();
        // db.prepare('DELETE FROM players').run(); // Optional: keep players?

        // Option 2: Archive current tournament (Soft Reset)
        // Archive both active and completed tournaments so we can start fresh
        db.prepare("UPDATE tournaments SET status = 'archived' WHERE status IN ('active', 'completed')").run();

        // For this "Foda" system, let's just archive so we can start a new one.
        // But if the user wants to "Reset" usually they mean "Start Over".
        // Let's archive.

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
