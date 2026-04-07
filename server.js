const { Pool } = require('pg');
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const app = express();

// Configuration
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

// Handle database connection errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Middleware
app.use(bodyParser.json({ limit: '10kb' }));
app.use(express.static('public'));

// Add global error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

// Database initialization
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        first_name TEXT,
        last_name TEXT,
        username TEXT,
        photo_url TEXT,
        referral_code TEXT UNIQUE,
        points BIGINT NOT NULL DEFAULT 0,
        tier TEXT NOT NULL DEFAULT 'Fresher',
        referrals INTEGER NOT NULL DEFAULT 0,
        wallet_address TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`);

    // Create tiers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tiers (
        name TEXT PRIMARY KEY,
        refs_required INTEGER NOT NULL,
        multiplier REAL NOT NULL,
        referral_reward INTEGER NOT NULL
      )`);

    // Insert default tiers
    await client.query(`
      INSERT INTO tiers (name, refs_required, multiplier, referral_reward) 
      VALUES 
        ('Fresher', 0, 1.0, 5000),
        ('Brute', 50, 1.2, 10000),
        ('Silver', 150, 1.5, 15000),
        ('Gold', 300, 2.0, 20000),
        ('Platinum', 500, 3.0, 30000)
      ON CONFLICT (name) DO NOTHING`);

    // Create referrals table
    await client.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id INTEGER NOT NULL REFERENCES users(id),
        referred_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (referred_id)
      )`);

    // Create ad_rewards table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ad_rewards (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        reward_amount INTEGER NOT NULL,
        ad_type TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`);

    // Create withdrawals table
    await client.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount DECIMAL(10,2) NOT NULL,
        wallet_address TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query('COMMIT');
    console.log('✅ Database initialized successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database initialization failed:', err.stack);
    throw err;
  } finally {
    client.release();
  }
}

// Telegram verification middleware
async function verifyTelegramData(req, res, next) {
  if (!req.body?.initData) {
    return res.status(400).json({ error: 'Missing Telegram data' });
  }

  try {
    const initData = new URLSearchParams(req.body.initData);
    const hash = initData.get('hash');
    const authDate = initData.get('auth_date');
    
    // Validate auth date (24 hour window)
    if (Date.now() / 1000 - parseInt(authDate) > 86400) {
      return res.status(401).json({ error: 'Expired authentication' });
    }

    // Prepare data check string
    initData.delete('hash');
    const dataCheckString = Array.from(initData.entries())
      .map(([k,v]) => `${k}=${v}`)
      .sort()
      .join('\n');

    // Verify hash
    const secretKey = crypto.createHmac('sha256', 'WebAppData')
      .update(process.env.BOT_TOKEN)
      .digest();

    const calculatedHash = crypto.createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      return res.status(401).json({ error: 'Invalid hash' });
    }

    // Attach user to request
    req.telegramUser = JSON.parse(initData.get('user'));
    next();
  } catch (err) {
    console.error('Authentication Error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// API Endpoints

// Ad reward endpoint
app.post('/api/ad-reward', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { rewardAmount, adType } = req.body;
    const telegramId = req.telegramUser.id;

    if (!rewardAmount || !adType) {
      return res.status(400).json({ error: 'Missing reward parameters' });
    }

    await client.query('BEGIN');
    
    // Get user ID
    const userResult = await client.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userId = userResult.rows[0].id;
    
    // Record the reward
    await client.query(
      'INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)',
      [userId, rewardAmount, adType]
    );
    
    // Update user points
    await client.query(
      'UPDATE users SET points = points + $1 WHERE id = $2',
      [rewardAmount, userId]
    );
    
    // Get updated points
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

// User registration/update endpoint
app.post('/api/user', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id, first_name, last_name, username, photo_url } = req.telegramUser;
    const referralCode = req.body.referralCode;
    const walletAddress = req.body.walletAddress;
    
    await client.query('BEGIN');
    
    // Check if user exists
    const existingUser = await client.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [id]
    );
    
    let user;
    
    if (existingUser.rows.length > 0) {
      // Update existing user
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
      // Generate unique referral code for new user
      const userReferralCode = `YZEMAN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      
      // Create new user
      const insertQuery = `
        INSERT INTO users (telegram_id, first_name, last_name, username, photo_url, referral_code, wallet_address)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      const result = await client.query(insertQuery, [
        id, first_name, last_name, username, photo_url, userReferralCode, walletAddress
      ]);
      user = result.rows[0];
      
      // Process referral if provided (only for new users)
      if (referralCode && referralCode !== userReferralCode) {
        // Find referrer by referral code
        const referrerResult = await client.query(
          'SELECT id, tier FROM users WHERE referral_code = $1',
          [referralCode]
        );
        
        if (referrerResult.rows.length > 0 && referrerResult.rows[0].id !== user.id) {
          const referrerId = referrerResult.rows[0].id;
          const referrerTier = referrerResult.rows[0].tier;
          
          // Get reward amount based on referrer's tier
          const tierResult = await client.query(
            'SELECT referral_reward FROM tiers WHERE name = $1',
            [referrerTier]
          );
          
          const reward = tierResult.rows[0]?.referral_reward || 5000;
          
          // Create referral relationship
          await client.query(
            'INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [referrerId, user.id]
          );
          
          // Award points to referrer
          await client.query(
            'UPDATE users SET points = points + $1, referrals = referrals + 1 WHERE id = $2',
            [reward, referrerId]
          );
          
          // Check and update referrer's tier based on new referral count
          const newReferralCount = await client.query(
            'SELECT COUNT(*) FROM referrals WHERE referrer_id = $1',
            [referrerId]
          );
          const count = parseInt(newReferralCount.rows[0].count);
          
          // Find appropriate tier
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
          
          // Give bonus to new user
          await client.query(
            'UPDATE users SET points = points + 500 WHERE id = $1',
            [user.id]
          );
        }
      }
    }
    
    // Get user stats
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

// Referral processing endpoint
app.post('/api/referral', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { referralCode } = req.body;
    const telegramId = req.telegramUser.id;

    if (!referralCode) {
      return res.status(400).json({ error: 'Missing referral code' });
    }

    await client.query('BEGIN');
    
    // Get current user
    const userResult = await client.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userId = userResult.rows[0].id;
    
    // Get referrer
    const referrerResult = await client.query(
      'SELECT id FROM users WHERE referral_code = $1',
      [referralCode]
    );
    
    if (referrerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid referral code' });
    }
    
    const referrerId = referrerResult.rows[0].id;
    
    // Prevent self-referral
    if (referrerId === userId) {
      return res.status(400).json({ error: 'Cannot refer yourself' });
    }
    
    // Check if already referred
    const existingReferral = await client.query(
      'SELECT 1 FROM referrals WHERE referred_id = $1',
      [userId]
    );
    
    if (existingReferral.rows.length > 0) {
      return res.status(400).json({ error: 'Referral already processed' });
    }
    
    // Create referral
    await client.query(
      'INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)',
      [referrerId, userId]
    );
    
    // Get referrer's reward amount
    const tierResult = await client.query(
      `SELECT referral_reward FROM tiers WHERE name = (
        SELECT tier FROM users WHERE id = $1
      )`,
      [referrerId]
    );
    
    const reward = tierResult.rows[0]?.referral_reward || 5000;
    
    // Award referrer
    await client.query(
      'UPDATE users SET points = points + $1, referrals = referrals + 1 WHERE id = $2',
      [reward, referrerId]
    );
    
    // Check for tier upgrade
    const referralCountResult = await client.query(
      'SELECT COUNT(*) FROM referrals WHERE referrer_id = $1',
      [referrerId]
    );
    const referralCount = parseInt(referralCountResult.rows[0].count);
    
    const tierUpgrade = await client.query(
      `SELECT name FROM tiers 
       WHERE refs_required <= $1 
       ORDER BY refs_required DESC 
       LIMIT 1`,
      [referralCount]
    );
    
    if (tierUpgrade.rows.length > 0) {
      await client.query(
        'UPDATE users SET tier = $1 WHERE id = $2',
        [tierUpgrade.rows[0].name, referrerId]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, reward });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Referral Error:', err);
    res.status(500).json({ error: 'Database operation failed' });
  } finally {
    client.release();
  }
});

