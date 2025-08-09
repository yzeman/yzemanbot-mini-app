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

// Telegram bot setup
const botToken = process.env.BOT_TOKEN;
const adminChatId = process.env.ADMIN_CHAT_ID;

// Initialize database function
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
        referral_code VARCHAR(20) UNIQUE,
        used_referral_code BOOLEAN DEFAULT FALSE,
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

    // Create social tasks table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        platform VARCHAR(50) NOT NULL,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform)
      );
    `);

    // Create tiers table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tiers (
        name VARCHAR(50) PRIMARY KEY,
        refs_required INTEGER NOT NULL,
        multiplier FLOAT NOT NULL,
        ad_reward INTEGER NOT NULL,
        referral_reward INTEGER NOT NULL
      );
    `);

    // Create bonus codes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bonus_codes (
        code VARCHAR(20) PRIMARY KEY,
        points INTEGER DEFAULT 0,
        dollars FLOAT DEFAULT 0,
        daily BOOLEAN DEFAULT TRUE
      );
    `);

    // Create user bonus redemptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_bonus_redemptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        bonus_code VARCHAR(20),
        date DATE NOT NULL,
        UNIQUE(user_id, bonus_code, date)
      );
    `);

    // Insert/update tiers
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

    // Insert bonus codes
    const bonusCodes = [
      { code: 'BASER', points: 2000, dollars: 0, daily: true },
      { code: 'BOTYZEMAN', points: 100000, dollars: 0, daily: true },
      { code: 'EARNSBOTT', points: 0, dollars: 15, daily: true },
      { code: 'BONUSBOTTER', points: 0, dollars: 100, daily: true },
      { code: 'GAINMASTER', points: 50000, dollars: 100, daily: true }
    ];

    for (const code of bonusCodes) {
      await pool.query(`
        INSERT INTO bonus_codes (code, points, dollars, daily)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (code) DO UPDATE SET
          points = EXCLUDED.points,
          dollars = EXCLUDED.dollars,
          daily = EXCLUDED.daily
      `, [code.code, code.points, code.dollars, code.daily]);
    }

    console.log('Database tables initialized successfully');
  } catch (err) {
    console.error('Error initializing database:', err);
  }
};

// Initialize database on startup
initializeDatabase();

// Middleware to verify Telegram initData
const verifyTelegramData = (req, res, next) => {
  const initData = req.headers['x-telegram-initdata'];
  
  if (!initData) {
    return res.status(401).json({ error: 'Telegram initData missing' });
  }
  
  // In production, add proper hash verification here
  next();
};

// Helper function to generate referral code
const generateReferralCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return 'YZEMAN-' + code;
};

// Get or create user
app.post('/api/user', verifyTelegramData, async (req, res) => {
  try {
    const { user } = req.body;
    
    // Check if user exists
    const existingUser = await pool.query(
      `SELECT * FROM users WHERE telegram_id = $1`,
      [user.id]
    );
    
    if (existingUser.rows.length > 0) {
      return res.json(existingUser.rows[0]);
    }
    
    // Create new user with referral code
    const referralCode = generateReferralCode();
    const result = await pool.query(
      `INSERT INTO users 
        (telegram_id, username, first_name, last_name, referral_code) 
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user.id, user.username, user.first_name, user.last_name, referralCode]
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
           used_referral_code = $8, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $9 
       RETURNING *`,
      [
        userData.points,
        userData.referrals,
        userData.tier,
        userData.multiplier,
        userData.next_tier_refs,
        userData.social_dollars,
        userData.wallet_address,
        userData.used_referral_code,
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
    
    // Check if already completed
    const existing = await pool.query(
      `SELECT * FROM social_tasks 
       WHERE user_id = $1 AND platform = $2`,
      [userId, platform]
    );
    
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Task already completed' });
    }
    
    // Record social task
    await pool.query(
      `INSERT INTO social_tasks (user_id, platform) 
       VALUES ($1, $2)`,
      [userId, platform]
    );
    
    // Update user social dollars
    await pool.query(
      `UPDATE users SET social_dollars = social_dollars + 50 
       WHERE id = $1`,
      [userId]
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
       SET points = points + $1 
       WHERE id = $2`,
      [referralReward, referredId]
    );
    
    // Check for tier upgrade
    await checkTierUpgrade(referrerId);
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Apply referral code
app.post('/api/redeem-referral', verifyTelegramData, async (req, res) => {
  try {
    const { userId, referralCode } = req.body;
    
    // Check if user already used a referral code
    const userResult = await pool.query(
      `SELECT used_referral_code FROM users WHERE id = $1`,
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (userResult.rows[0].used_referral_code) {
      return res.status(400).json({ error: 'You can only use one referral code' });
    }
    
    // Get referrer by referral code
    const referrerResult = await pool.query(
      `SELECT id, tier FROM users WHERE referral_code = $1`,
      [referralCode]
    );
    
    if (referrerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid referral code' });
    }
    
    const referrer = referrerResult.rows[0];
    
    // Get referrer's tier reward
    const tierResult = await pool.query(
      `SELECT referral_reward FROM tiers WHERE name = $1`,
      [referrer.tier]
    );
    
    if (tierResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid tier configuration' });
    }
    
    const reward = tierResult.rows[0].referral_reward;
    
    // Update both users in transaction
    await pool.query('BEGIN');
    
    // Update redeemer
    await pool.query(
      `UPDATE users 
       SET points = points + $1, 
           used_referral_code = TRUE
       WHERE id = $2`,
      [reward, userId]
    );
    
    // Update referrer
    await pool.query(
      `UPDATE users 
       SET points = points + $1,
           referrals = referrals + 1
       WHERE id = $2`,
      [reward, referrer.id]
    );
    
    await pool.query('COMMIT');
    
    // Check for tier upgrade for referrer
    await checkTierUpgrade(referrer.id);
    
    res.json({ success: true, reward });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Redeem bonus code
app.post('/api/redeem-bonus', verifyTelegramData, async (req, res) => {
  try {
    const { userId, bonusCode } = req.body;
    const today = new Date().toISOString().split('T')[0];
    
    // Check if bonus code exists
    const bonusResult = await pool.query(
      `SELECT * FROM bonus_codes WHERE code = $1`,
      [bonusCode]
    );
    
    if (bonusResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid bonus code' });
    }
    
    const bonus = bonusResult.rows[0];
    
    // Check if code has been used today
    const usageResult = await pool.query(
      `SELECT * FROM user_bonus_redemptions 
       WHERE user_id = $1 AND bonus_code = $2 AND date = $3`,
      [userId, bonusCode, today]
    );
    
    if (usageResult.rows.length > 0) {
      return res.status(400).json({ error: 'Code already used today' });
    }
    
    // Apply bonus in transaction
    await pool.query('BEGIN');
    
    if (bonus.points > 0) {
      await pool.query(
        `UPDATE users SET points = points + $1 WHERE id = $2`,
        [bonus.points, userId]
      );
    }
    
    if (bonus.dollars > 0) {
      await pool.query(
        `UPDATE users SET social_dollars = social_dollars + $1 WHERE id = $2`,
        [bonus.dollars, userId]
      );
    }
    
    // Record redemption
    await pool.query(
      `INSERT INTO user_bonus_redemptions (user_id, bonus_code, date)
       VALUES ($1, $2, $3)`,
      [userId, bonusCode, today]
    );
    
    await pool.query('COMMIT');
    
    res.json({ 
      success: true,
      points: bonus.points,
      dollars: bonus.dollars
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Tier upgrade helper function
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