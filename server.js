const { Pool } = require('pg');
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const path = require('path');
const app = express();

// CRITICAL FIX: Use Render's PORT (default 10000) or fallback to 3000
// DO NOT hardcode 3001 - Render needs port 10000!
const PORT = process.env.PORT || 10000;

console.log('Starting server...');
console.log('PORT:', PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('BOT_TOKEN exists:', !!process.env.BOT_TOKEN);

// Database connection
let pool;
try {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }, // Required for Render PostgreSQL
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
    });

    pool.on('error', (err) => {
        console.error('Unexpected database error:', err);
    });
    console.log('Database pool created successfully');
} catch (err) {
    console.error('Failed to create database pool:', err);
}

app.use(bodyParser.json({ limit: '10kb' }));
app.use(express.static('public'));

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        if (pool) {
            await pool.query('SELECT 1');
            res.status(200).json({ 
                status: 'OK', 
                uptime: process.uptime(), 
                timestamp: new Date().toISOString(),
                database: 'connected',
                port: PORT
            });
        } else {
            res.status(503).json({ status: 'Database pool not initialized' });
        }
    } catch (err) {
        console.error('Health check failed:', err);
        res.status(503).json({ status: 'DB unavailable', error: err.message });
    }
});

// Root endpoint
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// TELEGRAM VERIFICATION
// ============================================

async function verifyTelegramData(req, res, next) {
    if (!req.body?.initData) {
        return res.status(400).json({ error: 'Missing Telegram data' });
    }

    try {
        const initData = new URLSearchParams(req.body.initData);
        const hash = initData.get('hash');
        const authDate = initData.get('auth_date');
        
        if (Date.now() / 1000 - parseInt(authDate) > 86400) {
            return res.status(401).json({ error: 'Expired authentication' });
        }

        initData.delete('hash');
        const dataCheckString = Array.from(initData.entries())
            .map(([k, v]) => `${k}=${v}`)
            .sort()
            .join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData')
            .update(process.env.BOT_TOKEN)
            .digest();

        const calculatedHash = crypto.createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        if (calculatedHash !== hash) {
            return res.status(401).json({ error: 'Invalid hash' });
        }

        req.telegramUser = JSON.parse(initData.get('user'));
        next();
    } catch (err) {
        console.error('Authentication Error:', err);
        res.status(500).json({ error: 'Authentication failed' });
    }
}

function verifyAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== 'Bearer admin123') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// ============================================
// USER API ENDPOINTS
// ============================================

