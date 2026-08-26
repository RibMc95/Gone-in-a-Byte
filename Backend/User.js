import { Router } from 'express';
import {
    createUser,
    getOrderHistory,
    getOrderStatus,
    isValidUsername,
    normalizeUsername,
    updatePlayerStats,
} from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

function parseUsername(value) {
    const cleanUsername = normalizeUsername(value);
    return isValidUsername(cleanUsername) ? cleanUsername : null;
}

router.get('/leaderboard', async (req, res) => {
    const rawLimit = Number(req.query.limit ?? 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 10;

    try {
        const players = await getTopPlayers(limit);
        return res.json({ players });
    } catch (err) {
        console.error('Leaderboard error:', err);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});

router.get('/:username', async (req, res) => {
    const username = parseUsername(req.params.username);

    if (!username) {
        return res.status(400).json({
            message: 'Username must be 3-30 characters: letters, numbers and underscores only.',
        });
    }

    try {
        const stats = await getPlayerStats(username);

        if (!stats) {
            return res.status(404).json({ message: 'User not found.' });
        }

        return res.json(stats);
    } catch (err) {
        console.error('Get user stats error:', err);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});

router.post('/', async (req, res) => {
    const username = parseUsername(req.body?.username);

    if (!username) {
        return res.status(400).json({
            message: 'Username must be 3-30 characters: letters, numbers and underscores only.',
        });
    }

    try {
        const user = await createUser(username);
        return res.status(201).json(user);
    } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') {
            return res.status(409).json({ message: 'User already exists.' });
        }

        console.error('Create user error:', err);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});

router.put('/:username/stats', requireAuth, async (req, res) => {
    const username = parseUsername(req.params.username);
    const { wins, losses } = req.body ?? {};

    if (!username) {
        return res.status(400).json({
            message: 'Username must be 3-30 characters: letters, numbers and underscores only.',
        });
    }

    if (!Number.isInteger(wins) || wins < 0 || !Number.isInteger(losses) || losses < 0) {
        return res.status(400).json({ message: 'wins and losses must be non-negative integers.' });
    }

    if (req.user?.username !== username) {
        return res.status(403).json({ message: 'You can only update your own stats.' });
    }

    try {
        const stats = await updatePlayerStats(username, { wins, losses });

        if (!stats) {
            return res.status(404).json({ message: 'User not found.' });
        }

        return res.json(stats);
    } catch (err) {
        console.error('Update user stats error:', err);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});

export default router;