// Withdrawal request endpoint
app.post('/api/withdraw', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { amount, walletAddress } = req.body;
    const telegramId = req.telegramUser.id;
    
    // Get user
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
    
    // Deduct points
    await client.query(
      'UPDATE users SET points = points - $1 WHERE id = $2',
      [pointsNeeded, user.id]
    );
    
    // Create withdrawal request
    await client.query(
      'INSERT INTO withdrawals (user_id, amount, wallet_address, status) VALUES ($1, $2, $3, $4)',
      [user.id, amount, walletAddress, 'pending']
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

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ 
      status: 'OK',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({ status: 'DB unavailable' });
  }
});

// ============ ADMIN API ENDPOINTS ============

// Middleware to verify admin access
function verifyAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== 'Bearer admin123') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Get all users (admin only)
app.get('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, telegram_id, first_name, last_name, username, photo_url, 
             referral_code, points, tier, referrals, wallet_address, created_at
      FROM users 
      ORDER BY id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get all withdrawals (admin only)
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

// Get all referrals (admin only)
app.get('/api/admin/referrals', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        r.id, r.created_at,
        u1.username as referrer_username, u1.first_name as referrer_name,
        u2.username as referred_username, u2.first_name as referred_name,
        t.referral_reward as reward
      FROM referrals r
      JOIN users u1 ON r.referrer_id = u1.id
      JOIN users u2 ON r.referred_id = u2.id
      LEFT JOIN tiers t ON u1.tier = t.name
      ORDER BY r.created_at DESC
      LIMIT 500
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin referrals error:', err);
    res.json([]);
  }
});

// Update user (admin only)
app.post('/api/admin/update-user', verifyAdmin, async (req, res) => {
  const { userId, points, tier, referrals } = req.body;
  
  try {
    await pool.query(
      'UPDATE users SET points = $1, tier = $2, referrals = $3 WHERE id = $4',
      [points, tier, referrals, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Add points to user (admin only)
app.post('/api/admin/add-points', verifyAdmin, async (req, res) => {
  const { userId, points } = req.body;
  
  try {
    await pool.query(
      'UPDATE users SET points = points + $1 WHERE id = $2',
      [points, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Add points error:', err);
    res.status(500).json({ error: 'Failed to add points' });
  }
});

// Update withdrawal status (admin only)
app.post('/api/admin/update-withdrawal', verifyAdmin, async (req, res) => {
  const { withdrawalId, status } = req.body;
  
  try {
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

// Start server
async function startServer() {
  try {
    await initDB();
    console.log('✅ Database initialized and ready');
    
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running in ${isProduction ? 'production' : 'development'} on port ${PORT}`);
      console.log(`🔗 Database URL: ${process.env.DATABASE_URL ? 'configured' : 'missing'}`);
    });
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('🛑 SIGTERM received. Shutting down gracefully...');
      server.close(() => {
        pool.end();
        console.log('🔴 Server closed');
        process.exit(0);
      });
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} already in use`);
        process.exit(1);
      }
      console.error('❌ Server error:', err);
      process.exit(1);
    });
    
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

// Start the application
startServer();
