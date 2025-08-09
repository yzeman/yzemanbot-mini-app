require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Create tables if they don't exist
const initializeDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        points BIGINT DEFAULT 0,
        referrals INTEGER DEFAULT 0,
        tier VARCHAR(50) DEFAULT 'Fresher',
        multiplier FLOAT DEFAULT 1.0,
        next_tier_refs INTEGER DEFAULT 15,
        social_dollars FLOAT DEFAULT 0,
        wallet_address VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        task_type VARCHAR(50) NOT NULL,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reward INTEGER NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        amount FLOAT NOT NULL,
        wallet_address VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Database tables initialized');
  } catch (err) {
    console.error('Error initializing database:', err);
  }
};

initializeDatabase();

// Telegram bot setup
const botToken = process.env.BOT_TOKEN;
const adminChatId = process.env.ADMIN_CHAT_ID;

// Middleware to verify Telegram initData
const verifyTelegramData = (req, res, next) => {
  const initData = req.headers['x-telegram-initdata'];
  
  if (!initData) {
    return res.status(401).json({ error: 'Telegram initData missing' });
  }
  
  // In a real implementation, you would verify the hash here
  // For simplicity, we'll just proceed
  next();
};

// Get or create user
app.post('/api/user', verifyTelegramData, async (req, res) => {
  try {
    const { user } = req.body;
    const result = await pool.query(
      `INSERT INTO users (telegram_id, username, first_name, last_name) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (telegram_id) 
       DO UPDATE SET updated_at = CURRENT_TIMESTAMP 
       RETURNING *`,
      [user.id, user.username, user.first_name, user.last_name]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user data
app.put('/api/user/:id', verifyTelegramData, async (req, res) => {
  try {
    const userId = req.params.id;
    const userData = req.body;
    
    const result = await pool.query(
      `UPDATE users 
       SET points = $1, referrals = $2, tier = $3, multiplier = $4, 
           next_tier_refs = $5, social_dollars = $6, wallet_address = $7, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $8 
       RETURNING *`,
      [
        userData.points,
        userData.referrals,
        userData.tier,
        userData.multiplier,
        userData.next_tier_refs,
        userData.social_dollars,
        userData.wallet_address,
        userId
      ]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Record completed task
app.post('/api/task', verifyTelegramData, async (req, res) => {
  try {
    const { userId, taskType, reward } = req.body;
    
    await pool.query(
      `INSERT INTO tasks (user_id, task_type, reward) 
       VALUES ($1, $2, $3)`,
      [userId, taskType, reward]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Handle withdrawal request
app.post('/api/withdraw', verifyTelegramData, async (req, res) => {
  try {
    const { userId, amount, walletAddress } = req.body;
    
    // Create withdrawal record
    await pool.query(
      `INSERT INTO withdrawals (user_id, amount, wallet_address) 
       VALUES ($1, $2, $3)`,
      [userId, amount, walletAddress]
    );
    
    // Notify admin
    const message = `New withdrawal request!\n\nUser ID: ${userId}\nAmount: $${amount}\nWallet: ${walletAddress}`;
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: adminChatId,
      text: message
    });
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Handle referral registration
app.post('/api/referral', verifyTelegramData, async (req, res) => {
  try {
    const { referrerId, referredId } = req.body;
    
    // Update referrer's count
    await pool.query(
      `UPDATE users 
       SET referrals = referrals + 1, 
           points = points + (SELECT referral_reward FROM tiers WHERE name = tier)
       WHERE id = $1`,
      [referrerId]
    );
    
    // Add referral bonus to referred user
    await pool.query(
      `UPDATE users 
       SET points = points + 1000 
       WHERE id = $1`,
      [referredId]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});