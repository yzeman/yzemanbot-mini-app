require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const axios = require('axios');
const crypto = require('crypto');
const app = express();

// Configuration
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// Database connection with production SSL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(bodyParser.json({ limit: '10kb' }));
app.use(express.static('public'));

// Database initialization (optimized)
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
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
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tiers (
        name TEXT PRIMARY KEY,
        refs_required INTEGER NOT NULL,
        multiplier REAL NOT NULL,
        referral_reward INTEGER NOT NULL
      )`);

    await client.query(`
      INSERT INTO tiers (name, refs_required, multiplier, referral_reward) 
      VALUES 
        ('Fresher', 0, 1.0, 1000),
        ('Brute', 50, 1.2, 1500),
        ('Silver', 150, 1.5, 2000),
        ('Gold', 300, 2.0, 3000),
        ('Platinum', 500, 3.0, 5000)
      ON CONFLICT (name) DO NOTHING`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id INTEGER NOT NULL REFERENCES users(id),
        referred_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (referred_id)  -- Ensure a user can only be referred once
      )`);

    await client.query('COMMIT');
    console.log('Database initialized');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('DB Init Error:', err.stack);
    throw err;
  } finally {
    client.release();
  }
}

// Enhanced Telegram verification
async function verifyTelegramData(req, res, next) {
  if (!req.body?.initData) {
    return res.status(400).json({ error: 'Missing Telegram data' });
  }

  try {
    const initData = new URLSearchParams(req.body.initData);
    const hash = initData.get('hash');
    const authDate = initData.get('auth_date');
    
    // Validate auth date (prevent replay attacks)
    if (Date.now() / 1000 - parseInt(authDate) > 86400) {
      return res.status(401).json({ error: 'Expired auth' });
    }

    // Hash verification
    initData.delete('hash');
    const dataCheckString = Array.from(initData.entries())
      .map(([k,v]) => `${k}=${v}`)
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
    console.error('Auth Error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// Routes
app.post('/api/user', verifyTelegramData, async (req, res) => {
	// Convert numeric fields to numbers
const responseData = { ...user, ...stats };
responseData.points = Number(responseData.points);
responseData.referrals = Number(responseData.referrals);
responseData.multiplier = Number(responseData.multiplier);
responseData.referral_reward = Number(responseData.referral_reward);

res.json(responseData);
  const client = await pool.connect();
  try {
    const { id, first_name, last_name, username, photo_url } = req.telegramUser;
    const referralCode = req.body.referralCode;
    
    await client.query('BEGIN');
    
    // Generate unique referral code for new user
    const userReferralCode = `YZEMAN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    
    // Upsert user with referral code
    const { rows: [user] } = await client.query(`
      INSERT INTO users (telegram_id, first_name, last_name, username, photo_url, referral_code)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (telegram_id) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        username = EXCLUDED.username,
        photo_url = EXCLUDED.photo_url
      RETURNING *`,
      [id, first_name, last_name, username, photo_url, userReferralCode]
    );

    // Process referral if provided
    if (referralCode) {
      const referrerResult = await client.query(
        'SELECT id FROM users WHERE referral_code = $1',
        [referralCode]
      );
      
      if (referrerResult.rows.length > 0 && referrerResult.rows[0].id !== user.id) {
        // Insert referral record
        await client.query(
          'INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [referrerResult.rows[0].id, user.id]
        );
        
        // Get referrer's tier and reward amount
        const tierResult = await client.query(
          `SELECT referral_reward FROM tiers WHERE name = (
            SELECT tier FROM users WHERE id = $1
          )`,
          [referrerResult.rows[0].id]
        );
        
        const reward = tierResult.rows[0]?.referral_reward || 1000;
        
        // Update referrer's points
        await client.query(
          'UPDATE users SET points = points + $1 WHERE id = $2',
          [reward, referrerResult.rows[0].id]
        );
      }
    }

    // Get user stats with referral count
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

// Handle referral redemptions
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
    
    if (referrerId === userId) {
      return res.status(400).json({ error: 'Cannot refer yourself' });
    }
    
    // Check if referral already exists
    const existingReferral = await client.query(
      'SELECT 1 FROM referrals WHERE referred_id = $1',
      [userId]
    );
    
    if (existingReferral.rows.length > 0) {
      return res.status(400).json({ error: 'Referral already processed' });
    }
    
    // Create referral record
    await client.query(
      'INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)',
      [referrerId, userId]
    );
    
    // Get referrer's tier and reward amount
    const tierResult = await client.query(
      `SELECT referral_reward FROM tiers WHERE name = (
        SELECT tier FROM users WHERE id = $1
      )`,
      [referrerId]
    );
    
    const reward = tierResult.rows[0]?.referral_reward || 1000;
    
    // Update referrer's points
    await client.query(
      'UPDATE users SET points = points + $1 WHERE id = $2',
      [reward, referrerId]
    );
    
    // Update referrer's referral count
    const referralCountResult = await client.query(
      'SELECT COUNT(*) FROM referrals WHERE referrer_id = $1',
      [referrerId]
    );
    const referralCount = parseInt(referralCountResult.rows[0].count);
    
    // Check for tier upgrade
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

// Health checks
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

// Error handling
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

// Server startup
const server = app.listen(PORT, async () => {
  console.log(`Server running in ${isProduction ? 'production' : 'development'} on port ${PORT}`);
  try {
    await initDB();
    console.log('✅ Database ready');
  } catch (err) {
    console.error('❌ Database initialization failed');
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    pool.end();
    console.log('Server closed');
    process.exit(0);
  });
});

// Enhanced error handling
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use`);
    process.exit(1);
  }
  throw err;
});