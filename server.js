// ============================================================
// YZEMANBOT - BACKEND SERVER (COMPLETE)
// COIN ECONOMY: 1 COIN = 1 UNIT (NO POINTS)
// WITHDRAWAL: 100,000 COINS minimum
// WITH 2% LIFETIME COMMISSION
// ============================================================

const { Pool } = require('pg');
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { Telegraf } = require('telegraf');
const app = express();

const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

const MIN_WITHDRAWAL_COINS = 100000;
const INVITEE_BONUS_COINS = 2000;
const COMMISSION_RATE = 0.02;

const REFERRAL_REWARDS_COINS = {
    'Fresher': 5,
    'Brute': 10,
    'Silver': 15,
    'Gold': 20,
    'Platinum': 25
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => console.error('Unexpected error on idle client', err));

app.use(bodyParser.json({ limit: '10kb' }));
app.use(express.static('public'));

// ============================================
// DATABASE INITIALIZATION (WITH MIGRATION)
// ============================================

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
        points BIGINT DEFAULT 0,
        tier TEXT NOT NULL DEFAULT 'Fresher',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS coins DECIMAL(20,3) DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referrals INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_date DATE`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_coins_earned DECIMAL(20,3) DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id INTEGER`);

    const pointsColExists = await client.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='points')`);
    if (pointsColExists.rows[0].exists) {
      await client.query(`UPDATE users SET coins = points / 1000000.0 WHERE coins = 0 AND points > 0`);
      console.log('✅ Migrated points to coins');
    }

    const totalPointsExists = await client.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='total_points_earned')`);
    if (totalPointsExists.rows[0].exists) {
      await client.query(`UPDATE users SET total_coins_earned = total_points_earned / 1000000.0 WHERE total_coins_earned = 0 AND total_points_earned > 0`);
      console.log('✅ Migrated total_points_earned to total_coins_earned');
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS tiers (
        name TEXT PRIMARY KEY,
        refs_required INTEGER NOT NULL,
        multiplier REAL NOT NULL,
        referral_reward DECIMAL(10,3) NOT NULL
      )
    `);

    await client.query(`
      INSERT INTO tiers (name, refs_required, multiplier, referral_reward) 
      VALUES 
        ('Fresher', 0, 1.0, 5),
        ('Brute', 150, 1.5, 10),
        ('Silver', 350, 2.0, 15),
        ('Gold', 700, 2.5, 20),
        ('Platinum', 1500, 3.0, 25)
      ON CONFLICT (name) DO UPDATE SET
        refs_required = EXCLUDED.refs_required,
        multiplier = EXCLUDED.multiplier,
        referral_reward = EXCLUDED.referral_reward
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id INTEGER NOT NULL REFERENCES users(id),
        referred_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (referred_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ad_rewards (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        reward_amount DECIMAL(10,3) NOT NULL,
        ad_type TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount DECIMAL(10,3) NOT NULL,
        wallet_address TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_rewards (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        reward_date DATE NOT NULL,
        streak_count INTEGER DEFAULT 1,
        reward_coins DECIMAL(10,3) NOT NULL,
        claimed BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, reward_date)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS wheel_spins (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        spin_date DATE NOT NULL,
        reward_coins DECIMAL(10,3) NOT NULL,
        spin_type TEXT DEFAULT 'normal',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, spin_date)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS achievements (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        badge_icon TEXT,
        required_value INTEGER,
        points_reward BIGINT DEFAULT 0
      )
    `);

    await client.query(`ALTER TABLE achievements ADD COLUMN IF NOT EXISTS coins_reward DECIMAL(10,3) DEFAULT 0`);
    await client.query(`UPDATE achievements SET coins_reward = points_reward / 1000000.0 WHERE coins_reward = 0 AND points_reward > 0`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_achievements (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        achievement_id INTEGER NOT NULL REFERENCES achievements(id),
        achieved_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, achievement_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        code TEXT UNIQUE NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        joined_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(team_id, user_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS weekly_tournaments (
        id SERIAL PRIMARY KEY,
        week_start DATE NOT NULL,
        week_end DATE NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tournament_participants (
        id SERIAL PRIMARY KEY,
        tournament_id INTEGER NOT NULL REFERENCES weekly_tournaments(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        coins_earned DECIMAL(10,3) DEFAULT 0,
        referral_count INTEGER DEFAULT 0,
        rank INTEGER,
        prize_awarded BOOLEAN DEFAULT FALSE,
        UNIQUE(tournament_id, user_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ad_statistics (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        ad_streak INTEGER DEFAULT 0,
        total_ads INTEGER DEFAULT 0,
        ads_today INTEGER DEFAULT 0,
        ads_week INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bonus_codes (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        coins DECIMAL(10,3) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_bonus_redemptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        bonus_code TEXT NOT NULL,
        redeemed_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, bonus_code)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS social_tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        task_name TEXT NOT NULL,
        completed_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, task_name)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS referral_commissions (
        id SERIAL PRIMARY KEY,
        referrer_id INTEGER NOT NULL REFERENCES users(id),
        referred_id INTEGER NOT NULL REFERENCES users(id),
        coins_earned DECIMAL(10,3) NOT NULL,
        commission_coins DECIMAL(10,3) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      INSERT INTO achievements (name, description, badge_icon, required_value, coins_reward) VALUES
        ('Loyal User', '30 day login streak', '🔥', 30, 100),
        ('Referral Master', 'Get 100 referrals', '👑', 100, 200),
        ('Points Millionaire', 'Earn 1,000,000 COINS', '💰', 1000000, 2000),
        ('Social Butterfly', 'Complete all social tasks', '🦋', 5, 50),
        ('Tournament Winner', 'Win a weekly tournament', '🏆', 1, 100),
        ('Team Player', 'Join a team', '🤝', 1, 20),
        ('Platinum Elite', 'Reach Platinum tier', '💎', 1500, 500),
        ('Wheel Champion', 'Win 20 COINS on wheel', '🎡', 20, 50),
        ('Daily Streak 7', '7 day login streak', '📅', 7, 10),
        ('Super Referrer', 'Get 500 referrals', '⭐', 500, 1000),
        ('Ad Master', 'Watch 1000 ads', '📺', 1000, 10000)
      ON CONFLICT (name) DO UPDATE SET
        description = EXCLUDED.description,
        coins_reward = EXCLUDED.coins_reward
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

// ============================================
// HELPER: Award 2% Commission to Referrer
// ============================================

async function awardReferralCommission(client, referredUserId, coinsEarned) {
    try {
        const referral = await client.query(
            'SELECT referrer_id FROM referrals WHERE referred_id = $1',
            [referredUserId]
        );
        if (referral.rows.length === 0) return;
        
        const referrerId = referral.rows[0].referrer_id;
        const commission = coinsEarned * COMMISSION_RATE;
        if (commission <= 0) return;
        
        await client.query(
            'UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
            [commission, referrerId]
        );
        
        await client.query(
            'INSERT INTO referral_commissions (referrer_id, referred_id, coins_earned, commission_coins) VALUES ($1, $2, $3, $4)',
            [referrerId, referredUserId, coinsEarned, commission]
        );
        
        console.log(`💰 Commission: User ${referredUserId} earned ${coinsEarned} COINS → referrer ${referrerId} gets ${commission} COINS`);
    } catch (err) {
        console.error('Commission error:', err);
    }
}

// ============================================
// HELPER: Award Achievement (UPDATED FOR COINS)
// ============================================

async function awardAchievement(userId, achievementName, clientParam = null) {
    const client = clientParam || await pool.connect();
    try {
        if (!clientParam) await client.query('BEGIN');
        
        const achievement = await client.query(
            'SELECT id, coins_reward FROM achievements WHERE name = $1',
            [achievementName]
        );
        
        if (achievement.rows.length === 0) {
            if (!clientParam) await client.query('COMMIT');
            return false;
        }
        
        const achievementId = achievement.rows[0].id;
        const coinsReward = achievement.rows[0].coins_reward;
        
        const existing = await client.query(
            'SELECT * FROM user_achievements WHERE user_id = $1 AND achievement_id = $2',
            [userId, achievementId]
        );
        
        if (existing.rows.length > 0) {
            if (!clientParam) await client.query('COMMIT');
            return false;
        }
        
        await client.query(
            'INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2)',
            [userId, achievementId]
        );
        
        if (coinsReward > 0) {
            await client.query(
                'UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
                [coinsReward, userId]
            );
            console.log(`🎉 Achievement "${achievementName}" awarded to user ${userId} +${coinsReward} COINS`);
        }
        
        if (!clientParam) await client.query('COMMIT');
        return true;
    } catch (err) {
        if (!clientParam) await client.query('ROLLBACK');
        console.error(`Error awarding achievement ${achievementName}:`, err);
        return false;
    } finally {
        if (!clientParam) client.release();
    }
}

// ============================================
// TELEGRAM VERIFICATION
// ============================================

async function verifyTelegramData(req, res, next) {
  if (!req.body?.initData) {
    return res.status(400).json({ error: 'Missing Telegram data' });
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
// USER API ENDPOINT (UPDATED FOR COINS)
// ============================================

app.post('/api/user', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id, first_name, last_name, username, photo_url } = req.telegramUser;
    let referralCode = req.body.referralCode;
    const walletAddress = req.body.walletAddress;
    
    console.log(`📝 /api/user called - Telegram ID: ${id}, Referral Code: ${referralCode || 'none'}`);
    
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
      console.log(`✅ Existing user ${id} updated`);
    } else {
      const userReferralCode = `ref-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      
      const insertQuery = `
        INSERT INTO users (telegram_id, first_name, last_name, username, photo_url, referral_code, wallet_address)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      const result = await client.query(insertQuery, [
        id, first_name, last_name, username, photo_url, userReferralCode, walletAddress
      ]);
      user = result.rows[0];
      console.log(`🆕 New user ${id} created with referral code: ${userReferralCode}`);
      
      if (referralCode && referralCode !== userReferralCode) {
        console.log(`🔗 Processing referral: New user ${id} used code ${referralCode}`);
        
        let cleanReferralCode = referralCode;
        if (cleanReferralCode.startsWith('ref-')) cleanReferralCode = cleanReferralCode.substring(4);
        if (cleanReferralCode.startsWith('YZEMAN-')) cleanReferralCode = cleanReferralCode.substring(7);
        
        let referrerResult = await client.query(
          'SELECT id, tier, telegram_id FROM users WHERE referral_code = $1',
          [cleanReferralCode]
        );
        if (referrerResult.rows.length === 0) {
          referrerResult = await client.query(
            'SELECT id, tier, telegram_id FROM users WHERE referral_code = $1',
            [`ref-${cleanReferralCode}`]
          );
        }
        
        if (referrerResult.rows.length > 0 && referrerResult.rows[0].id !== user.id) {
          const referrerId = referrerResult.rows[0].id;
          const referrerTier = referrerResult.rows[0].tier;
          const referrerTelegramId = referrerResult.rows[0].telegram_id;
          
          const referrerReward = REFERRAL_REWARDS_COINS[referrerTier] || 5;
          const refereeBonus = INVITEE_BONUS_COINS;
          
          const existingReferral = await client.query(
            'SELECT * FROM referrals WHERE referrer_id = $1 AND referred_id = $2',
            [referrerId, user.id]
          );
          
          if (existingReferral.rows.length === 0) {
            await client.query(
              'INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)',
              [referrerId, user.id]
            );
            
            await client.query(
              'UPDATE users SET coins = coins + $1, referrals = referrals + 1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
              [referrerReward, referrerId]
            );
            
            await client.query(
              'UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
              [refereeBonus, user.id]
            );
            
            const newReferralCount = await client.query(
              'SELECT COUNT(*) FROM referrals WHERE referrer_id = $1',
              [referrerId]
            );
            const count = parseInt(newReferralCount.rows[0].count);
            
            const newTier = await client.query(
              `SELECT name FROM tiers WHERE refs_required <= $1 ORDER BY refs_required DESC LIMIT 1`,
              [count]
            );
            
            if (newTier.rows.length > 0 && newTier.rows[0].name !== referrerTier) {
              await client.query('UPDATE users SET tier = $1 WHERE id = $2', [newTier.rows[0].name, referrerId]);
            }
            
            user.coins = parseFloat(user.coins || 0) + refereeBonus;
            
            const BOT_TOKEN = process.env.BOT_TOKEN;
            if (BOT_TOKEN && referrerTelegramId) {
              const notificationMessage = `🎉 *NEW REFERRAL!*\n\n👤 *${user.first_name || 'Someone'}* joined!\n💰 You earned: +${referrerReward} COINS\n👥 Total: ${count}\n✨ Friend got: +${refereeBonus} COINS\n💎 *You'll earn 2% of their future earnings!*`;
              try {
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ chat_id: referrerTelegramId, text: notificationMessage, parse_mode: 'Markdown' })
                });
              } catch (e) {}
            }
          }
        }
      }
    }
    
    const { rows: [stats] } = await client.query(`
      SELECT COUNT(r.*) AS referrals, t.name AS tier, t.multiplier, t.referral_reward
      FROM users u
      LEFT JOIN referrals r ON r.referrer_id = u.id
      LEFT JOIN tiers t ON u.tier = t.name
      WHERE u.id = $1
      GROUP BY u.id, t.name, t.multiplier, t.referral_reward`,
      [user.id]
    );
    
    await client.query('COMMIT');
    console.log(`📤 Response sent for user ${id}: coins=${user.coins}, referrals=${stats?.referrals || 0}`);
    res.json({ ...user, ...stats });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ User Error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================
