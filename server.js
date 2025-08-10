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

    // Other table creations...
    await client.query('COMMIT');
    console.log('Database initialized');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('DB Init Error:', err.stack);
    throw err; // Critical - fail fast
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

// Routes (optimized with transaction support)
app.post('/api/user', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id, first_name, last_name, username, photo_url } = req.telegramUser;
    
    await client.query('BEGIN');
    
    // Upsert user with RETURNING clause
    const { rows: [user] } = await client.query(`
      INSERT INTO users (telegram_id, first_name, last_name, username, photo_url, referral_code)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (telegram_id) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        username = EXCLUDED.username,
        photo_url = EXCLUDED.photo_url
      RETURNING *`,
      [id, first_name, last_name, username, photo_url, `REF-${crypto.randomBytes(3).toString('hex').toUpperCase()}`]
    );

    // Get stats in single query
    const { rows: [stats] } = await client.query(`
      SELECT 
        COUNT(r.*) as referrals,
        t.name as tier,
        t.multiplier,
        t.referral_reward
      FROM users u
      LEFT JOIN referrals r ON r.referrer_id = u.id
      LEFT JOIN tiers t ON t.refs_required <= COUNT(r.*) 
      WHERE u.id = $1
      GROUP BY u.id, t.name, t.multiplier, t.referral_reward
      ORDER BY t.refs_required DESC
      LIMIT 1`,
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