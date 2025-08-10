require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3001;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

// Database initialization
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        first_name TEXT,
        last_name TEXT,
        username TEXT,
        photo_url TEXT,
        points BIGINT DEFAULT 0,
        referrals INTEGER DEFAULT 0,
        tier TEXT DEFAULT 'Fresher',
        multiplier REAL DEFAULT 1.0,
        next_tier_refs INTEGER DEFAULT 50,
        wallet_address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS user_tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        task_type TEXT NOT NULL,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id INTEGER REFERENCES users(id),
        referred_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS bonus_redemptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        code TEXT NOT NULL,
        redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        amount NUMERIC(10,2) NOT NULL,
        wallet_address TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      );
    `);
    console.log('Database initialized');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

// Telegram verification middleware
async function verifyTelegramData(req, res, next) {
  const initData = req.body.initData;
  if (!initData) return res.status(400).send('Missing Telegram data');
  
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');
    
    const dataToCheck = Array.from(urlParams.entries())
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('\n');
    
    const secret = await crypto.createHmac('sha256', 'WebAppData')
      .update(process.env.BOT_TOKEN)
      .digest();
    
    const calculatedHash = await crypto.createHmac('sha256', secret)
      .update(dataToCheck)
      .digest('hex');
    
    if (calculatedHash !== hash) {
      return res.status(401).send('Invalid Telegram data');
    }
    
    req.telegramUser = JSON.parse(urlParams.get('user'));
    next();
  } catch (err) {
    console.error('Verification error:', err);
    res.status(500).send('Server error');
  }
}

// Routes
app.post('/api/user', verifyTelegramData, async (req, res) => {
  try {
    const { id, first_name, last_name, username, photo_url } = req.telegramUser;
    
    // Check if user exists
    const userResult = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [id]
    );
    
    let user;
    if (userResult.rows.length === 0) {
      // Create new user
      const newUser = await pool.query(
        `INSERT INTO users 
        (telegram_id, first_name, last_name, username, photo_url) 
        VALUES ($1, $2, $3, $4, $5) 
        RETURNING *`,
        [id, first_name, last_name || null, username || null, photo_url || null]
      );
      user = newUser.rows[0];
    } else {
      user = userResult.rows[0];
    }
    
    // Get user stats
    const referrals = await pool.query(
      'SELECT COUNT(*) FROM referrals WHERE referrer_id = $1',
      [user.id]
    );
    
    const tierResult = await pool.query(
      `SELECT name, multiplier, referral_reward FROM tiers 
       WHERE refs_required <= $1 
       ORDER BY refs_required DESC LIMIT 1`,
      [referrals.rows[0].count]
    );
    
    res.json({
      ...user,
      referrals: referrals.rows[0].count,
      tier: tierResult.rows[0]?.name || 'Fresher',
      multiplier: tierResult.rows[0]?.multiplier || 1.0,
      referralReward: tierResult.rows[0]?.referral_reward || 1000
    });
  } catch (err) {
    console.error('User error:', err);
    res.status(500).send('Server error');
  }
});

app.post('/api/complete-task', verifyTelegramData, async (req, res) => {
  try {
    const { taskType, points } = req.body;
    const { id } = req.telegramUser;
    
    // Get user
    const user = await pool.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [id]
    );
    
    if (user.rows.length === 0) {
      return res.status(404).send('User not found');
    }
    
    // Record task completion
    await pool.query(
      'INSERT INTO user_tasks (user_id, task_type) VALUES ($1, $2)',
      [user.rows[0].id, taskType]
    );
    
    // Update points
    await pool.query(
      'UPDATE users SET points = points + $1 WHERE id = $2',
      [points, user.rows[0].id]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('Task error:', err);
    res.status(500).send('Server error');
  }
});

app.post('/api/redeem-bonus', verifyTelegramData, async (req, res) => {
  try {
    const { code } = req.body;
    const { id } = req.telegramUser;
    
    // Get user
    const user = await pool.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [id]
    );
    
    if (user.rows.length === 0) {
      return res.status(404).send('User not found');
    }
    
    // Check bonus code
    const bonusResult = await pool.query(
      'SELECT points FROM bonus_codes WHERE code = $1',
      [code]
    );
    
    if (bonusResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid bonus code' });
    }
    
    // Check if already redeemed
    const redeemed = await pool.query(
      `SELECT id FROM bonus_redemptions 
       WHERE user_id = $1 AND code = $2`,
      [user.rows[0].id, code]
    );
    
    if (redeemed.rows.length > 0) {
      return res.status(400).json({ error: 'Code already redeemed' });
    }
    
    // Record redemption
    await pool.query(
      'INSERT INTO bonus_redemptions (user_id, code) VALUES ($1, $2)',
      [user.rows[0].id, code]
    );
    
    // Update points
    await pool.query(
      'UPDATE users SET points = points + $1 WHERE id = $2',
      [bonusResult.rows[0].points, user.rows[0].id]
    );
    
    res.json({ success: true, points: bonusResult.rows[0].points });
  } catch (err) {
    console.error('Bonus error:', err);
    res.status(500).send('Server error');
  }
});

app.post('/api/withdraw', verifyTelegramData, async (req, res) => {
  try {
    const { walletAddress } = req.body;
    const { id } = req.telegramUser;
    
    // Get user
    const userResult = await pool.query(
      'SELECT id, points FROM users WHERE telegram_id = $1',
      [id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).send('User not found');
    }
    
    const user = userResult.rows[0];
    const amountUSD = user.points / 100000;
    
    // Validate withdrawal amount
    if (amountUSD < 1000) {
      return res.status(400).json({ error: 'Minimum $1000 required' });
    }
    
    // Create withdrawal request
    await pool.query(
      `INSERT INTO withdrawals 
      (user_id, amount, wallet_address) 
      VALUES ($1, $2, $3)`,
      [user.id, amountUSD, walletAddress]
    );
    
    // Reset user points
    await pool.query(
      'UPDATE users SET points = 0 WHERE id = $1',
      [user.id]
    );
    
    // Notify admin
    const message = `New withdrawal request!\nUser: ${id}\nAmount: $${amountUSD}\nWallet: ${walletAddress}`;
    await axios.post(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.ADMIN_CHAT_ID,
      text: message
    });
    
    res.json({ success: true });
  } catch (err) {
    console.error('Withdrawal error:', err);
    res.status(500).send('Server error');
  }
});

app.post('/api/referral', verifyTelegramData, async (req, res) => {
  try {
    const { referralCode } = req.body;
    const { id } = req.telegramUser;
    
    // Get referrer
    const referrerResult = await pool.query(
      'SELECT id FROM users WHERE referral_code = $1',
      [referralCode]
    );
    
    if (referrerResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid referral code' });
    }
    
    // Get current user
    const userResult = await pool.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).send('User not found');
    }
    
    // Record referral
    await pool.query(
      'INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)',
      [referrerResult.rows[0].id, userResult.rows[0].id]
    );
    
    // Update referrer's points
    await pool.query(
      `UPDATE users SET 
        points = points + (SELECT referral_reward FROM tiers WHERE name = tier),
        referrals = referrals + 1 
       WHERE id = $1`,
      [referrerResult.rows[0].id]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('Referral error:', err);
    res.status(500).send('Server error');
  }
});

CREATE TABLE tiers (
  name TEXT PRIMARY KEY,
  refs_required INTEGER NOT NULL,
  multiplier REAL NOT NULL,
  referral_reward INTEGER NOT NULL
);

INSERT INTO tiers (name, refs_required, multiplier, referral_reward) VALUES
('Fresher', 0, 1.0, 1000),
('Brute', 50, 1.2, 1500),
('Silver', 150, 1.5, 2000),
('Gold', 300, 2.0, 3000),
('Platinum', 500, 3.0, 5000);

CREATE TABLE bonus_codes (
  code TEXT PRIMARY KEY,
  points INTEGER NOT NULL
);

-- Add referral code to users table
ALTER TABLE users ADD COLUMN referral_code TEXT UNIQUE;

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initDB();

});