// AD REWARD ENDPOINT (WITH COMMISSION)
// ============================================

app.post('/api/ad-reward', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { rewardAmount, adType } = req.body;
    const telegramId = req.telegramUser.id;

    const userResult = await client.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const userId = userResult.rows[0].id;
    
    await client.query('BEGIN');
    
    await client.query(
      'INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)',
      [userId, rewardAmount, adType]
    );
    
    await client.query(
      'UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
      [rewardAmount, userId]
    );
    
    await awardReferralCommission(client, userId, rewardAmount);
    
    const userCoins = await client.query('SELECT coins FROM users WHERE id = $1', [userId]);
    if (parseFloat(userCoins.rows[0].coins) >= 1000000) {
      await awardAchievement(userId, 'Points Millionaire', client);
    }
    
    await client.query('COMMIT');
    res.json({ success: true, coins: userCoins.rows[0].coins });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Ad Reward Error:', err);
    res.status(500).json({ error: 'Failed to process ad reward' });
  } finally {
    client.release();
  }
});

// ============================================
// DAILY REWARD ENDPOINT (WITH COMMISSION)
// ============================================

app.post('/api/daily-reward', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const telegramId = req.telegramUser.id;
    const today = new Date().toISOString().split('T')[0];
    
    const userResult = await client.query('SELECT id, last_login_date FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const userId = userResult.rows[0].id;
    const lastLogin = userResult.rows[0].last_login_date;
    
    const existing = await client.query('SELECT * FROM daily_rewards WHERE user_id = $1 AND reward_date = $2', [userId, today]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Already claimed today' });
    
    let streak = 1;
    if (lastLogin) {
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      if (lastLogin.toISOString().split('T')[0] === yesterday.toISOString().split('T')[0]) {
        const lastStreak = await client.query('SELECT streak_count FROM daily_rewards WHERE user_id = $1 ORDER BY reward_date DESC LIMIT 1', [userId]);
        streak = (lastStreak.rows[0]?.streak_count || 0) + 1;
      }
    }
    
    const baseReward = 0.2;
    const streakBonus = streak * 0.1;
    let rewardCoins = baseReward + streakBonus;
    if (streak % 7 === 0) rewardCoins += 1;
    
    const userTier = await client.query('SELECT tier FROM users WHERE id = $1', [userId]);
    const multipliers = { Fresher: 1.0, Brute: 1.5, Silver: 2.0, Gold: 2.5, Platinum: 3.0 };
    const finalReward = rewardCoins * (multipliers[userTier.rows[0]?.tier] || 1.0);
    
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO daily_rewards (user_id, reward_date, streak_count, reward_coins) VALUES ($1, $2, $3, $4)',
      [userId, today, streak, finalReward]
    );
    await client.query(
      'UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1, last_login_date = $2 WHERE id = $3',
      [finalReward, today, userId]
    );
    await awardReferralCommission(client, userId, finalReward);
    if (streak >= 7) await awardAchievement(userId, 'Daily Streak 7', client);
    if (streak >= 30) await awardAchievement(userId, 'Loyal User', client);
    await client.query('COMMIT');
    
    res.json({ success: true, reward: finalReward, streak });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Daily reward error:', err);
    res.status(500).json({ error: 'Failed to process daily reward' });
  } finally {
    client.release();
  }
});