app.post('/api/user', verifyTelegramData, async (req, res) => {
    const client = await pool.connect();
    try {
        const { id, first_name, last_name, username, photo_url } = req.telegramUser;
        const referralCode = req.body.referralCode;
        const walletAddress = req.body.walletAddress;
        
        await client.query('BEGIN');
        
        const existingUser = await client.query(
            'SELECT * FROM users WHERE telegram_id = $1',
            [id]
        );
        
        let user;
        
        if (existingUser.rows.length > 0) {
            const updateQuery = `
                UPDATE users 
                SET first_name = $1, last_name = $2, username = $3, photo_url = $4,
                    wallet_address = COALESCE($5, wallet_address), updated_at = NOW()
                WHERE telegram_id = $6
                RETURNING *
            `;
            const result = await client.query(updateQuery, [
                first_name, last_name, username, photo_url, walletAddress, id
            ]);
            user = result.rows[0];
        } else {
            const userReferralCode = `YZEMAN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
            
            const insertQuery = `
                INSERT INTO users (telegram_id, first_name, last_name, username, photo_url, referral_code, wallet_address)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `;
            const result = await client.query(insertQuery, [
                id, first_name, last_name, username, photo_url, userReferralCode, walletAddress
            ]);
            user = result.rows[0];
            
            if (referralCode && referralCode !== userReferralCode) {
                const referrerResult = await client.query(
                    'SELECT id, tier FROM users WHERE referral_code = $1',
                    [referralCode]
                );
                
                if (referrerResult.rows.length > 0 && referrerResult.rows[0].id !== user.id) {
                    const referrerId = referrerResult.rows[0].id;
                    const referrerTier = referrerResult.rows[0].tier;
                    
                    const tierResult = await client.query(
                        'SELECT referral_reward FROM tiers WHERE name = $1',
                        [referrerTier]
                    );
                    
                    const reward = tierResult.rows[0]?.referral_reward || 5000;
                    
                    await client.query(
                        'INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                        [referrerId, user.id]
                    );
                    
                    await client.query(
                        'UPDATE users SET points = points + $1, referrals = referrals + 1 WHERE id = $2',
                        [reward, referrerId]
                    );
                    
                    const newReferralCount = await client.query(
                        'SELECT COUNT(*) FROM referrals WHERE referrer_id = $1',
                        [referrerId]
                    );
                    const count = parseInt(newReferralCount.rows[0].count);
                    
                    const newTier = await client.query(
                        `SELECT name FROM tiers 
                         WHERE refs_required <= $1 
                         ORDER BY refs_required DESC 
                         LIMIT 1`,
                        [count]
                    );
                    
                    if (newTier.rows.length > 0 && newTier.rows[0].name !== referrerTier) {
                        await client.query(
                            'UPDATE users SET tier = $1 WHERE id = $2',
                            [newTier.rows[0].name, referrerId]
                        );
                    }
                    
                    await client.query(
                        'UPDATE users SET points = points + 500 WHERE id = $1',
                        [user.id]
                    );
                }
            }
        }
        
        const { rows: [stats] } = await client.query(`
            SELECT 
                COUNT(r.*) AS referrals,
                t.name AS tier,
                t.multiplier,
                t.referral_reward
            FROM users u
            LEFT JOIN referrals r ON r.referrer_id = u.id
            LEFT JOIN tiers t ON u.tier = t.name
            WHERE u.id = $1
            GROUP BY u.id, t.name, t.multiplier, t.referral_reward`,
            [user.id]
        );

        await client.query('COMMIT');
        res.json({ ...user, ...stats });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('User Error:', err);
        res.status(500).json({ error: 'Database operation failed' });
    } finally {
        client.release();
    }
});

app.post('/api/ad-reward', verifyTelegramData, async (req, res) => {
    const client = await pool.connect();
    try {
        const { rewardAmount, adType } = req.body;
        const telegramId = req.telegramUser.id;

        const userResult = await client.query(
            'SELECT id FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userId = userResult.rows[0].id;
        
        await client.query(
            'INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)',
            [userId, rewardAmount, adType]
        );
        
        await client.query(
            'UPDATE users SET points = points + $1, total_points_earned = total_points_earned + $1 WHERE id = $2',
            [rewardAmount, userId]
        );
        
        const { rows: [user] } = await client.query(
            'SELECT points FROM users WHERE id = $1',
            [userId]
        );
        
        await client.query('COMMIT');
        res.json({ success: true, points: user.points });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Ad Reward Error:', err);
        res.status(500).json({ error: 'Failed to process ad reward' });
    } finally {
        client.release();
    }
});

// ============================================
// DAILY REWARDS
// ============================================

app.post('/api/daily-reward', verifyTelegramData, async (req, res) => {
    const client = await pool.connect();
    try {
        const telegramId = req.telegramUser.id;
        const today = new Date().toISOString().split('T')[0];
        
        const userResult = await client.query(
            'SELECT id, last_login_date FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userId = userResult.rows[0].id;
        const lastLogin = userResult.rows[0].last_login_date;
        
        const existingReward = await client.query(
            'SELECT * FROM daily_rewards WHERE user_id = $1 AND reward_date = $2',
            [userId, today]
        );
        
        if (existingReward.rows.length > 0) {
            return res.status(400).json({ error: 'Already claimed today' });
        }
        
        let streak = 1;
        if (lastLogin) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];
            
            if (lastLogin === yesterdayStr) {
                const lastStreak = await client.query(
                    'SELECT streak_count FROM daily_rewards WHERE user_id = $1 ORDER BY reward_date DESC LIMIT 1',
                    [userId]
                );
                streak = (lastStreak.rows[0]?.streak_count || 0) + 1;
            }
        }
        
        const baseReward = 1000;
        const streakBonus = Math.floor(streak / 7) * 5000;
        let rewardPoints = baseReward + streakBonus;
        
        const userTier = await client.query('SELECT tier FROM users WHERE id = $1', [userId]);
        const tierMultiplier = { Fresher: 1, Brute: 1.2, Silver: 1.5, Gold: 2, Platinum: 3 };
        const multiplier = tierMultiplier[userTier.rows[0]?.tier] || 1;
        const finalReward = Math.floor(rewardPoints * multiplier);
        
        await client.query('BEGIN');
        
        await client.query(
            'INSERT INTO daily_rewards (user_id, reward_date, streak_count, reward_points) VALUES ($1, $2, $3, $4)',
            [userId, today, streak, finalReward]
        );
        
        await client.query(
            'UPDATE users SET points = points + $1, total_points_earned = total_points_earned + $1, last_login_date = $2 WHERE id = $3',
            [finalReward, today, userId]
        );
        
        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            reward: finalReward, 
            streak: streak,
            message: `Daily reward: ${finalReward.toLocaleString()} points! Streak: ${streak} days`
        });
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Daily reward error:', err);
        res.status(500).json({ error: 'Failed to process daily reward' });
    } finally {
        client.release();
    }
});

app.get('/api/daily-stats', verifyTelegramData, async (req, res) => {
    try {
        const telegramId = req.telegramUser.id;
        
        const userResult = await pool.query(
            'SELECT id FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userId = userResult.rows[0].id;
        
        const today = new Date().toISOString().split('T')[0];
        const claimedToday = await pool.query(
            'SELECT * FROM daily_rewards WHERE user_id = $1 AND reward_date = $2',
            [userId, today]
        );
        
        const last7Days = await pool.query(`
            SELECT reward_date, streak_count, reward_points
            FROM daily_rewards
            WHERE user_id = $1
            ORDER BY reward_date DESC
            LIMIT 7
        `, [userId]);
        
        const maxStreak = await pool.query(`
            SELECT MAX(streak_count) as max_streak
            FROM daily_rewards
            WHERE user_id = $1
        `, [userId]);
        
        res.json({
            claimed_today: claimedToday.rows.length > 0,
            last_7_days: last7Days.rows,
            max_streak: maxStreak.rows[0]?.max_streak || 0,
            current_streak: last7Days.rows[0]?.streak_count || 0
        });
        
    } catch (err) {
        console.error('Daily stats error:', err);
        res.status(500).json({ error: 'Failed to fetch daily stats' });
    }
});

// ============================================
// WHEEL OF FORTUNE
// ============================================

app.post('/api/wheel-spin', verifyTelegramData, async (req, res) => {
    const client = await pool.connect();
    try {
        const telegramId = req.telegramUser.id;
        const today = new Date().toISOString().split('T')[0];
        
        const userResult = await client.query(
            'SELECT id FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userId = userResult.rows[0].id;
        
        const lastSpin = await client.query(
            "SELECT spin_date FROM wheel_spins WHERE user_id = $1 ORDER BY spin_date DESC LIMIT 1",
            [userId]
        );
        
        if (lastSpin.rows.length > 0) {
            const lastSpinDate = new Date(lastSpin.rows[0].spin_date);
            const daysDiff = Math.floor((new Date() - lastSpinDate) / (1000 * 60 * 60 * 24));
            if (daysDiff < 3) {
                const daysLeft = 3 - daysDiff;
                return res.status(400).json({ 
                    error: `Next spin available in ${daysLeft} day(s)`,
                    daysLeft: daysLeft
                });
            }
        }
        
        const prizes = [100, 250, 500, 1000, 2500, 5000, 7500, 10000];
        const randomIndex = Math.floor(Math.random() * prizes.length);
        const rewardPoints = prizes[randomIndex];
        
        const userTier = await client.query('SELECT tier FROM users WHERE id = $1', [userId]);
        const tierMultiplier = { Fresher: 1, Brute: 1.2, Silver: 1.5, Gold: 2, Platinum: 3 };
        const multiplier = tierMultiplier[userTier.rows[0]?.tier] || 1;
        const finalReward = Math.floor(rewardPoints * multiplier);
        
        await client.query('BEGIN');
        
        await client.query(
            'INSERT INTO wheel_spins (user_id, spin_date, reward_points) VALUES ($1, $2, $3)',
            [userId, today, finalReward]
        );
        
        await client.query(
            'UPDATE users SET points = points + $1, total_points_earned = total_points_earned + $1 WHERE id = $2',
            [finalReward, userId]
        );
        
        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            reward: finalReward,
            prize: rewardPoints,
            multiplier: multiplier,
            message: `🎡 You won ${finalReward.toLocaleString()} points!`
        });
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Wheel spin error:', err);
        res.status(500).json({ error: 'Failed to process wheel spin' });
    } finally {
        client.release();
    }
});

app.get('/api/wheel-status', verifyTelegramData, async (req, res) => {
    try {
        const telegramId = req.telegramUser.id;
        
        const userResult = await pool.query(
            'SELECT id FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userId = userResult.rows[0].id;
        
        const lastSpin = await pool.query(
            "SELECT spin_date, reward_points FROM wheel_spins WHERE user_id = $1 ORDER BY spin_date DESC LIMIT 1",
            [userId]
        );
        
        let canSpin = true;
        let daysLeft = 0;
        let lastReward = 0;
        
        if (lastSpin.rows.length > 0) {
            const lastSpinDate = new Date(lastSpin.rows[0].spin_date);
            const daysDiff = Math.floor((new Date() - lastSpinDate) / (1000 * 60 * 60 * 24));
            lastReward = lastSpin.rows[0].reward_points;
            if (daysDiff < 3) {
                canSpin = false;
                daysLeft = 3 - daysDiff;
            }
        }
        
        res.json({
            can_spin: canSpin,
            days_left: daysLeft,
            last_reward: lastReward
        });
        
    } catch (err) {
        console.error('Wheel status error:', err);
        res.status(500).json({ error: 'Failed to fetch wheel status' });
    }
});

// ============================================
// LEADERBOARD ENDPOINTS
// ============================================

app.get('/api/leaderboard/weekly-referrers', verifyTelegramData, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                u.id,
                u.username,
                u.first_name,
                u.photo_url,
                COUNT(r.id) as referral_count,
                u.tier
            FROM users u
            LEFT JOIN referrals r ON u.id = r.referrer_id 
                AND r.created_at > NOW() - INTERVAL '7 days'
            GROUP BY u.id
            ORDER BY referral_count DESC
            LIMIT 50
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Leaderboard error:', err);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

app.get('/api/leaderboard/top-earners', verifyTelegramData, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                id,
                username,
                first_name,
                photo_url,
                points,
                tier,
                total_points_earned
            FROM users
            ORDER BY points DESC
            LIMIT 50
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Leaderboard error:', err);
        res.status(500).json({ error: 'Failed to fetch top earners' });
    }
});

app.get('/api/leaderboard/weekly-earnings', verifyTelegramData, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                u.id,
                u.username,
                u.first_name,
                u.photo_url,
                COALESCE(SUM(ar.reward_amount), 0) as weekly_earnings,
                u.tier
            FROM users u
            LEFT JOIN ad_rewards ar ON u.id = ar.user_id 
                AND ar.created_at > NOW() - INTERVAL '7 days'
            GROUP BY u.id
            ORDER BY weekly_earnings DESC
            LIMIT 50
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Weekly earnings error:', err);
        res.status(500).json({ error: 'Failed to fetch weekly earnings' });
    }
});

// ============================================
// ACHIEVEMENTS
// ============================================

app.get('/api/achievements', verifyTelegramData, async (req, res) => {
    try {
        const telegramId = req.telegramUser.id;
        
        const userResult = await pool.query(
            'SELECT id, points, referrals, tier, total_points_earned FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userId = userResult.rows[0].id;
        const user = userResult.rows[0];
        
        const achievements = await pool.query(`
            SELECT 
                a.*,
                CASE WHEN ua.id IS NOT NULL THEN true ELSE false END as achieved,
                ua.achieved_at
            FROM achievements a
            LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = $1
            ORDER BY a.id
        `, [userId]);
        
        const totalLoginDays = await pool.query(
            'SELECT COUNT(*) as days FROM daily_rewards WHERE user_id = $1',
            [userId]
        );
        
        const maxStreak = await pool.query(
            'SELECT MAX(streak_count) as max_streak FROM daily_rewards WHERE user_id = $1',
            [userId]
        );
        
        const achievementsCount = await pool.query(
            'SELECT COUNT(*) as count FROM user_achievements WHERE user_id = $1',
            [userId]
        );
        
        res.json({
            achievements: achievements.rows,
            userStats: {
                points: user.points,
                referrals: user.referrals,
                tier: user.tier,
                total_points_earned: user.total_points_earned,
                total_login_days: parseInt(totalLoginDays.rows[0].days),
                max_streak: maxStreak.rows[0].max_streak || 0,
                achievements_count: parseInt(achievementsCount.rows[0].count)
            }
        });
        
    } catch (err) {
        console.error('Achievements error:', err);
        res.status(500).json({ error: 'Failed to fetch achievements' });
    }
});

// ============================================
// TOURNAMENTS
// ============================================

app.post('/api/tournament/join', verifyTelegramData, async (req, res) => {
    const client = await pool.connect();
    try {
        const telegramId = req.telegramUser.id;
        
        const userResult = await client.query(
            'SELECT id FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userId = userResult.rows[0].id;
        
        const today = new Date();
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        weekStart.setHours(0, 0, 0, 0);
        const weekStartStr = weekStart.toISOString().split('T')[0];
        
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        const weekEndStr = weekEnd.toISOString().split('T')[0];
        
        let tournament = await client.query(
            'SELECT * FROM weekly_tournaments WHERE week_start = $1',
            [weekStartStr]
        );
        
        if (tournament.rows.length === 0) {
            const result = await client.query(
                `INSERT INTO weekly_tournaments (week_start, week_end, is_active) 
                 VALUES ($1, $2, true) RETURNING *`,
                [weekStartStr, weekEndStr]
            );
            tournament = result;
        }
        
        const tournamentId = tournament.rows[0].id;
        
        await client.query(
            `INSERT INTO tournament_participants (tournament_id, user_id) 
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [tournamentId, userId]
        );
        
        await client.query('COMMIT');
        res.json({ success: true, message: 'Joined weekly tournament!' });
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Tournament join error:', err);
        res.status(500).json({ error: 'Failed to join tournament' });
    } finally {
        client.release();
    }
});

