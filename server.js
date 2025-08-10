require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
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

// Database initialization
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Create tiers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tiers (
        name TEXT PRIMARY KEY,
        refs_required INTEGER NOT NULL,
        multiplier REAL NOT NULL,
        referral_reward INTEGER NOT NULL
      )`);

    // Insert tiers
    await client.query(`
      INSERT INTO tiers (name, refs_required, multiplier, referral_reward) 
      VALUES 
        ('Fresher', 0, 1.0, 1000),
        ('Brute', 50, 1.2, 1500),
        ('Silver', 150, 1.5, 2000),
        ('Gold', 300, 2.0, 3000),
        ('Platinum', 500, 3.0, 5000)
      ON CONFLICT (name) DO NOTHING`);

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
        points INTEGER DEFAULT 0,
        social_dollars INTEGER DEFAULT 0,
        wallet_address TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`);

    // Create referrals table
    await client.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id INTEGER REFERENCES users(id) NOT NULL,
        referee_id INTEGER REFERENCES users(id) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )`);

    // Create tasks table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) NOT NULL,
        task_type TEXT NOT NULL,
        points_earned INTEGER NOT NULL,
        completed_at TIMESTAMP DEFAULT NOW()
      )`);

    // Create bonus_codes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS bonus_codes (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        points INTEGER DEFAULT 0,
        dollars INTEGER DEFAULT 0,
        is_daily BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )`);

    // Insert bonus codes
    await client.query(`
      INSERT INTO bonus_codes (code, points, dollars, is_daily)
      VALUES 
        ('BASER', 2000, 0, true),
        ('BOTYZEMAN', 100000, 0, true),
        ('EARNSBOTT', 0, 15, true),
        ('BONUSBOTTER', 0, 100, true),
        ('GAINMASTER', 50000, 100, true)
      ON CONFLICT (code) DO NOTHING`);

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

// Telegram verification
async function verifyTelegramData(req, res, next) {
  if (!req.body?.initData) {
    return res.status(400).json({ error: 'Missing Telegram data' });
  }

  try {
    const initData = new URLSearchParams(req.body.initData);
    const hash = initData.get('hash');
    const authDate = initData.get('auth_date');
    
    // Validate auth date
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

// Get or create user
app.post('/api/user', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id, first_name, last_name, username, photo_url } = req.telegramUser;
    
    await client.query('BEGIN');
    
    // Upsert user
    const userQuery = `
      INSERT INTO users (telegram_id, first_name, last_name, username, photo_url, referral_code)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (telegram_id) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        username = EXCLUDED.username,
        photo_url = EXCLUDED.photo_url
      RETURNING *`;
    
    const referralCode = `REF-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const userValues = [id, first_name, last_name, username, photo_url, referralCode];
    
    const { rows: [user] } = await client.query(userQuery, userValues);

    // Get user stats
    const statsQuery = `
      SELECT 
        COALESCE(COUNT(r.id), 0) AS referrals,
        t.name AS tier,
        t.multiplier,
        t.referral_reward
      FROM users u
      LEFT JOIN referrals r ON r.referrer_id = u.id
      LEFT JOIN tiers t ON t.refs_required <= COALESCE(COUNT(r.id), 0)
      WHERE u.id = $1
      GROUP BY u.id, t.name, t.multiplier, t.referral_reward
      ORDER BY t.refs_required DESC
      LIMIT 1`;
    
    const { rows: [stats] } = await client.query(statsQuery, [user.id]);

    // Get user points and social dollars
    const pointsQuery = `
      SELECT points, social_dollars, wallet_address 
      FROM users 
      WHERE id = $1`;
    
    const { rows: [pointsData] } = await client.query(pointsQuery, [user.id]);

    await client.query('COMMIT');
    
    // Combine all user data
    const userData = {
      ...user,
      ...stats,
      points: pointsData.points,
      socialDollars: pointsData.social_dollars,
      walletAddress: pointsData.wallet_address
    };
    
    res.json(userData);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('User Error:', err);
    res.status(500).json({ error: 'Database operation failed' });
  } finally {
    client.release();
  }
});

// Complete task endpoint
app.post('/api/complete-task', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.telegramUser;
    const { taskType, points } = req.body;
    
    await client.query('BEGIN');
    
    // Get user
    const userQuery = `SELECT id FROM users WHERE telegram_id = $1`;
    const { rows: [user] } = await client.query(userQuery, [id]);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Update user points
    const updateQuery = `
      UPDATE users 
      SET points = points + $1, 
          updated_at = NOW()
      WHERE id = $2
      RETURNING points`;
    
    await client.query(updateQuery, [points, user.id]);
    
    // Record task completion
    const taskQuery = `
      INSERT INTO tasks (user_id, task_type, points_earned)
      VALUES ($1, $2, $3)`;
    
    await client.query(taskQuery, [user.id, taskType, points]);
    
    await client.query('COMMIT');
    res.json({ success: true, points });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Task Error:', err);
    res.status(500).json({ error: 'Failed to complete task' });
  } finally {
    client.release();
  }
});

// Health check
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

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use`);
    process.exit(1);
  }
  throw err;
});