app.post('/api/daily-stats', verifyTelegramData, async (req, res) => {
  try {
    const telegramId = req.telegramUser.id;
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.json({ claimed_today: false, last_7_days: [], max_streak: 0, current_streak: 0 });
    const userId = userResult.rows[0].id;
    const today = new Date().toISOString().split('T')[0];
    
    const claimedToday = await pool.query('SELECT * FROM daily_rewards WHERE user_id = $1 AND reward_date = $2', [userId, today]);
    const last7Days = await pool.query(`SELECT reward_date, streak_count, reward_coins FROM daily_rewards WHERE user_id = $1 ORDER BY reward_date DESC LIMIT 7`, [userId]);
    const maxStreak = await pool.query(`SELECT COALESCE(MAX(streak_count), 0) as max_streak FROM daily_rewards WHERE user_id = $1`, [userId]);
    
    let currentStreak = 0;
    if (last7Days.rows.length > 0) {
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      if (last7Days.rows[0].reward_date === today || last7Days.rows[0].reward_date === yesterday.toISOString().split('T')[0]) {
        currentStreak = last7Days.rows[0].streak_count;
      }
    }
    
    res.json({
      claimed_today: claimedToday.rows.length > 0,
      last_7_days: last7Days.rows,
      max_streak: maxStreak.rows[0].max_streak,
      current_streak: currentStreak
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// WHEEL SPIN ENDPOINT (WITH COMMISSION)
// ============================================

app.post('/api/wheel-spin', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const telegramId = req.telegramUser.id;
    const today = new Date().toISOString().split('T')[0];
    
    const userResult = await client.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userId = userResult.rows[0].id;
    
    const lastSpin = await client.query("SELECT spin_date FROM wheel_spins WHERE user_id = $1 ORDER BY spin_date DESC LIMIT 1", [userId]);
    if (lastSpin.rows.length > 0) {
      const daysDiff = Math.floor((new Date() - new Date(lastSpin.rows[0].spin_date)) / 86400000);
      if (daysDiff < 3) return res.status(400).json({ error: `Next spin in ${3 - daysDiff} day(s)`, daysLeft: 3 - daysDiff });
    }
    
    const prizes = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
    const rewardCoins = prizes[Math.floor(Math.random() * prizes.length)];
    
    const userTier = await client.query('SELECT tier FROM users WHERE id = $1', [userId]);
    const multipliers = { Fresher: 1.0, Brute: 1.5, Silver: 2.0, Gold: 2.5, Platinum: 3.0 };
    const finalReward = rewardCoins * (multipliers[userTier.rows[0]?.tier] || 1.0);
    
    await client.query('BEGIN');
    await client.query('INSERT INTO wheel_spins (user_id, spin_date, reward_coins) VALUES ($1, $2, $3)', [userId, today, finalReward]);
    await client.query('UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2', [finalReward, userId]);
    await awardReferralCommission(client, userId, finalReward);
    if (rewardCoins >= 20) await awardAchievement(userId, 'Wheel Champion', client);
    await client.query('COMMIT');
    
    res.json({ success: true, reward: finalReward });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Wheel spin error:', err);
    res.status(500).json({ error: 'Failed to process wheel spin' });
  } finally {
    client.release();
  }
});

app.post('/api/wheel-status', verifyTelegramData, async (req, res) => {
  try {
    const telegramId = req.telegramUser.id;
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.json({ can_spin: true, days_left: 0, last_reward: 0 });
    const userId = userResult.rows[0].id;
    
    const lastSpin = await pool.query("SELECT spin_date, reward_coins FROM wheel_spins WHERE user_id = $1 ORDER BY spin_date DESC LIMIT 1", [userId]);
    let canSpin = true, daysLeft = 0, lastReward = 0;
    if (lastSpin.rows.length > 0) {
      const daysDiff = Math.floor((new Date() - new Date(lastSpin.rows[0].spin_date)) / 86400000);
      lastReward = lastSpin.rows[0].reward_coins;
      if (daysDiff < 3) { canSpin = false; daysLeft = 3 - daysDiff; }
    }
    res.json({ can_spin: canSpin, days_left: daysLeft, last_reward: lastReward });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// TASK COMPLETION ENDPOINT (WITH COMMISSION)
// ============================================

app.post('/api/complete-task', verifyTelegramData, async (req, res) => {
  const { taskName, coins } = req.body;
  const telegramId = req.telegramUser.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) throw new Error('User not found');
    const userId = userResult.rows[0].id;
    
    const existing = await client.query('SELECT * FROM social_tasks WHERE user_id = $1 AND task_name = $2', [userId, taskName]);
    if (existing.rows.length > 0) throw new Error('Task already completed');
    
    await client.query('UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2', [coins, userId]);
    await client.query('INSERT INTO social_tasks (user_id, task_name) VALUES ($1, $2)', [userId, taskName]);
    await awardReferralCommission(client, userId, coins);
    
    const socialTasks = ['youtube1', 'youtube2', 'youtube3', 'facebook', 'instagram', 'telegram'];
    const completed = await client.query('SELECT task_name FROM social_tasks WHERE user_id = $1 AND task_name = ANY($2::text[])', [userId, socialTasks]);
    if (completed.rows.length === socialTasks.length) {
      await awardAchievement(userId, 'Social Butterfly', client);
    }
    
    await client.query('COMMIT');
    res.json({ success: true, message: `+${coins} COINS earned!` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/check-task', verifyTelegramData, async (req, res) => {
  const { taskName } = req.body;
  const telegramId = req.telegramUser.id;
  try {
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.json({ completed: false });
    const taskResult = await pool.query('SELECT * FROM social_tasks WHERE user_id = $1 AND task_name = $2', [userResult.rows[0].id, taskName]);
    res.json({ completed: taskResult.rows.length > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// LEADERBOARD: Monthly Top Earners (Resets 1st of Month)
// ============================================
app.post('/api/leaderboard/top-earners', verifyTelegramData, async (req, res) => {
  try {
    // Get first day of current month
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    
    const result = await pool.query(`
      SELECT u.id, u.username, u.first_name, u.photo_url,
             COALESCE(SUM(ar.reward_amount), 0) as monthly_coins,
             u.tier, u.referrals, u.telegram_id
      FROM users u
      LEFT JOIN ad_rewards ar ON u.id = ar.user_id 
        AND ar.created_at >= $1
      GROUP BY u.id
      ORDER BY monthly_coins DESC
      LIMIT 50
    `, [firstOfMonth]);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Top earners error:', err);
    res.status(500).json({ error: 'Failed to fetch top earners' });
  }
});

// ============================================
// LEADERBOARD: Weekly Top Referrals (RESETS EVERY SUNDAY)
// ============================================
app.post('/api/leaderboard/weekly-referrers', verifyTelegramData, async (req, res) => {
  try {
    // Get the most recent Sunday at midnight
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday
    const daysSinceSunday = dayOfWeek; // If today is Sunday, daysSinceSunday = 0
    
    const lastSunday = new Date(now);
    lastSunday.setDate(now.getDate() - daysSinceSunday);
    lastSunday.setHours(0, 0, 0, 0);
    const lastSundayStr = lastSunday.toISOString();
    
    const result = await pool.query(`
      SELECT 
        u.id, u.username, u.first_name, u.photo_url,
        COUNT(r.id) as referral_count, u.tier, u.coins, u.referrals
      FROM users u
      LEFT JOIN referrals r ON u.id = r.referrer_id 
        AND r.created_at >= $1
      GROUP BY u.id
      ORDER BY referral_count DESC
      LIMIT 50
    `, [lastSundayStr]);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Weekly referrers error:', err);
    res.status(500).json({ error: 'Failed to fetch referrers' });
  }
});

app.post('/api/leaderboard/weekly-earnings', verifyTelegramData, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.username, u.first_name, u.photo_url,
        COALESCE(SUM(ar.reward_amount), 0) as weekly_coins, u.tier, u.coins
      FROM users u
      LEFT JOIN ad_rewards ar ON u.id = ar.user_id 
        AND ar.created_at > NOW() - INTERVAL '7 days'
      GROUP BY u.id
      ORDER BY weekly_coins DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Weekly earnings error:', err);
    res.status(500).json({ error: 'Failed to fetch weekly earnings' });
  }
});

// ============================================
// ACHIEVEMENTS API
// ============================================

app.post('/api/achievements', verifyTelegramData, async (req, res) => {
  try {
    const telegramId = req.telegramUser.id;
    const userResult = await pool.query('SELECT id, coins, referrals, tier, total_coins_earned FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userId = userResult.rows[0].id;
    const user = userResult.rows[0];
    
    const achievements = await pool.query(`
      SELECT a.*, CASE WHEN ua.id IS NOT NULL THEN true ELSE false END as achieved, ua.achieved_at
      FROM achievements a
      LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = $1
      ORDER BY a.id
    `, [userId]);
    
    const totalLoginDays = await pool.query('SELECT COUNT(*) as days FROM daily_rewards WHERE user_id = $1', [userId]);
    const maxStreak = await pool.query('SELECT MAX(streak_count) as max_streak FROM daily_rewards WHERE user_id = $1', [userId]);
    const achievementsCount = await pool.query('SELECT COUNT(*) as count FROM user_achievements WHERE user_id = $1', [userId]);
    
    res.json({
      achievements: achievements.rows,
      userStats: {
        coins: user.coins,
        referrals: user.referrals,
        tier: user.tier,
        total_coins_earned: user.total_coins_earned,
        total_login_days: parseInt(totalLoginDays.rows[0].days),
        max_streak: maxStreak.rows[0].max_streak || 0,
        achievements_count: parseInt(achievementsCount.rows[0].count)
      }
    });
  } catch (err) {
    console.error('Achievements error:', err);
    res.status(500).json({ error: 'Failed to fetch achievements' });
  }
});

// ============================================
// TOURNAMENT: Join Current Week's Tournament
// ============================================
app.post('/api/tournament/join', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const telegramId = req.telegramUser.id;
    
    const userResult = await client.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const userId = userResult.rows[0].id;
    const now = new Date();
    const dayOfWeek = now.getDay();
    
    // Find the most recent Monday
    let daysSinceMonday = dayOfWeek - 1;
    if (daysSinceMonday < 0) daysSinceMonday += 7;
    
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - daysSinceMonday);
    weekStart.setHours(0, 0, 0, 0);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    const weekEndStr = weekEnd.toISOString().split('T')[0];
    
    // Get or create the ACTIVE tournament for THIS week
    let tournament = await client.query(
      'SELECT * FROM weekly_tournaments WHERE week_start = $1 AND is_active = true',
      [weekStartStr]
    );
    
    if (tournament.rows.length === 0) {
      // Check if there's already an inactive tournament for this week
      const existingInactive = await client.query(
        'SELECT * FROM weekly_tournaments WHERE week_start = $1',
        [weekStartStr]
      );
      
      if (existingInactive.rows.length > 0) {
        // Reactivate it
        await client.query(
          'UPDATE weekly_tournaments SET is_active = true WHERE id = $1',
          [existingInactive.rows[0].id]
        );
        tournament = { rows: [existingInactive.rows[0]] };
      } else {
        // Create new tournament
        const result = await client.query(
          `INSERT INTO weekly_tournaments (week_start, week_end, is_active) VALUES ($1, $2, true) RETURNING *`,
          [weekStartStr, weekEndStr]
        );
        tournament = result;
      }
    }
    
    const tournamentId = tournament.rows[0].id;
    
    // Check if user already joined THIS WEEK'S tournament
    const existing = await client.query(
      'SELECT * FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2',
      [tournamentId, userId]
    );
    
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'You already joined this week\'s tournament' });
    }
    
    // Join the tournament
    await client.query(
      `INSERT INTO tournament_participants (tournament_id, user_id) VALUES ($1, $2)`,
      [tournamentId, userId]
    );
    
    await client.query('COMMIT');
    res.json({ success: true, message: 'Joined tournament!' });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Tournament join error:', err);
    res.status(500).json({ error: 'Failed to join tournament' });
  } finally {
    client.release();
  }
});

// ============================================
// TOURNAMENT: Current Week Standings
// ============================================
app.post('/api/tournament/standings', verifyTelegramData, async (req, res) => {
  try {
    const telegramId = req.telegramUser.id;
    
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const userId = userResult.rows[0].id;
    const now = new Date();
    const dayOfWeek = now.getDay();
    
    // Find the most recent Monday
    let daysSinceMonday = dayOfWeek - 1;
    if (daysSinceMonday < 0) daysSinceMonday += 7;
    
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - daysSinceMonday);
    weekStart.setHours(0, 0, 0, 0);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    
    // Get active tournament for this week
    const tournament = await pool.query(
      'SELECT id FROM weekly_tournaments WHERE week_start = $1 AND is_active = true',
      [weekStartStr]
    );
    
    if (tournament.rows.length === 0) {
      return res.json({ standings: [], my_rank: null, my_coins: 0, has_joined: false });
    }
    
    const tournamentId = tournament.rows[0].id;
    const userJoined = await pool.query(
      'SELECT * FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2',
      [tournamentId, userId]
    );
    const hasJoined = userJoined.rows.length > 0;
    
    const standings = await pool.query(`
      SELECT 
        u.id, u.username, u.first_name, u.photo_url,
        COALESCE(SUM(ar.reward_amount), 0) as weekly_coins, u.tier,
        ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(ar.reward_amount), 0) DESC) as rank
      FROM tournament_participants tp
      JOIN users u ON tp.user_id = u.id
      LEFT JOIN ad_rewards ar ON u.id = ar.user_id 
        AND ar.created_at >= $2
      WHERE tp.tournament_id = $1
      GROUP BY u.id
      ORDER BY weekly_coins DESC
    `, [tournamentId, weekStart.toISOString()]);
    
    let myRank = null, myCoins = 0;
    for (const row of standings.rows) {
      if (row.id === userId) { 
        myRank = row.rank; 
        myCoins = parseFloat(row.weekly_coins); 
        break; 
      }
    }
    
    res.json({ standings: standings.rows, my_rank: myRank, my_coins: myCoins, has_joined: hasJoined });
    
  } catch (err) {
    console.error('Tournament standings error:', err);
    res.status(500).json({ error: 'Failed to fetch standings' });
  }
});

// ============================================
// TEAM API ENDPOINTS
// ============================================

app.post('/api/team/create', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { teamName } = req.body;
    const telegramId = req.telegramUser.id;
    if (!teamName || teamName.trim().length < 3) return res.status(400).json({ error: 'Team name must be at least 3 characters' });
    const userResult = await client.query('SELECT id, team_id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userId = userResult.rows[0].id;
    if (userResult.rows[0].team_id) return res.status(400).json({ error: 'You are already in a team' });
    const existingTeam = await client.query('SELECT id FROM teams WHERE name = $1', [teamName.trim()]);
    if (existingTeam.rows.length > 0) return res.status(400).json({ error: 'Team name already exists' });
    
    await client.query('BEGIN');
    let teamCode, codeExists = true;
    while (codeExists) {
      teamCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      const existing = await client.query('SELECT id FROM teams WHERE code = $1', [teamCode]);
      codeExists = existing.rows.length > 0;
    }
    const teamResult = await client.query('INSERT INTO teams (name, code, created_by) VALUES ($1, $2, $3) RETURNING *', [teamName.trim(), teamCode, userId]);
    const team = teamResult.rows[0];
    await client.query('INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)', [team.id, userId]);
    await client.query('UPDATE users SET team_id = $1 WHERE id = $2', [team.id, userId]);
    await awardAchievement(userId, 'Team Player', client);
    await client.query('COMMIT');
    res.json({ success: true, team, teamCode: team.code });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create team error:', err);
    res.status(500).json({ error: 'Failed to create team' });
  } finally { client.release(); }
});

app.post('/api/team/join', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { teamCode } = req.body;
    const telegramId = req.telegramUser.id;
    if (!teamCode || teamCode.trim().length < 4) return res.status(400).json({ error: 'Invalid team code' });
    const userResult = await client.query('SELECT id, team_id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userId = userResult.rows[0].id;
    if (userResult.rows[0].team_id) return res.status(400).json({ error: 'You are already in a team' });
    const teamResult = await client.query('SELECT * FROM teams WHERE code = $1', [teamCode.trim().toUpperCase()]);
    if (teamResult.rows.length === 0) return res.status(404).json({ error: 'Team not found' });
    const team = teamResult.rows[0];
    await client.query('BEGIN');
    await client.query('INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)', [team.id, userId]);
    await client.query('UPDATE users SET team_id = $1 WHERE id = $2', [team.id, userId]);
    await awardAchievement(userId, 'Team Player', client);
    await client.query('COMMIT');
    res.json({ success: true, team });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Join team error:', err);
    res.status(500).json({ error: 'Failed to join team' });
  } finally { client.release(); }
});

app.post('/api/team/info', verifyTelegramData, async (req, res) => {
  try {
    let teamId = req.body.teamId;
    const telegramId = req.telegramUser?.id;
    if (!teamId && telegramId) {
      const userResult = await pool.query('SELECT team_id FROM users WHERE telegram_id = $1', [telegramId]);
      if (userResult.rows.length > 0 && userResult.rows[0].team_id) teamId = userResult.rows[0].team_id;
    }
    if (!teamId) return res.json({ has_team: false });
    const teamResult = await pool.query(`SELECT t.*, COALESCE(SUM(u.coins), 0) as total_coins, COUNT(tm.user_id) as member_count, COALESCE(SUM(u.referrals), 0) as total_referrals FROM teams t LEFT JOIN team_members tm ON t.id = tm.team_id LEFT JOIN users u ON tm.user_id = u.id WHERE t.id = $1 GROUP BY t.id`, [teamId]);
    if (teamResult.rows.length === 0) return res.json({ has_team: false });
    const team = teamResult.rows[0];
    const membersResult = await pool.query(`SELECT u.id, u.telegram_id, u.first_name, u.username, u.photo_url, u.coins, u.referrals, u.tier, (u.id = t.created_by) as is_leader, tm.joined_at FROM team_members tm JOIN users u ON tm.user_id = u.id JOIN teams t ON tm.team_id = t.id WHERE tm.team_id = $1 ORDER BY tm.joined_at ASC, u.coins DESC`, [teamId]);
    res.json({ has_team: true, team, members: membersResult.rows });
  } catch (err) {
    console.error('Team info error:', err);
    res.status(500).json({ error: 'Failed to fetch team info' });
  }
});

app.post('/api/team/leave', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const telegramId = req.telegramUser.id;
    const userResult = await client.query('SELECT id, team_id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userId = userResult.rows[0].id, teamId = userResult.rows[0].team_id;
    if (!teamId) return res.status(400).json({ error: 'You are not in a team' });
    const teamResult = await client.query('SELECT created_by FROM teams WHERE id = $1', [teamId]);
    const isLeader = teamResult.rows[0]?.created_by === userId;
    await client.query('BEGIN');
    await client.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
    await client.query('UPDATE users SET team_id = NULL WHERE id = $1', [userId]);
    const remainingMembers = await client.query('SELECT user_id FROM team_members WHERE team_id = $1 ORDER BY joined_at ASC', [teamId]);
    if (remainingMembers.rows.length === 0) {
      await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
    } else if (isLeader && remainingMembers.rows.length > 0) {
      await client.query('UPDATE teams SET created_by = $1 WHERE id = $2', [remainingMembers.rows[0].user_id, teamId]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Leave team error:', err);
    res.status(500).json({ error: 'Failed to leave team' });
  } finally { client.release(); }
});

app.get('/api/team/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`SELECT t.id, t.name, t.code, COALESCE(SUM(u.coins), 0) as total_coins, COUNT(tm.user_id) as member_count, COALESCE(MAX(CASE WHEN u.id = t.created_by THEN u.first_name END), 'Unknown') as leader_name FROM teams t LEFT JOIN team_members tm ON t.id = tm.team_id LEFT JOIN users u ON tm.user_id = u.id GROUP BY t.id ORDER BY total_coins DESC LIMIT 50`);
    res.json(result.rows);
  } catch (err) {
    console.error('Team leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

app.post('/api/team/monthly-competition', async (req, res) => {
  try {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const result = await pool.query(`SELECT t.id, t.name, COALESCE(SUM(u.coins), 0) as team_coins, COUNT(tm.user_id) as member_count, COALESCE(MAX(CASE WHEN u.id = t.created_by THEN u.first_name END), 'Unknown') as leader_name FROM teams t JOIN team_members tm ON t.id = tm.team_id JOIN users u ON tm.user_id = u.id GROUP BY t.id ORDER BY team_coins DESC LIMIT 10`);
    res.json({ month: currentMonth, standings: result.rows });
  } catch (err) {
    console.error('Monthly competition error:', err);
    res.status(500).json({ error: 'Failed to fetch monthly standings' });
  }
});

app.post('/api/team/check-name', verifyTelegramData, async (req, res) => {
  try {
    const { teamName } = req.body;
    if (!teamName) return res.json({ exists: false });
    const result = await pool.query('SELECT id FROM teams WHERE name = $1', [teamName.trim()]);
    res.json({ exists: result.rows.length > 0 });
  } catch (err) { res.json({ exists: false }); }
});

app.post('/api/team/check-code', verifyTelegramData, async (req, res) => {
  try {
    const { teamCode } = req.body;
    if (!teamCode) return res.json({ exists: false });
    const result = await pool.query('SELECT id, name FROM teams WHERE code = $1', [teamCode.trim().toUpperCase()]);
    res.json({ exists: result.rows.length > 0, teamName: result.rows[0]?.name || null });
  } catch (err) { res.json({ exists: false }); }
});

// ============================================
// BONUS CODES
// ============================================

app.post('/api/redeem-bonus', verifyTelegramData, async (req, res) => {
  const { code } = req.body;
  const telegramId = req.telegramUser.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) throw new Error('User not found');
    const userId = userResult.rows[0].id;
    const existing = await client.query('SELECT * FROM user_bonus_redemptions WHERE user_id = $1 AND bonus_code = $2', [userId, code.toUpperCase()]);
    if (existing.rows.length > 0) throw new Error('Code already redeemed');
    const bonus = await client.query('SELECT * FROM bonus_codes WHERE code = $1 AND is_active = true', [code.toUpperCase()]);
    if (bonus.rows.length === 0) throw new Error('Invalid or expired code');
    const coins = bonus.rows[0].coins;
    await client.query('UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2', [coins, userId]);
    await client.query('INSERT INTO user_bonus_redemptions (user_id, bonus_code) VALUES ($1, $2)', [userId, code.toUpperCase()]);
    await awardReferralCommission(client, userId, coins);
    await client.query('COMMIT');
    res.json({ success: true, coins, message: `🎉 You redeemed ${coins} COINS!` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

app.post('/api/bonus-history', verifyTelegramData, async (req, res) => {
  try {
    const telegramId = req.telegramUser.id;
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.json([]);
    const history = await pool.query('SELECT bonus_code, redeemed_at FROM user_bonus_redemptions WHERE user_id = $1 ORDER BY redeemed_at DESC', [userResult.rows[0].id]);
    res.json(history.rows);
  } catch (err) { res.json([]); }
});

// ============================================
// WITHDRAWAL
// ============================================

app.post('/api/withdraw', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { amount, walletAddress } = req.body;
    const telegramId = req.telegramUser.id;
    const userResult = await client.query('SELECT id, coins FROM users WHERE telegram_id = $1', [String(telegramId)]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = userResult.rows[0];
    if (amount < MIN_WITHDRAWAL_COINS) return res.status(400).json({ error: `Minimum withdrawal is ${MIN_WITHDRAWAL_COINS} COINS` });
    if (user.coins < amount) return res.status(400).json({ error: 'Insufficient coins' });
    await client.query('BEGIN');
    await client.query('UPDATE users SET coins = coins - $1 WHERE id = $2', [amount, user.id]);
    await client.query(`INSERT INTO withdrawals (user_id, amount, wallet_address, status) VALUES ($1, $2, $3, 'pending')`, [user.id, amount, walletAddress]);
    await client.query('COMMIT');
    res.json({ success: true, message: 'Withdrawal request submitted' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Withdrawal Error:', err);
    res.status(500).json({ error: 'Failed to process withdrawal' });
  } finally { client.release(); }
});

// ============================================
// ADMIN ENDPOINTS
// ============================================

app.get('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.photo_url, u.referral_code, u.coins, u.tier, u.referrals, u.wallet_address, u.created_at, u.team_id, COALESCE(ads.total_ads, 0) as total_ads FROM users u LEFT JOIN ad_statistics ads ON u.id = ads.user_id ORDER BY u.id DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch users' }); }
});

app.get('/api/admin/withdrawals', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`SELECT w.*, u.username, u.first_name, u.telegram_id FROM withdrawals w JOIN users u ON w.user_id = u.id ORDER BY w.created_at DESC`);
    res.json(result.rows);
  } catch (err) { res.json([]); }
});

app.post('/api/admin/update-withdrawal', verifyAdmin, async (req, res) => {
  const { withdrawalId, status } = req.body;
  try {
    const w = await pool.query('SELECT user_id, amount FROM withdrawals WHERE id = $1', [withdrawalId]);
    if (w.rows.length === 0) return res.status(404).json({ error: 'Withdrawal not found' });
    if (status === 'rejected' || status === 'failed') {
      await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [w.rows[0].amount, w.rows[0].user_id]);
    }
    await pool.query("UPDATE withdrawals SET status = $1, updated_at = NOW() WHERE id = $2", [status, withdrawalId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to update withdrawal' }); }
});

app.post('/api/admin/add-coins', verifyAdmin, async (req, res) => {
  const { userId, coins } = req.body;
  try {
    await pool.query('UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2', [coins, userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to add coins' }); }
});

app.post('/api/admin/deduct-coins', verifyAdmin, async (req, res) => {
  const { userId, coins } = req.body;
  try {
    const r = await pool.query('UPDATE users SET coins = coins - $1 WHERE id = $2 AND coins >= $1 RETURNING coins', [coins, userId]);
    if (r.rows.length === 0) return res.status(400).json({ error: 'Insufficient coins' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to deduct coins' }); }
});

app.post('/api/admin/delete-user', verifyAdmin, async (req, res) => {
  const { userId } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await client.query('SELECT id, team_id, telegram_id FROM users WHERE id = $1', [userId]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (u.rows[0].team_id) {
      const t = await client.query('SELECT created_by FROM teams WHERE id = $1', [u.rows[0].team_id]);
      const wasLeader = t.rows[0]?.created_by === userId;
      await client.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [u.rows[0].team_id, userId]);
      const rem = await client.query('SELECT user_id FROM team_members WHERE team_id = $1', [u.rows[0].team_id]);
      if (rem.rows.length === 0) {
        await client.query('DELETE FROM teams WHERE id = $1', [u.rows[0].team_id]);
      } else if (wasLeader) {
        await client.query('UPDATE teams SET created_by = $1 WHERE id = $2', [rem.rows[0].user_id, u.rows[0].team_id]);
      }
    }
    await client.query('DELETE FROM referrals WHERE referrer_id = $1 OR referred_id = $1', [userId]);
    await client.query('DELETE FROM ad_rewards WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM withdrawals WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM daily_rewards WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM wheel_spins WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM user_achievements WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM team_members WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM ad_statistics WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM user_bonus_redemptions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM social_tasks WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM referral_commissions WHERE referrer_id = $1 OR referred_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to delete user' });
  } finally { client.release(); }
});

app.get('/api/admin/analytics', verifyAdmin, async (req, res) => {
  try {
    const totalUsers = await pool.query('SELECT COUNT(*) FROM users');
    const today = new Date().toISOString().split('T')[0];
    const activeToday = await pool.query('SELECT COUNT(*) FROM users WHERE last_login_date = $1', [today]);
    const activeWeek = await pool.query("SELECT COUNT(*) FROM users WHERE last_login_date >= CURRENT_DATE - INTERVAL '7 days'");
    const totalAds = await pool.query('SELECT COUNT(*) FROM ad_rewards');
    const adsToday = await pool.query("SELECT COUNT(*) FROM ad_rewards WHERE created_at::date = CURRENT_DATE");
    const totalCoins = await pool.query('SELECT COALESCE(SUM(coins), 0) as total FROM users');
    const totalReferrals = await pool.query('SELECT COUNT(*) FROM referrals');
    const pendingWithdrawals = await pool.query("SELECT COUNT(*) FROM withdrawals WHERE status = 'pending'");
    const tierDistribution = await pool.query('SELECT tier, COUNT(*) as count FROM users GROUP BY tier');
    res.json({
      totalUsers: parseInt(totalUsers.rows[0].count),
      activeToday: parseInt(activeToday.rows[0].count),
      activeWeek: parseInt(activeWeek.rows[0].count),
      totalAds: parseInt(totalAds.rows[0].count),
      adsToday: parseInt(adsToday.rows[0].count),
      totalCoins: parseFloat(totalCoins.rows[0].total) || 0,
      totalReferrals: parseInt(totalReferrals.rows[0].count),
      pendingWithdrawals: parseInt(pendingWithdrawals.rows[0].count),
      tierDistribution: tierDistribution.rows
    });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch analytics' }); }
});

app.get('/api/admin/bonus-codes', verifyAdmin, async (req, res) => {
  try { res.json(await pool.query('SELECT * FROM bonus_codes ORDER BY created_at DESC').then(r => r.rows)); }
  catch (err) { res.status(500).json({ error: 'Failed to fetch bonus codes' }); }
});

app.post('/api/admin/bonus-codes', verifyAdmin, async (req, res) => {
  const { code, coins, description } = req.body;
  if (!code || coins === undefined) return res.status(400).json({ error: 'Code and coins required' });
  try {
    const r = await pool.query('INSERT INTO bonus_codes (code, coins, description, is_active) VALUES ($1, $2, $3, true) RETURNING *', [code.toUpperCase(), coins, description]);
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Bonus code already exists' });
    res.status(500).json({ error: 'Failed to add bonus code' });
  }
});

app.delete('/api/admin/bonus-codes/:code', verifyAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM bonus_codes WHERE code = $1', [req.params.code.toUpperCase()]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: 'Failed to delete' }); }
});

// ============================================
// ADMIN: Award Monthly Prizes (Based on THIS Month's Earnings)
// ============================================
app.post('/api/admin/award-monthly-prizes', verifyAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get first day of current month
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    
    // Get top 3 earners for THIS MONTH ONLY
    const topEarners = await client.query(`
      SELECT u.id, u.first_name, COALESCE(SUM(ar.reward_amount), 0) as monthly_coins
      FROM users u
      LEFT JOIN ad_rewards ar ON u.id = ar.user_id 
        AND ar.created_at >= $1
      GROUP BY u.id
      ORDER BY monthly_coins DESC
      LIMIT 3
    `, [firstOfMonth]);
    
    const prizes = [1000, 500, 200];
    
    for (let i = 0; i < topEarners.rows.length; i++) {
      const user = topEarners.rows[i];
      const prize = prizes[i];
      if (user.monthly_coins > 0) { // Only award if they actually earned something
        await client.query(
          'UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
          [prize, user.id]
        );
        console.log(`🏆 Monthly prize: ${prize} COINS awarded to ${user.first_name} (earned ${user.monthly_coins} this month)`);
      }
    }
    
    await client.query('COMMIT');
    res.json({ success: true, awarded: topEarners.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Award monthly error:', err);
    res.status(500).json({ error: 'Failed to award monthly prizes' });
  } finally {
    client.release();
  }
});

// ============================================
// ADMIN: Award Weekly Prizes (Based on Sunday-to-Sunday Referrals)
// ============================================
app.post('/api/admin/award-weekly-prizes', verifyAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get the most recent Sunday at midnight (start of the week we're awarding for)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysSinceSunday = dayOfWeek;
    
    const lastSunday = new Date(now);
    lastSunday.setDate(now.getDate() - daysSinceSunday);
    lastSunday.setHours(0, 0, 0, 0);
    const lastSundayStr = lastSunday.toISOString();
    
    const topReferrers = await client.query(`
      SELECT u.id, u.first_name, COUNT(r.id) as referral_count
      FROM users u
      LEFT JOIN referrals r ON u.id = r.referrer_id 
        AND r.created_at >= $1
      GROUP BY u.id
      ORDER BY referral_count DESC
      LIMIT 3
    `, [lastSundayStr]);
    
    const prizes = [100, 50, 25];
    
    for (let i = 0; i < topReferrers.rows.length; i++) {
      const user = topReferrers.rows[i];
      const prize = prizes[i];
      if (user.referral_count > 0) {
        await client.query(
          'UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
          [prize, user.id]
        );
        console.log(`🏆 Weekly prize: ${prize} COINS awarded to ${user.first_name} (${user.referral_count} referrals this week)`);
      }
    }
    
    await client.query('COMMIT');
    res.json({ success: true, awarded: topReferrers.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Award weekly error:', err);
    res.status(500).json({ error: 'Failed to award weekly prizes' });
  } finally {
    client.release();
  }
});

// ============================================
// TOURNAMENT: Auto-Award Weekly Prizes (Every Monday Midnight)
// ============================================

app.post('/api/admin/award-tournament-prizes', verifyAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get the most recent Monday at midnight (start of the week we're awarding for)
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday
    
    // Find the most recent Monday
    let daysSinceMonday = dayOfWeek - 1;
    if (daysSinceMonday < 0) daysSinceMonday += 7; // If today is Sunday, go back 6 days
    
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - daysSinceMonday);
    lastMonday.setHours(0, 0, 0, 0);
    const lastMondayStr = lastMonday.toISOString().split('T')[0];
    
    // Find the tournament for that week
    const tournament = await client.query(
      'SELECT id FROM weekly_tournaments WHERE week_start = $1',
      [lastMondayStr]
    );
    
    if (tournament.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: true, message: 'No tournament found for this week' });
    }
    
    const tournamentId = tournament.rows[0].id;
    
    // Get top 3 participants based on weekly coins earned
    const topParticipants = await client.query(`
      SELECT 
        u.id, u.first_name,
        COALESCE(SUM(ar.reward_amount), 0) as weekly_coins
      FROM tournament_participants tp
      JOIN users u ON tp.user_id = u.id
      LEFT JOIN ad_rewards ar ON u.id = ar.user_id 
        AND ar.created_at >= $2
        AND ar.created_at < $3
      WHERE tp.tournament_id = $1
      GROUP BY u.id
      ORDER BY weekly_coins DESC
      LIMIT 3
    `, [tournamentId, lastMondayStr, now.toISOString()]);
    
    const prizes = [1000, 500, 200]; // 1st, 2nd, 3rd place COINS
    
    for (let i = 0; i < topParticipants.rows.length; i++) {
      const user = topParticipants.rows[i];
      const prize = prizes[i];
      if (user.weekly_coins > 0) {
        await client.query(
          'UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
          [prize, user.id]
        );
        
        // Mark as awarded
        await client.query(
          'UPDATE tournament_participants SET prize_awarded = true, rank = $1 WHERE tournament_id = $2 AND user_id = $3',
          [i + 1, tournamentId, user.id]
        );
        
        console.log(`🏆 Tournament prize: ${prize} COINS awarded to ${user.first_name} (rank #${i + 1})`);
      }
    }
    
    // Mark tournament as inactive
    await client.query(
      'UPDATE weekly_tournaments SET is_active = false WHERE id = $1',
      [tournamentId]
    );
    
    await client.query('COMMIT');
    res.json({ success: true, awarded: topParticipants.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Award tournament error:', err);
    res.status(500).json({ error: 'Failed to award tournament prizes' });
  } finally {
    client.release();
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'OK' });
  } catch (err) {
    res.status(503).json({ status: 'DB unavailable' });
  }
});

app.get('/webhook', (req, res) => res.send('Webhook active'));

// ============================================
// TELEGRAM BOT
// ============================================
if (process.env.BOT_TOKEN) {
  const bot = new Telegraf(process.env.BOT_TOKEN);
  const MINI_APP_URL = process.env.MINI_APP_URL || 'https://yzemanbot-backend.onrender.com';
  const WEBHOOK_URL = process.env.WEBHOOK_URL || `${MINI_APP_URL}/webhook`;
  const CHANNEL_URL = 'https://t.me/YzemanEarnBotChannel';
  const SUPPORT_URL = 'https://t.me/yzemanreal';
  const BOT_USERNAME = 'YzemanBot';
  const referralCache = new Map();
  
  bot.telegram.setWebhook(WEBHOOK_URL).catch(err => console.error('Webhook error:', err));
  
  const mainMenuKeyboard = {
    reply_markup: {
      keyboard: [
        [{ text: "🚀 OPEN YZEMANBOT" }, { text: "💰 MY EARNINGS" }],
        [{ text: "👥 MY REFERRAL" }, { text: "📢 CHANNEL" }],
        [{ text: "❓ HELP" }, { text: "ℹ️ ABOUT" }],
        [{ text: "👤 SUPPORT" }, { text: "🏆 LEADERBOARD" }]
      ],
      resize_keyboard: true, persistent: true
    }
  };
  
  function storePendingReferral(tid, code) { referralCache.set(tid, { code, timestamp: Date.now() }); }
  function getAndClearPendingReferral(tid) {
    const p = referralCache.get(tid);
    if (p && (Date.now() - p.timestamp) < 300000) { referralCache.delete(tid); return p.code; }
    return null;
  }
  async function getUserData(tid) {
    const r = await pool.query('SELECT coins, referrals, tier, referral_code FROM users WHERE telegram_id = $1', [tid]);
    return r.rows[0] || null;
  }
  
  bot.start(async (ctx) => {
    const tid = ctx.from.id, firstName = ctx.from.first_name, payload = ctx.startPayload || '';
    let url = MINI_APP_URL;
    if (payload) { storePendingReferral(tid, payload); url += `?start=${payload}`; }
    const u = await getUserData(tid);
    const msg = u ? `🎉 *Welcome back, ${firstName}!*\n\n💰 Balance: ${u.coins} COINS\n👑 Tier: ${u.tier}\n👥 Referrals: ${u.referrals}\n\n🚀 Tap OPEN YZEMANBOT to earn more!` : `🎉 *Welcome to YzemanBot, ${firstName}!*\n\nEarn COINS by watching ads, inviting friends, daily rewards, and more!`;
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🚀 OPEN YZEMANBOT', web_app: { url } }]] } });
    await ctx.reply(`🚀 Use OPEN YZEMANBOT to launch the app`, { parse_mode: 'Markdown', ...mainMenuKeyboard });
  });
  
  bot.hears('🚀 OPEN YZEMANBOT', async (ctx) => {
    let url = MINI_APP_URL;
    const code = getAndClearPendingReferral(ctx.from.id);
    if (code) url += `?start=${code}`;
    await ctx.reply(`🚀 *Opening YzemanBot...*`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🚀 LAUNCH APP', web_app: { url } }]] } });
  });
  
  bot.hears('💰 MY EARNINGS', async (ctx) => {
    const u = await getUserData(ctx.from.id);
    if (!u) return ctx.reply('⚠️ No account yet! Tap OPEN YZEMANBOT.', mainMenuKeyboard);
    const rank = await pool.query('SELECT COUNT(*) as rank FROM users WHERE coins > (SELECT COALESCE(coins,0) FROM users WHERE telegram_id = $1)', [ctx.from.id]);
    await ctx.reply(`💎 *YOUR EARNINGS*\n\n💰 Balance: ${u.coins} COINS\n👑 Tier: ${u.tier}\n👥 Referrals: ${u.referrals}\n🏆 Global Rank: #${(rank.rows[0]?.rank||0)+1}`, { parse_mode: 'Markdown', ...mainMenuKeyboard });
  });
  
  bot.hears('👥 MY REFERRAL', async (ctx) => {
    const u = await getUserData(ctx.from.id);
    if (!u?.referral_code) return ctx.reply('⚠️ Create account first!', mainMenuKeyboard);
    const link = `https://t.me/${BOT_USERNAME}?start=${u.referral_code}`;
    await ctx.reply(`👥 *YOUR REFERRAL*\n\n🔗 \`${link}\`\n\n📊 Referrals: ${u.referrals}\n💰 Earn 5-25 COINS per invite + 2% commission!\n✨ Friend gets 2000 COINS!`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📤 COPY LINK', callback_data: 'copy_link' }]] } });
  });
  bot.action('copy_link', async (ctx) => {
    const u = await getUserData(ctx.from.id);
    if (u?.referral_code) { await ctx.answerCbQuery(); await ctx.reply(`🔗 \`https://t.me/${BOT_USERNAME}?start=${u.referral_code}\``, { parse_mode: 'Markdown' }); }
    else await ctx.answerCbQuery('Error');
  });
  bot.hears('📢 CHANNEL', async (ctx) => { await ctx.reply('📢 *Official Channel*\n\nJoin for updates and bonus codes!', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📢 JOIN CHANNEL', url: CHANNEL_URL }]] } }); });
  bot.hears('❓ HELP', async (ctx) => { await ctx.reply(`📚 *Help Center*\n\nEarn by:\n🎬 Watch Ads\n👥 Refer Friends\n📅 Daily Rewards\n🎡 Wheel Spins\n\nWithdrawal: 100,000 COINS min\nSupport: @yzemanreal`, { parse_mode: 'Markdown', ...mainMenuKeyboard }); });
  bot.hears('ℹ️ ABOUT', async (ctx) => { await ctx.reply(`ℹ️ *YzemanBot v2.0*\n\nEarn COINS through ads, referrals, daily rewards, and wheel spins!\n\n💰 Withdraw to USDT (100K COINS min)`, { parse_mode: 'Markdown', ...mainMenuKeyboard }); });
  bot.hears('👤 SUPPORT', async (ctx) => { await ctx.reply(`👤 *Need Help?*\n\nContact: @yzemanreal`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📧 CONTACT', url: SUPPORT_URL }]] } }); });
  bot.hears('🏆 LEADERBOARD', async (ctx) => { await ctx.reply(`🏆 *Global Leaderboard*\n\nTap below to view top earners!`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🏆 VIEW LEADERBOARD', web_app: { url: `${MINI_APP_URL}/leaderboard.html` } }]] } }); });
  bot.on('text', async (ctx) => {
    const valid = ['🚀 OPEN YZEMANBOT','💰 MY EARNINGS','👥 MY REFERRAL','📢 CHANNEL','❓ HELP','ℹ️ ABOUT','👤 SUPPORT','🏆 LEADERBOARD'];
    if (!valid.includes(ctx.message.text) && !ctx.message.text.startsWith('/'))
      await ctx.reply('❓ Please use OPEN YZEMANBOT to launch the app:', mainMenuKeyboard);
  });
  app.use(bot.webhookCallback('/webhook'));
  console.log('🤖 Telegram Bot configured');
}

// ============================================
// START SERVER
// ============================================

async function startServer() {
  try {
    await initDB();
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}
startServer();