app.get('/api/tournament/standings', verifyTelegramData, async (req, res) => {
    try {
        const today = new Date();
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        weekStart.setHours(0, 0, 0, 0);
        const weekStartStr = weekStart.toISOString().split('T')[0];
        
        const result = await pool.query(`
            SELECT 
                u.id,
                u.username,
                u.first_name,
                u.photo_url,
                COALESCE(SUM(ar.reward_amount), 0) as weekly_points,
                COUNT(DISTINCT r.id) as weekly_referrals,
                u.tier
            FROM tournament_participants tp
            JOIN users u ON tp.user_id = u.id
            LEFT JOIN ad_rewards ar ON u.id = ar.user_id 
                AND ar.created_at > NOW() - INTERVAL '7 days'
            LEFT JOIN referrals r ON u.id = r.referrer_id 
                AND r.created_at > NOW() - INTERVAL '7 days'
            WHERE tp.tournament_id = (SELECT id FROM weekly_tournaments WHERE week_start = $1)
            GROUP BY u.id
            ORDER BY weekly_points DESC
            LIMIT 100
        `, [weekStartStr]);
        
        const currentUser = await pool.query(`
            SELECT u.id, COALESCE(SUM(ar.reward_amount), 0) as weekly_points,
                   RANK() OVER (ORDER BY COALESCE(SUM(ar.reward_amount), 0) DESC) as rank
            FROM users u
            LEFT JOIN ad_rewards ar ON u.id = ar.user_id 
                AND ar.created_at > NOW() - INTERVAL '7 days'
            WHERE u.telegram_id = $1
            GROUP BY u.id
        `, [req.telegramUser.id]);
        
        res.json({
            standings: result.rows,
            my_rank: currentUser.rows[0]?.rank || null,
            my_points: currentUser.rows[0]?.weekly_points || 0,
            week_start: weekStartStr
        });
        
    } catch (err) {
        console.error('Tournament standings error:', err);
        res.status(500).json({ error: 'Failed to fetch standings' });
    }
});

