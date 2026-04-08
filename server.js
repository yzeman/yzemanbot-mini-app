const { Pool } = require('pg');
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const path = require('path');
const app = express();

// Use Render's PORT (default 10000)
const PORT = process.env.PORT || 10000;

console.log('========================================');
console.log('🚀 Starting YzemanBot Server...');
console.log(`📡 PORT: ${PORT}`);
console.log(`🌍 NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
console.log(`🗄️  DATABASE_URL: ${process.env.DATABASE_URL ? '✅ Set' : '❌ Missing'}`);
console.log(`🤖 BOT_TOKEN: ${process.env.BOT_TOKEN ? '✅ Set' : '❌ Missing'}`);
console.log('========================================');

// Database connection with retry logic
let pool = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

function createDatabasePool() {
    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL environment variable is not set!');
        return null;
    }
    
    try {
        const newPool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000,
            max: 10, // Maximum number of clients
        });
        
        newPool.on('error', (err) => {
            console.error('❌ Database pool error:', err.message);
            if (err.message.includes('terminating connection')) {
                console.log('🔄 Database connection terminated, will reconnect on next query...');
            }
        });
        
        console.log('✅ Database pool created successfully');
        return newPool;
    } catch (err) {
        console.error('❌ Failed to create database pool:', err.message);
        return null;
    }
}

pool = createDatabasePool();

// Test database connection on startup
async function testDatabaseConnection() {
    if (!pool) {
        console.error('❌ No database pool available');
        return false;
    }
    
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT NOW() as now');
        console.log(`✅ Database connected successfully at ${result.rows[0].now}`);
        reconnectAttempts = 0;
        return true;
    } catch (err) {
        console.error('❌ Database connection test failed:', err.message);
        
        // Retry connection if needed
        if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            console.log(`🔄 Retrying database connection in 5 seconds... (Attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
            setTimeout(testDatabaseConnection, 5000);
        }
        return false;
    } finally {
        if (client) client.release();
    }
}

// Middleware
app.use(bodyParser.json({ limit: '10kb' }));
app.use(express.static('public'));

// Add CORS headers for development
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Health check endpoint (critical for Render)
app.get('/health', async (req, res) => {
    try {
        let dbStatus = 'unknown';
        let dbError = null;
        
        if (pool) {
            try {
                const client = await pool.connect();
                await client.query('SELECT 1');
                client.release();
                dbStatus = 'connected';
            } catch (err) {
                dbStatus = 'disconnected';
                dbError = err.message;
            }
        } else {
            dbStatus = 'pool not initialized';
        }
        
        res.status(200).json({
            status: 'OK',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            port: PORT,
            database: dbStatus,
            database_error: dbError,
            environment: process.env.NODE_ENV || 'development'
        });
    } catch (err) {
        res.status(500).json({
            status: 'ERROR',
            error: err.message,
            timestamp: new Date().toISOString()
        });
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

    if (!process.env.BOT_TOKEN) {
        console.error('❌ BOT_TOKEN not set!');
        return res.status(500).json({ error: 'Server configuration error' });
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
// SIMPLE TEST ENDPOINT (no database needed)
// ============================================

app.get('/api/ping', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Server is running!',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ============================================
// USER API ENDPOINTS (with error handling)
// ============================================

app.post('/api/user', verifyTelegramData, async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'Database not available' });
    }
    
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
        res.status(500).json({ error: 'Database operation failed: ' + err.message });
    } finally {
        client.release();
    }
});

app.post('/api/ad-reward', verifyTelegramData, async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'Database not available' });
    }
    
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
        res.status(500).json({ error: 'Failed to process ad reward: ' + err.message });
    } finally {
        client.release();
    }
});

// Simple withdrawal endpoint (keeping it basic for now)
app.post('/api/withdraw', verifyTelegramData, async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'Database not available' });
    }
    
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
        res.status(500).json({ error: 'Failed to process withdrawal: ' + err.message });
    } finally {
        client.release();
    }
});

// Admin endpoints (simplified)
app.get('/api/admin/users', verifyAdmin, async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'Database not available' });
    }
    
    try {
        const result = await pool.query(`
            SELECT id, telegram_id, first_name, last_name, username, photo_url, 
                   referral_code, points, tier, referrals, wallet_address, created_at
            FROM users 
            ORDER BY id DESC
            LIMIT 100
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Admin users error:', err);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

app.get('/api/admin/withdrawals', verifyAdmin, async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'Database not available' });
    }
    
    try {
        const result = await pool.query(`
            SELECT w.*, u.username, u.first_name, u.telegram_id
            FROM withdrawals w
            JOIN users u ON w.user_id = u.id
            ORDER BY w.created_at DESC
            LIMIT 50
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Admin withdrawals error:', err);
        res.json([]);
    }
});

app.post('/api/admin/update-withdrawal', verifyAdmin, async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'Database not available' });
    }
    
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
    if (!pool) {
        return res.status(503).json({ error: 'Database not available' });
    }
    
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
// START SERVER WITH ERROR HANDLING
// ============================================

async function startServer() {
    // Test database connection first
    await testDatabaseConnection();
    
    // Start HTTP server
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log('========================================');
        console.log(`✅ SERVER IS RUNNING!`);
        console.log(`📡 Port: ${PORT}`);
        console.log(`🌐 URL: https://yzemanbot-backend.onrender.com`);
        console.log(`❤️  Health check: https://yzemanbot-backend.onrender.com/health`);
        console.log(`🏓 Ping test: https://yzemanbot-backend.onrender.com/api/ping`);
        console.log('========================================');
    });
    
    // Handle server errors
    server.on('error', (err) => {
        console.error('❌ Server error:', err);
        if (err.code === 'EADDRINUSE') {
            console.error(`Port ${PORT} is already in use`);
            process.exit(1);
        }
    });
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('SIGTERM received, closing server...');
        server.close(() => {
            console.log('Server closed');
            if (pool) pool.end();
            process.exit(0);
        });
    });
    
    process.on('SIGINT', () => {
        console.log('SIGINT received, closing server...');
        server.close(() => {
            console.log('Server closed');
            if (pool) pool.end();
            process.exit(0);
        });
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
        console.error('Uncaught Exception:', err);
        // Don't exit, let the server continue running
    });
    
    process.on('unhandledRejection', (err) => {
        console.error('Unhandled Rejection:', err);
        // Don't exit, let the server continue running
    });
}

// Start the server
startServer();
