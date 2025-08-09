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
    // Create users table
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
        next_tier_refs INTEGER DEFAULT 50,
        social_dollars FLOAT DEFAULT 0,
        wallet_address VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create tasks table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        task_type VARCHAR(50) NOT NULL,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reward INTEGER NOT NULL
      );
    `);

    // Create withdrawals table
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

    // Create tiers table with updated requirements
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tiers (
        name VARCHAR(50) PRIMARY KEY,
        refs_required INTEGER NOT NULL,
        multiplier FLOAT NOT NULL,
        ad_reward INTEGER NOT NULL,
        referral_reward INTEGER NOT NULL
      );
    `);

    // Insert/update tiers with new requirements
    await pool.query(`
      INSERT INTO tiers (name, refs_required, multiplier, ad_reward, referral_reward)
      VALUES 
        ('Fresher', 0, 1.0, 51, 1000),
        ('Brute', 50, 1.2, 74, 1500),
        ('Silver', 150, 1.5, 105, 2000),
        ('Gold', 300, 2.0, 140, 3000),
        ('Platinum', 500, 3.0, 210, 5000)
      ON CONFLICT (name) DO UPDATE SET
        refs_required = EXCLUDED.refs_required,
        multiplier = EXCLUDED.multiplier,
        ad_reward = EXCLUDED.ad_reward,
        referral_reward = EXCLUDED.referral_reward;
    `);

    console.log('Database tables initialized with new tier requirements');
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
  
  // In production, add proper hash verification here
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

// Get user by Telegram ID
app.get('/api/user/:telegram_id', verifyTelegramData, async (req, res) => {
  try {
    const { telegram_id } = req.params;
    const result = await pool.query(
      `SELECT * FROM users WHERE telegram_id = $1`,
      [telegram_id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
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
    
    // Update user points
    await pool.query(
      `UPDATE users SET points = points + $1 WHERE id = $2`,
      [reward, userId]
    );
    
    // Record task
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

// Record social reward
app.post('/api/social', verifyTelegramData, async (req, res) => {
  try {
    const { userId, platform } = req.body;
    
    // Update user social dollars
    await pool.query(
      `UPDATE users SET social_dollars = social_dollars + 50 
       WHERE id = $1 AND NOT EXISTS (
         SELECT 1 FROM social_tasks 
         WHERE user_id = $1 AND platform = $2
       )`,
      [userId, platform]
    );
    
    // Record social task
    await pool.query(
      `INSERT INTO social_tasks (user_id, platform) 
       VALUES ($1, $2) 
       ON CONFLICT (user_id, platform) DO NOTHING`,
      [userId, platform]
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
    const withdrawalResult = await pool.query(
      `INSERT INTO withdrawals (user_id, amount, wallet_address) 
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, amount, walletAddress]
    );
    
    // Get user info for notification
    const userResult = await pool.query(
      `SELECT * FROM users WHERE id = $1`,
      [userId]
    );
    
    const user = userResult.rows[0];
    
    // Reset user's points to zero
    await pool.query(
      `UPDATE users SET points = 0, social_dollars = 0 WHERE id = $1`,
      [userId]
    );
    
    // Notify admin
    const message = `📬 New Withdrawal Request!\n\n👤 User: ${user.first_name} ${user.last_name || ''} (@${user.username || 'N/A'})\n🆔 Telegram ID: ${user.telegram_id}\n💵 Amount: $${amount}\n💰 Wallet: ${walletAddress}\n\n⚠️ Please process this request`;
    
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: adminChatId,
      text: message,
      parse_mode: 'Markdown'
    });
    
    res.json({ 
      success: true,
      withdrawal: withdrawalResult.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Handle referral registration
app.post('/api/referral', verifyTelegramData, async (req, res) => {
  try {
    const { referrerId, referredId } = req.body;
    
    // Get referrer's tier
    const tierResult = await pool.query(
      `SELECT t.referral_reward 
       FROM users u
       JOIN tiers t ON u.tier = t.name
       WHERE u.id = $1`,
      [referrerId]
    );
    
    const referralReward = tierResult.rows[0]?.referral_reward || 1000;
    
    // Update referrer's count and points
    await pool.query(
      `UPDATE users 
       SET referrals = referrals + 1, 
           points = points + $1
       WHERE id = $2`,
      [referralReward, referrerId]
    );
    
    // Add referral bonus to referred user
    await pool.query(
      `UPDATE users 
       SET points = points + 1000 
       WHERE id = $1`,
      [referredId]
    );
    
    // Check for tier upgrade
    await checkTierUpgrade(referrerId);
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Check and upgrade user tier
async function checkTierUpgrade(userId) {
  try {
    const userResult = await pool.query(
      `SELECT u.*, t.refs_required AS next_refs_required
       FROM users u
       LEFT JOIN tiers t ON t.name = (
         SELECT name FROM tiers 
         WHERE refs_required > u.referrals 
         ORDER BY refs_required ASC 
         LIMIT 1
       )
       WHERE u.id = $1`,
      [userId]
    );
    
    const user = userResult.rows[0];
    if (!user) return;
    
    // Check if user qualifies for next tier
    const nextTierResult = await pool.query(
      `SELECT * FROM tiers 
       WHERE refs_required <= $1 
       ORDER BY refs_required DESC 
       LIMIT 1`,
      [user.referrals]
    );
    
    if (nextTierResult.rows.length > 0) {
      const nextTier = nextTierResult.rows[0];
      
      if (user.tier !== nextTier.name) {
        // Upgrade user tier
        await pool.query(
          `UPDATE users 
           SET tier = $1, multiplier = $2
           WHERE id = $3`,
          [nextTier.name, nextTier.multiplier, userId]
        );
        
        // Set next tier refs required
        const nextNextTierResult = await pool.query(
          `SELECT * FROM tiers 
           WHERE refs_required > $1 
           ORDER BY refs_required ASC 
           LIMIT 1`,
          [user.referrals]
        );
        
        const nextNextRefs = nextNextTierResult.rows[0]?.refs_required || 0;
        const nextTierRefs = nextNextRefs > 0 ? nextNextRefs - user.referrals : 0;
        
        await pool.query(
          `UPDATE users 
           SET next_tier_refs = $1
           WHERE id = $2`,
          [nextTierRefs, userId]
        );
        
        // Notify admin of upgrade
        const message = `🎉 Tier Upgrade!\n\n👤 User: ${user.first_name} ${user.last_name || ''} (@${user.username || 'N/A'})\n🆔 ID: ${user.telegram_id}\n📈 New Tier: ${nextTier.name}\n⭐ Multiplier: ${nextTier.multiplier}x`;
        
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          chat_id: adminChatId,
          text: message,
          parse_mode: 'Markdown'
        });
      }
    }
  } catch (err) {
    console.error('Error in tier upgrade:', err);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});