// ============================================
// TEAMS
// ============================================

app.post('/api/team/create', verifyTelegramData, async (req, res) => {
    const client = await pool.connect();
    try {
        const { teamName } = req.body;
        const telegramId = req.telegramUser.id;
        
        const userResult = await client.query(
            'SELECT id FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userId = userResult.rows[0].id;
        
        const existingTeam = await client.query(
            'SELECT id FROM teams WHERE created_by = $1',
            [userId]
        );
        
        if (existingTeam.rows.length > 0) {
            return res.status(400).json({ error: 'You already created a team' });
        }
        
        const teamCode = crypto.randomBytes(4).toString('hex').toUpperCase();
        
        const result = await client.query(
            `INSERT INTO teams (name, code, created_by) 
             VALUES ($1, $2, $3) RETURNING *`,
            [teamName, teamCode, userId]
        );
        
        const teamId = result.rows[0].id;
        
        await client.query(
            'INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)',
            [teamId, userId]
        );
        
        await client.query('UPDATE users SET team_id = $1 WHERE id = $2', [teamId, userId]);
        
        await client.query('COMMIT');
        
        res.json({ success: true, team: result.rows[0] });
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Team creation error:', err);
        res.status(500).json({ error: 'Failed to create team' });
    } finally {
        client.release();
    }
});

app.post('/api/team/join', verifyTelegramData, async (req, res) => {
    const client = await pool.connect();
    try {
        const { teamCode } = req.body;
        const telegramId = req.telegramUser.id;
        
        const userResult = await client.query(
            'SELECT id, team_id FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userId = userResult.rows[0].id;
        
        if (userResult.rows[0].team_id) {
            return res.status(400).json({ error: 'You are already in a team' });
        }
        
        const teamResult = await client.query(
            'SELECT id FROM teams WHERE code = $1',
            [teamCode.toUpperCase()]
        );
        
        if (teamResult.rows.length === 0) {
            return res.status(404).json({ error: 'Team not found' });
        }
        
        const teamId = teamResult.rows[0].id;
        
        await client.query(
            'INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [teamId, userId]
        );
        
        await client.query('UPDATE users SET team_id = $1 WHERE id = $2', [teamId, userId]);
        
        await client.query('COMMIT');
        
        res.json({ success: true, message: 'Joined team successfully!' });
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Team join error:', err);
        res.status(500).json({ error: 'Failed to join team' });
    } finally {
        client.release();
    }
});

app.get('/api/team/info', verifyTelegramData, async (req, res) => {
    try {
        const telegramId = req.telegramUser.id;
        
        const userResult = await pool.query(
            'SELECT id, team_id FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userId = userResult.rows[0].id;
        const teamId = userResult.rows[0].team_id;
        
        if (!teamId) {
            return res.json({ has_team: false });
        }
        
        const teamInfo = await pool.query(`
            SELECT 
                t.id,
                t.name,
                t.code,
                t.created_at,
                COUNT(tm.user_id) as member_count,
                COALESCE(SUM(u.points), 0) as total_points,
                COALESCE(SUM(u.referrals), 0) as total_referrals,
                u2.username as leader_name
            FROM teams t
            LEFT JOIN team_members tm ON t.id = tm.team_id
            LEFT JOIN users u ON tm.user_id = u.id
            LEFT JOIN users u2 ON t.created_by = u2.id
            WHERE t.id = $1
            GROUP BY t.id, u2.username
        `, [teamId]);
        
        const members = await pool.query(`
            SELECT u.username, u.first_name, u.points, u.referrals, u.tier,
                   CASE WHEN u.id = t.created_by THEN true ELSE false END as is_leader
            FROM team_members tm
            JOIN users u ON tm.user_id = u.id
            JOIN teams t ON tm.team_id = t.id
            WHERE tm.team_id = $1
            ORDER BY u.points DESC
        `, [teamId]);
        
        res.json({
            has_team: true,
            team: teamInfo.rows[0],
            members: members.rows,
            is_leader: teamInfo.rows[0]?.leader_name === userResult.rows[0]?.username
        });
        
    } catch (err) {
        console.error('Team info error:', err);
        res.status(500).json({ error: 'Failed to fetch team info' });
    }
});

app.get('/api/team/leaderboard', verifyTelegramData, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                t.id,
                t.name,
                COUNT(tm.user_id) as member_count,
                COALESCE(SUM(u.points), 0) as total_points,
                COALESCE(SUM(u.referrals), 0) as total_referrals,
                u2.username as leader_name
            FROM teams t
            LEFT JOIN team_members tm ON t.id = tm.team_id
            LEFT JOIN users u ON tm.user_id = u.id
            LEFT JOIN users u2 ON t.created_by = u2.id
            GROUP BY t.id, u2.username
            ORDER BY total_points DESC
            LIMIT 50
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Team leaderboard error:', err);
        res.status(500).json({ error: 'Failed to fetch team leaderboard' });
    }
});

app.get('/api/team/monthly-competition', verifyTelegramData, async (req, res) => {
    try {
        const result = await pool.query(`
            WITH monthly_stats AS (
                SELECT 
                    u.team_id,
                    SUM(u.points) as team_points,
                    SUM(u.referrals) as team_referrals,
                    COUNT(u.id) as member_count
                FROM users u
                WHERE u.team_id IS NOT NULL
                GROUP BY u.team_id
            )
            SELECT 
                t.id,
                t.name,
                ms.team_points,
                ms.team_referrals,
                ms.member_count,
                u.username as leader_name
            FROM teams t
            JOIN monthly_stats ms ON t.id = ms.team_id
            LEFT JOIN users u ON t.created_by = u.id
            ORDER BY ms.team_points DESC
            LIMIT 20
        `);
        
        const currentMonth = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
        
        res.json({
            month: currentMonth,
            standings: result.rows
        });
    } catch (err) {
        console.error('Monthly competition error:', err);
        res.status(500).json({ error: 'Failed to fetch monthly competition' });
    }
});

// ============================================
// WITHDRAWAL
// ============================================

app.post('/api/withdraw', verifyTelegramData, async (req, res) => {
    const client = await pool.connect();
    try {
        const { amount, walletAddress } = req.body;
        const telegramId = req.telegramUser.id;
        
        const userResult = await client.query(
            'SELECT id, points FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const user = userResult.rows[0];
        const pointsNeeded = amount * 100000;
        
        if (user.points < pointsNeeded) {
            return res.status(400).json({ error: 'Insufficient points' });
        }
        
        await client.query('BEGIN');
        
        await client.query(
            'UPDATE users SET points = points - $1 WHERE id = $2',
            [pointsNeeded, user.id]
        );
        
        await client.query(
            `INSERT INTO withdrawals (user_id, amount, wallet_address, status) 
             VALUES ($1, $2, $3, 'pending')`,
            [user.id, amount, walletAddress]
        );
        
        await client.query('COMMIT');
        res.json({ success: true, message: 'Withdrawal request submitted' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Withdrawal Error:', err);
        res.status(500).json({ error: 'Failed to process withdrawal' });
    } finally {
        client.release();
    }
});

// ============================================
// ADMIN API
// ============================================

app.get('/api/admin/users', verifyAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, telegram_id, first_name, last_name, username, photo_url, 
                   referral_code, points, tier, referrals, wallet_address, created_at, team_id
            FROM users 
            ORDER BY id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Admin users error:', err);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

app.get('/api/admin/withdrawals', verifyAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT w.*, u.username, u.first_name, u.telegram_id
            FROM withdrawals w
            JOIN users u ON w.user_id = u.id
            ORDER BY w.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Admin withdrawals error:', err);
        res.json([]);
    }
});

app.post('/api/admin/update-withdrawal', verifyAdmin, async (req, res) => {
    const { withdrawalId, status } = req.body;
    
    try {
        const withdrawalResult = await pool.query(
            'SELECT user_id, amount FROM withdrawals WHERE id = $1',
            [withdrawalId]
        );
        
        if (withdrawalResult.rows.length === 0) {
            return res.status(404).json({ error: 'Withdrawal not found' });
        }
        
        const withdrawal = withdrawalResult.rows[0];
        
        if (status === 'rejected' || status === 'failed') {
            const pointsToRefund = withdrawal.amount * 100000;
            await pool.query(
                'UPDATE users SET points = points + $1 WHERE id = $2',
                [pointsToRefund, withdrawal.user_id]
            );
        }
        
        await pool.query(
            'UPDATE withdrawals SET status = $1, updated_at = NOW() WHERE id = $2',
            [status, withdrawalId]
        );
        
        res.json({ success: true });
    } catch (err) {
        console.error('Update withdrawal error:', err);
        res.status(500).json({ error: 'Failed to update withdrawal' });
    }
});

app.post('/api/admin/add-points', verifyAdmin, async (req, res) => {
    const { userId, points } = req.body;
    
    try {
        await pool.query(
            'UPDATE users SET points = points + $1, total_points_earned = total_points_earned + $1 WHERE id = $2',
            [points, userId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Add points error:', err);
        res.status(500).json({ error: 'Failed to add points' });
    }
});

// ============================================
// START SERVER - CRITICAL: Bind to 0.0.0.0
// ============================================

async function startServer() {
    try {
        // Test database connection
        if (pool) {
            const client = await pool.connect();
            await client.query('SELECT 1');
            client.release();
            console.log('✅ Database connected successfully');
        } else {
            throw new Error('Database pool not initialized');
        }
        
        // CRITICAL: Bind to '0.0.0.0' not 'localhost'
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`📊 Health check: http://0.0.0.0:${PORT}/health`);
            console.log(`✅ Server is listening on 0.0.0.0:${PORT}`);
        });
        
        process.on('SIGTERM', () => {
            console.log('SIGTERM received, closing server...');
            server.close(() => {
                if (pool) pool.end();
                process.exit(0);
            });
        });
        
    } catch (err) {
        console.error('❌ Failed to start server:', err);
        process.exit(1);
    }
}

startServer();
