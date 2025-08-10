require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { Telegraf } = require('telegraf');
const crypto = require('crypto');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Database setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Telegram Bot setup
const bot = new Telegraf(process.env.BOT_TOKEN);

async function initializeDatabase() {
  try {
    // Create users table first with proper primary key
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        points BIGINT DEFAULT 0,
        social_dollars DECIMAL(10,2) DEFAULT 0.00,
        tier VARCHAR(50) DEFAULT 'Fresher',
        multiplier DECIMAL(3,1) DEFAULT 1.0,
        next_tier_refs INTEGER DEFAULT 50,
        wallet_address VARCHAR(255),
        referral_code VARCHAR(10) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create other tables in dependency order
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        task_type VARCHAR(50) NOT NULL,
        completed_at TIMESTAMP,
        count INTEGER DEFAULT 0
      );
      
      CREATE TABLE IF NOT EXISTS social_tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        platform VARCHAR(50) NOT NULL,
        completed BOOLEAN DEFAULT FALSE,
        completed_at TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        referred_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        code VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS bonus_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        points INTEGER,
        dollars DECIMAL(10,2),
        is_daily BOOLEAN DEFAULT FALSE
      );
      
      CREATE TABLE IF NOT EXISTS bonus_redemptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        bonus_code_id INTEGER REFERENCES bonus_codes(id) ON DELETE CASCADE,
        redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        amount DECIMAL(10,2) NOT NULL,
        wallet_address VARCHAR(255) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP
      );
    `);
    
    // Insert initial bonus codes
    await pool.query(`
      INSERT INTO bonus_codes (code, points, dollars, is_daily)
      VALUES 
        ('BASER', 2000, 0, true),
        ('BOTYZEMAN', 100000, 0, true),
        ('EARNSBOTT', 0, 15, true),
        ('BONUSBOTTER', 0, 100, true),
        ('GAINMASTER', 50000, 100, true)
      ON CONFLICT (code) DO NOTHING;
    `);
    
    console.log('Database initialized');
  } catch (error) {
    console.error('Database initialization error:', error);
    // Add more detailed error logging
    console.error('Full error object:', JSON.stringify(error, null, 2));
  }
}

initializeDatabase();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Generate referral code
function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Find or create user
async function findOrCreateUser(userData) {
  const { id, first_name, last_name, username } = userData;
  
  const user = await pool.query(
    'SELECT * FROM users WHERE telegram_id = $1',
    [id]
  );
  
  if (user.rows.length > 0) {
    return user.rows[0];
  }
  
  const referralCode = generateReferralCode();
  const newUser = await pool.query(
    `INSERT INTO users 
    (telegram_id, first_name, last_name, username, referral_code) 
    VALUES ($1, $2, $3, $4, $5) 
    RETURNING *`,
    [id, first_name, last_name, username, referralCode]
  );
  
  return newUser.rows[0];
}

// Telegram verification middleware
function verifyTelegramData(req, res, next) {
  const initData = new URLSearchParams(req.body.initData);
  const hash = initData.get('hash');
  initData.delete('hash');
  
  const dataCheckString = Array.from(initData.entries())
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN);
  const calculatedHash = crypto.createHmac('sha256', secretKey.digest())
    .update(dataCheckString)
    .digest('hex');
  
  if (calculatedHash !== hash) {
    return res.status(401).json({ error: 'Invalid Telegram data' });
  }
  
  next();
}

// API Endpoints

// Serve HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get user data
app.post('/get-user-data', verifyTelegramData, async (req, res) => {
  try {
    const initData = new URLSearchParams(req.body.initData);
    const userJson = initData.get('user');
    const userData = JSON.parse(userJson);
    
    const user = await findOrCreateUser(userData);
    
    // Get user tasks
    const tasks = await pool.query(
      'SELECT * FROM tasks WHERE user_id = $1',
      [user.id]
    );
    
    // Get social tasks
    const socialTasks = await pool.query(
      'SELECT * FROM social_tasks WHERE user_id = $1',
      [user.id]
    );
    
    // Get bonus redemptions
    const bonusRedemptions = await pool.query(
      'SELECT bonus_code_id FROM bonus_redemptions WHERE user_id = $1',
      [user.id]
    );
    
    // Calculate next reset time (midnight UTC)
    const now = new Date();
    const resetTime = new Date(now);
    resetTime.setUTCHours(24, 0, 0, 0);
    
    res.json({
      user: {
        ...user,
        next_reset: resetTime.toISOString()
      },
      tasks: tasks.rows,
      socialTasks: socialTasks.rows,
      bonusRedemptions: bonusRedemptions.rows.map(r => r.bonus_code_id)
    });
  } catch (error) {
    console.error('Error getting user data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Complete task
app.post('/complete-task', verifyTelegramData, async (req, res) => {
  try {
    const { userId, taskType, points } = req.body;
    
    // Update user points
    await pool.query(
      'UPDATE users SET points = points + $1 WHERE id = $2',
      [points, userId]
    );
    
    // Update task record
    await pool.query(
      `INSERT INTO tasks (user_id, task_type, completed_at, count)
      VALUES ($1, $2, NOW(), 1)
      ON CONFLICT (user_id, task_type) 
      DO UPDATE SET 
        completed_at = NOW(), 
        count = tasks.count + 1`,
      [userId, taskType]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error completing task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Apply referral code
app.post('/apply-referral', verifyTelegramData, async (req, res) => {
  try {
    const { userId, code } = req.body;
    
    // Find referrer by code
    const referrer = await pool.query(
      'SELECT id FROM users WHERE referral_code = $1',
      [code]
    );
    
    if (referrer.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid referral code' });
    }
    
    const referrerId = referrer.rows[0].id;
    
    // Check if already referred
    const existingReferral = await pool.query(
      'SELECT id FROM referrals WHERE referred_id = $1',
      [userId]
    );
    
    if (existingReferral.rows.length > 0) {
      return res.status(400).json({ error: 'Already used a referral code' });
    }
    
    // Create referral relationship
    await pool.query(
      'INSERT INTO referrals (referrer_id, referred_id, code) VALUES ($1, $2, $3)',
      [referrerId, userId, code]
    );
    
    // Reward both users
    await pool.query(
      'UPDATE users SET points = points + 1000 WHERE id IN ($1, $2)',
      [referrerId, userId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error applying referral:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Redeem bonus code
app.post('/redeem-bonus', verifyTelegramData, async (req, res) => {
  try {
    const { userId, code } = req.body;
    
    // Find bonus code
    const bonus = await pool.query(
      'SELECT * FROM bonus_codes WHERE code = $1',
      [code]
    );
    
    if (bonus.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid bonus code' });
    }
    
    const bonusData = bonus.rows[0];
    
    // Check if already redeemed
    const redemption = await pool.query(
      `SELECT id FROM bonus_redemptions 
      WHERE user_id = $1 AND bonus_code_id = $2`,
      [userId, bonusData.id]
    );
    
    if (redemption.rows.length > 0 && !bonusData.is_daily) {
      return res.status(400).json({ error: 'Bonus code already used' });
    }
    
    // Record redemption
    await pool.query(
      'INSERT INTO bonus_redemptions (user_id, bonus_code_id) VALUES ($1, $2)',
      [userId, bonusData.id]
    );
    
    // Apply rewards
    if (bonusData.points > 0) {
      await pool.query(
        'UPDATE users SET points = points + $1 WHERE id = $2',
        [bonusData.points, userId]
      );
    }
    
    if (bonusData.dollars > 0) {
      await pool.query(
        'UPDATE users SET social_dollars = social_dollars + $1 WHERE id = $2',
        [bonusData.dollars, userId]
      );
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error redeeming bonus:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save wallet address
app.post('/save-wallet', verifyTelegramData, async (req, res) => {
  try {
    const { userId, walletAddress } = req.body;
    
    await pool.query(
      'UPDATE users SET wallet_address = $1 WHERE id = $2',
      [walletAddress, userId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving wallet:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Request withdrawal
app.post('/request-withdrawal', verifyTelegramData, async (req, res) => {
  try {
    const { userId } = req.body;
    
    // Get user data
    const user = await pool.query(
      'SELECT points, social_dollars, wallet_address FROM users WHERE id = $1',
      [userId]
    );
    
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = user.rows[0];
    const usdValue = (userData.points / 100000) + userData.social_dollars;
    
    if (usdValue < 1000) {
      return res.status(400).json({ error: 'Minimum withdrawal is $1000' });
    }
    
    if (!userData.wallet_address) {
      return res.status(400).json({ error: 'Wallet address not set' });
    }
    
    // Create withdrawal request
    await pool.query(
      `INSERT INTO withdrawals 
      (user_id, amount, wallet_address, status) 
      VALUES ($1, $2, $3, 'pending')`,
      [userId, usdValue, userData.wallet_address]
    );
    
    // Reset user points
    await pool.query(
      'UPDATE users SET points = 0, social_dollars = 0 WHERE id = $1',
      [userId]
    );
    
    // Notify admin
    const message = `🤑 New withdrawal request!\n\nUser: ${userId}\nAmount: $${usdValue.toFixed(2)}\nWallet: ${userData.wallet_address}`;
    bot.telegram.sendMessage(process.env.ADMIN_CHAT_ID, message);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error requesting withdrawal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Telegram bot commands
bot.start(async (ctx) => {
  const referralCode = ctx.message.text.split(' ')[1];
  const user = await findOrCreateUser(ctx.from);
  
  if (referralCode && referralCode.startsWith('ref-')) {
    const code = referralCode.split('-')[1];
    
    // Apply referral code
    const referrer = await pool.query(
      'SELECT id FROM users WHERE referral_code = $1',
      [code]
    );
    
    if (referrer.rows.length > 0) {
      const referrerId = referrer.rows[0].id;
      
      // Create referral relationship
      await pool.query(
        'INSERT INTO referrals (referrer_id, referred_id, code) VALUES ($1, $2, $3)',
        [referrerId, user.id, code]
      );
      
      // Reward both users
      await pool.query(
        'UPDATE users SET points = points + 1000 WHERE id IN ($1, $2)',
        [referrerId, user.id]
      );
    }
  }
  
  const welcomeMessage = `👋 Welcome to YzemanBot!\n\n` +
    `Earn rewards by completing tasks and inviting friends.\n\n` +
    `Start earning now: Click Yzemanbot button`;
  
  ctx.reply(welcomeMessage);
});

// Daily reset cron job (runs at midnight UTC)
const cron = require('node-cron');
cron.schedule('0 0 * * *', async () => {
  try {
    // Reset daily task counts
    await pool.query(
      "DELETE FROM tasks WHERE task_type IN ('ad_watch', 'premium_ad', 'website', 'youtube_watch')"
    );
    
    console.log('Daily tasks reset');
  } catch (error) {
    console.error('Error resetting daily tasks:', error);
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  
  // Start Telegram bot
  bot.launch();
  console.log('Telegram bot started');
});