const { Pool } = require('pg');
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { Telegraf } = require('telegraf');
const app = express();

// Use port 3001 (matching your Render environment)
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// Point Economy Constants
const POINTS_PER_COIN = 1000000;        // 1,000,000 points = 1 COIN
const MIN_WITHDRAWAL_COINS = 100000;    // 100,000 COINS to withdraw

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

app.use(bodyParser.json({ limit: '10kb' }));
app.use(express.static('public'));

// ============================================
// DATABASE INITIALIZATION
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
        points BIGINT NOT NULL DEFAULT 0,
        tier TEXT NOT NULL DEFAULT 'Fresher',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`);
    
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referrals INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_date DATE`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_points_earned BIGINT DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id INTEGER`);

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
        ('Fresher', 0, 1.0, 500000),
        ('Brute', 150, 1.5, 750000),
        ('Silver', 350, 2.0, 1000000),
        ('Gold', 700, 2.5, 1500000),
        ('Platinum', 1500, 3.0, 2500000)
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
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ad_rewards (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        reward_amount INTEGER NOT NULL,
        ad_type TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount DECIMAL(10,2) NOT NULL,
        wallet_address TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_rewards (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        reward_date DATE NOT NULL,
        streak_count INTEGER DEFAULT 1,
        reward_points INTEGER NOT NULL,
        claimed BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, reward_date)
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS wheel_spins (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        spin_date DATE NOT NULL,
        reward_points INTEGER NOT NULL,
        spin_type TEXT DEFAULT 'normal',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, spin_date)
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS achievements (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        badge_icon TEXT,
        required_value INTEGER,
        points_reward INTEGER DEFAULT 0
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_achievements (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        achievement_id INTEGER NOT NULL REFERENCES achievements(id),
        achieved_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, achievement_id)
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS weekly_tournaments (
        id SERIAL PRIMARY KEY,
        week_start DATE NOT NULL,
        week_end DATE NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tournament_participants (
        id SERIAL PRIMARY KEY,
        tournament_id INTEGER NOT NULL REFERENCES weekly_tournaments(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        points_earned INTEGER DEFAULT 0,
        referral_count INTEGER DEFAULT 0,
        rank INTEGER,
        prize_awarded BOOLEAN DEFAULT FALSE,
        UNIQUE(tournament_id, user_id)
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        code TEXT UNIQUE NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        joined_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(team_id, user_id)
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_competitions (
        id SERIAL PRIMARY KEY,
        month_year DATE NOT NULL,
        winning_team_id INTEGER REFERENCES teams(id),
        is_active BOOLEAN DEFAULT TRUE,
        UNIQUE(month_year)
      )`);

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
      CREATE TABLE IF NOT EXISTS bonus_redemptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        bonus_code TEXT NOT NULL,
        reward_points INTEGER NOT NULL,
        redeemed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      INSERT INTO achievements (name, description, badge_icon, required_value, points_reward) VALUES
        ('Loyal User', '30 day login streak', '🔥', 30, 50000000),
        ('Referral Master', 'Get 100 referrals', '👑', 100, 100000000),
        ('Points Millionaire', 'Earn 1,000,000,000 points', '💰', 1000000000, 1000000000),
        ('Social Butterfly', 'Complete all social tasks', '🦋', 5, 25000000),
        ('Tournament Winner', 'Win a weekly tournament', '🏆', 1, 50000000),
        ('Team Player', 'Join a team', '🤝', 1, 10000000),
        ('Platinum Elite', 'Reach Platinum tier', '💎', 1500, 200000000),
        ('Wheel Champion', 'Win 10,000 points on wheel', '🎡', 10000, 25000000),
        ('Daily Streak 7', '7 day login streak', '📅', 7, 5000000),
        ('Super Referrer', 'Get 500 referrals', '⭐', 500, 500000000),
        ('Ad Master', 'Watch 1000 ads', '📺', 1000, 50000000)
      ON CONFLICT (name) DO UPDATE SET
        description = EXCLUDED.description,
        points_reward = EXCLUDED.points_reward
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
// HELPER FUNCTION: Award Achievement with Points
// ============================================

async function awardAchievement(userId, achievementName, notify = true) {
  const client = await pool.connect();
  try {
    const achievement = await client.query(
      'SELECT id, points_reward FROM achievements WHERE name = $1',
      [achievementName]
    );
    
    if (achievement.rows.length === 0) return false;
    
    const achievementId = achievement.rows[0].id;
    const pointsReward = achievement.rows[0].points_reward;
    
    const existing = await client.query(
      'SELECT * FROM user_achievements WHERE user_id = $1 AND achievement_id = $2',
      [userId, achievementId]
    );
    
    if (existing.rows.length > 0) return false;
    
    await client.query('BEGIN');
    
    await client.query(
      'INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2)',
      [userId, achievementId]
    );
    
    if (pointsReward > 0) {
      await client.query(
        'UPDATE users SET points = points + $1, total_points_earned = total_points_earned + $1 WHERE id = $2',
        [pointsReward, userId]
      );
      console.log(`🎉 Achievement "${achievementName}" awarded to user ${userId} +${pointsReward} points`);
    }
    
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Error awarding achievement ${achievementName}:`, err);
    return false;
  } finally {
    client.release();
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
// USER API ENDPOINT (FIXED REFERRAL SYSTEM)
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
      console.log(`✅ Existing user ${id} updated`);
      
    } else {
      // NEW USER - Create account
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
      
      // ============================================
      // PROCESS REFERRAL (ONLY FOR NEW USERS)
      // ============================================
      
      if (referralCode && referralCode !== userReferralCode) {
        console.log(`🔗 Processing referral: New user ${id} used code ${referralCode}`);
        
        // Clean the referral code (remove prefixes)
        let cleanReferralCode = referralCode;
        if (cleanReferralCode.startsWith('ref-')) cleanReferralCode = cleanReferralCode.substring(4);
        if (cleanReferralCode.startsWith('YZEMAN-')) cleanReferralCode = cleanReferralCode.substring(7);
        
        // Find the referrer
        let referrerResult = await client.query(
          'SELECT id, tier, username, first_name, telegram_id, points, referral_code FROM users WHERE referral_code = $1',
          [cleanReferralCode]
        );
        
        if (referrerResult.rows.length === 0) {
          referrerResult = await client.query(
            'SELECT id, tier, username, first_name, telegram_id, points, referral_code FROM users WHERE referral_code = $1',
            [`ref-${cleanReferralCode}`]
          );
        }
        
        if (referrerResult.rows.length === 0) {
          referrerResult = await client.query(
            'SELECT id, tier, username, first_name, telegram_id, points, referral_code FROM users WHERE referral_code = $1',
            [`YZEMAN-${cleanReferralCode}`]
          );
        }
        
        if (referrerResult.rows.length > 0 && referrerResult.rows[0].id !== user.id) {
          const referrerId = referrerResult.rows[0].id;
          const referrerTier = referrerResult.rows[0].tier;
          const referrerTelegramId = referrerResult.rows[0].telegram_id;
          const referrerName = referrerResult.rows[0].first_name || referrerResult.rows[0].username || 'User';
          
          // Get referral reward based on referrer's tier
          const tierResult = await client.query(
            'SELECT referral_reward FROM tiers WHERE name = $1',
            [referrerTier]
          );
          
          const referrerReward = tierResult.rows[0]?.referral_reward || 500000;
          const refereeBonus = 250000; // Bonus for new user
          
          // Check if already referred (prevent double referral)
          const existingReferral = await client.query(
            'SELECT * FROM referrals WHERE referrer_id = $1 AND referred_id = $2',
            [referrerId, user.id]
          );
          
          if (existingReferral.rows.length === 0) {
            // Insert referral record
            await client.query(
              'INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)',
              [referrerId, user.id]
            );
            
            // Give bonus to referrer
            await client.query(
              'UPDATE users SET points = points + $1, referrals = referrals + 1, total_points_earned = total_points_earned + $1 WHERE id = $2',
              [referrerReward, referrerId]
            );
            
            // Give bonus to new user (referee)
            await client.query(
              'UPDATE users SET points = points + $1, total_points_earned = total_points_earned + $1 WHERE id = $2',
              [refereeBonus, user.id]
            );
            
            // Update referrer's tier based on new referral count
            const newReferralCount = await client.query(
              'SELECT COUNT(*) FROM referrals WHERE referrer_id = $1',
              [referrerId]
            );
            const count = parseInt(newReferralCount.rows[0].count);
            
            const newTier = await client.query(
              `SELECT name FROM tiers 
               WHERE refs_required <= $1 
               ORDER BY refs_required DESC 
               LIMIT 1`,
              [count]
            );
            
            let newTierName = referrerTier;
            if (newTier.rows.length > 0 && newTier.rows[0].name !== referrerTier) {
              newTierName = newTier.rows[0].name;
              await client.query(
                'UPDATE users SET tier = $1 WHERE id = $2',
                [newTierName, referrerId]
              );
            }
            
            console.log(`✅ REFERRAL SUCCESS! Referrer ${referrerId} earned ${referrerReward} points, New user ${user.id} earned ${refereeBonus} points`);
            
            // Update the user's points in the current object
            user.points = (user.points || 0) + refereeBonus;
            
            // ============================================
            // SEND TELEGRAM NOTIFICATION TO REFERRER
            // ============================================
            const BOT_TOKEN = process.env.BOT_TOKEN;
            if (BOT_TOKEN && referrerTelegramId) {
              const newUserName = user.first_name || user.username || 'Someone';
              const referrerCoins = (referrerReward / 1000000).toFixed(2);
              const refereeCoins = (refereeBonus / 1000000).toFixed(2);
              
              const notificationMessage = `🎉 *NEW REFERRAL!* 🎉\n\n` +
                `👤 *${newUserName}* just joined using your referral link!\n\n` +
                `📊 *Your Stats:*\n` +
                `💰 You earned: +${referrerCoins} COINS\n` +
                `👥 Total referrals: ${count}\n` +
                `🏆 Current tier: ${newTierName}\n\n` +
                `✨ *Your friend also got:* +${refereeCoins} COINS bonus!\n\n` +
                `Keep sharing your link to earn more! 🚀`;
              
              try {
                const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: referrerTelegramId,
                    text: notificationMessage,
                    parse_mode: 'Markdown'
                  })
                });
                
                const responseData = await telegramResponse.json();
                if (responseData.ok) {
                  console.log(`📨 Referral notification sent to ${referrerTelegramId}`);
                } else {
                  console.error(`❌ Telegram API error: ${responseData.description}`);
                }
              } catch (notifyErr) {
                console.error(`❌ Failed to send notification: ${notifyErr.message}`);
              }
            } else {
              console.log(`⚠️ Cannot send notification: BOT_TOKEN=${!!BOT_TOKEN}, referrerTelegramId=${referrerTelegramId}`);
            }
            
          } else {
            console.log(`⚠️ User ${user.id} was already referred by ${referrerId}`);
          }
        } else {
          console.log(`⚠️ Invalid referral code or self-referral attempted for code: ${referralCode}`);
        }
      } else {
        console.log(`ℹ️ No valid referral code provided for new user ${id}`);
      }
    }
    
    // Get user stats (referrals count, tier info)
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
    
    console.log(`📤 Response sent for user ${id}: points=${user.points}, referrals=${stats?.referrals || 0}`);
    res.json({ ...user, ...stats });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ User Error:', err);
    res.status(500).json({ error: 'Database operation failed: ' + err.message });
  } finally {
    client.release();
  }
});

// ============================================
// AD REWARD ENDPOINT
// ============================================

app.post('/api/ad-reward', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { rewardAmount, adType } = req.body;
    const telegramId = req.telegramUser.id;

    const userResult = await client.query(
      'SELECT id, points FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userId = userResult.rows[0].id;
    
    await client.query(
      'INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)',
      [userId, rewardAmount, adType]
    );
    
    await client.query(
      'UPDATE users SET points = points + $1, total_points_earned = total_points_earned + $1 WHERE id = $2',
      [rewardAmount, userId]
    );
    
    const userPoints = await client.query('SELECT points FROM users WHERE id = $1', [userId]);
    if (userPoints.rows[0].points >= 1000000000) {
      await awardAchievement(userId, 'Points Millionaire');
    }
    
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

// ============================================
// AD STATISTICS ENDPOINT
// ============================================

app.post('/api/ad-stats', verifyTelegramData, async (req, res) => {
  const { adStreak, totalAdsWatched, adsWatchedToday, adsWatchedWeek } = req.body;
  const telegramId = req.telegramUser.id;
  
  try {
    const userResult = await pool.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userId = userResult.rows[0].id;
    
    await pool.query(`
      INSERT INTO ad_statistics (user_id, ad_streak, total_ads, ads_today, ads_week, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        ad_streak = EXCLUDED.ad_streak,
        total_ads = EXCLUDED.total_ads,
        ads_today = EXCLUDED.ads_today,
        ads_week = EXCLUDED.ads_week,
        updated_at = NOW()
    `, [userId, adStreak, totalAdsWatched, adsWatchedToday, adsWatchedWeek]);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Ad stats error:', err);
    res.status(500).json({ error: 'Failed to save ad stats' });
  }
});

// ============================================
// DAILY REWARDS API
// ============================================

app.post('/api/daily-reward', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const telegramId = req.telegramUser.id;
    const today = new Date().toISOString().split('T')[0];
    
    const userResult = await client.query(
      'SELECT id, last_login_date FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userId = userResult.rows[0].id;
    const lastLogin = userResult.rows[0].last_login_date;
    
    const existingReward = await client.query(
      'SELECT * FROM daily_rewards WHERE user_id = $1 AND reward_date = $2',
      [userId, today]
    );
    
    if (existingReward.rows.length > 0) {
      return res.status(400).json({ error: 'Already claimed today' });
    }
    
    let streak = 1;
    if (lastLogin) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      if (lastLogin === yesterdayStr) {
        const lastStreak = await client.query(
          'SELECT streak_count FROM daily_rewards WHERE user_id = $1 ORDER BY reward_date DESC LIMIT 1',
          [userId]
        );
        streak = (lastStreak.rows[0]?.streak_count || 0) + 1;
      }
    }
    
    const baseReward = 100000;
    const streakBonus = streak * 50000;
    let rewardPoints = baseReward + streakBonus;
    
    if (streak % 7 === 0) {
      rewardPoints += 500000;
    }
    
    const userTier = await client.query('SELECT tier FROM users WHERE id = $1', [userId]);
    const tierMultiplier = { Fresher: 1.0, Brute: 1.5, Silver: 2.0, Gold: 2.5, Platinum: 3.0 };
    const multiplier = tierMultiplier[userTier.rows[0]?.tier] || 1.0;
    const finalReward = Math.floor(rewardPoints * multiplier);
    
    await client.query('BEGIN');
    
    await client.query(
      'INSERT INTO daily_rewards (user_id, reward_date, streak_count, reward_points) VALUES ($1, $2, $3, $4)',
      [userId, today, streak, finalReward]
    );
    
    await client.query(
      'UPDATE users SET points = points + $1, total_points_earned = total_points_earned + $1, last_login_date = $2 WHERE id = $3',
      [finalReward, today, userId]
    );
    
    if (streak >= 7) await awardAchievement(userId, 'Daily Streak 7');
    if (streak >= 30) await awardAchievement(userId, 'Loyal User');
    
    await client.query('COMMIT');
    
    res.json({ 
      success: true, 
      reward: finalReward, 
      streak: streak,
      message: `🎁 Daily reward: ${(finalReward / POINTS_PER_COIN).toFixed(2)} COINS! Streak: ${streak} days 🔥`
    });
    
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
    
    const userResult = await pool.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (userResult.rows.length === 0) {
      return res.json({ claimed_today: false, last_7_days: [], max_streak: 0, current_streak: 0 });
    }
    
    const userId = userResult.rows[0].id;
    const today = new Date().toISOString().split('T')[0];
    
    const claimedToday = await pool.query(
      'SELECT * FROM daily_rewards WHERE user_id = $1 AND reward_date = $2',
      [userId, today]
    );
    
    const last7Days = await pool.query(`
      SELECT reward_date, streak_count, reward_points
      FROM daily_rewards
      WHERE user_id = $1
      ORDER BY reward_date DESC
      LIMIT 7
    `, [userId]);
    
    const maxStreak = await pool.query(`
      SELECT COALESCE(MAX(streak_count), 0) as max_streak
      FROM daily_rewards
      WHERE user_id = $1
    `, [userId]);
    
    let currentStreak = 0;
    if (last7Days.rows.length > 0) {
      const mostRecent = last7Days.rows[0];
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      if (mostRecent.reward_date === today || mostRecent.reward_date === yesterdayStr) {
        currentStreak = mostRecent.streak_count;
      }
    }
    
    res.json({
      claimed_today: claimedToday.rows.length > 0,
      last_7_days: last7Days.rows,
      max_streak: maxStreak.rows[0].max_streak,
      current_streak: currentStreak
    });
    
  } catch (err) {
    console.error('Daily stats error:', err);
    res.json({ claimed_today: false, last_7_days: [], max_streak: 0, current_streak: 0 });
  }
});

// ============================================
// WHEEL OF FORTUNE API
// ============================================

app.post('/api/wheel-spin', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const telegramId = req.telegramUser.id;
    const today = new Date().toISOString().split('T')[0];
    
    const userResult = await client.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userId = userResult.rows[0].id;
    
    const lastSpin = await client.query(
      "SELECT spin_date FROM wheel_spins WHERE user_id = $1 ORDER BY spin_date DESC LIMIT 1",
      [userId]
    );
    
    if (lastSpin.rows.length > 0) {
      const lastSpinDate = new Date(lastSpin.rows[0].spin_date);
      const daysDiff = Math.floor((new Date() - lastSpinDate) / (1000 * 60 * 60 * 24));
      if (daysDiff < 3) {
        const daysLeft = 3 - daysDiff;
        return res.status(400).json({ 
          error: `Next spin available in ${daysLeft} day(s)`,
          daysLeft: daysLeft
        });
      }
    }
    
    const prizes = [50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000];
    const randomIndex = Math.floor(Math.random() * prizes.length);
    const rewardPoints = prizes[randomIndex];
    
    const userTier = await client.query('SELECT tier FROM users WHERE id = $1', [userId]);
    const tierMultiplier = { Fresher: 1.0, Brute: 1.5, Silver: 2.0, Gold: 2.5, Platinum: 3.0 };
    const multiplier = tierMultiplier[userTier.rows[0]?.tier] || 1.0;
    const finalReward = Math.floor(rewardPoints * multiplier);
    
    await client.query('BEGIN');
    
    await client.query(
      'INSERT INTO wheel_spins (user_id, spin_date, reward_points) VALUES ($1, $2, $3)',
      [userId, today, finalReward]
    );
    
    await client.query(
      'UPDATE users SET points = points + $1, total_points_earned = total_points_earned + $1 WHERE id = $2',
      [finalReward, userId]
    );
    
    if (rewardPoints === 10000000) await awardAchievement(userId, 'Wheel Champion');
    
    await client.query('COMMIT');
    
    res.json({ 
      success: true, 
      reward: finalReward,
      prize: rewardPoints,
      multiplier: multiplier,
      message: `🎡 You won ${(finalReward / 1000000).toFixed(2)} COINS!`
    });
    
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
    
    const userResult = await pool.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userId = userResult.rows[0].id;
    
    const lastSpin = await pool.query(
      "SELECT spin_date, reward_points FROM wheel_spins WHERE user_id = $1 ORDER BY spin_date DESC LIMIT 1",
      [userId]
    );
    
    let canSpin = true;
    let daysLeft = 0;
    let lastReward = 0;
    
    if (lastSpin.rows.length > 0) {
      const lastSpinDate = new Date(lastSpin.rows[0].spin_date);
      const daysDiff = Math.floor((new Date() - lastSpinDate) / (1000 * 60 * 60 * 24));
      lastReward = lastSpin.rows[0].reward_points;
      if (daysDiff < 3) {
        canSpin = false;
        daysLeft = 3 - daysDiff;
      }
    }
    
    res.json({
      can_spin: canSpin,
      days_left: daysLeft,
      last_reward: lastReward
    });
    
  } catch (err) {
    console.error('Wheel status error:', err);
    res.status(500).json({ error: 'Failed to fetch wheel status' });
  }
});

// ============================================
// LEADERBOARD API
// ============================================

app.post('/api/leaderboard/weekly-referrers', verifyTelegramData, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.username, u.first_name, u.photo_url,
        COUNT(r.id) as referral_count, u.tier
      FROM users u
      LEFT JOIN referrals r ON u.id = r.referrer_id 
        AND r.created_at > NOW() - INTERVAL '7 days'
      GROUP BY u.id
      ORDER BY referral_count DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

app.post('/api/leaderboard/top-earners', verifyTelegramData, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, username, first_name, photo_url, points, tier, total_points_earned, telegram_id
      FROM users
      ORDER BY points DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch top earners' });
  }
});

app.post('/api/leaderboard/weekly-earnings', verifyTelegramData, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.username, u.first_name, u.photo_url,
        COALESCE(SUM(ar.reward_amount), 0) as weekly_earnings, u.tier
      FROM users u
      LEFT JOIN ad_rewards ar ON u.id = ar.user_id 
        AND ar.created_at > NOW() - INTERVAL '7 days'
      GROUP BY u.id
      ORDER BY weekly_earnings DESC
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
    
    const userResult = await pool.query(
      'SELECT id, points, referrals, tier, total_points_earned FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
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
        points: user.points,
        referrals: user.referrals,
        tier: user.tier,
        total_points_earned: user.total_points_earned,
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
// TOURNAMENT API
// ============================================

app.post('/api/tournament/join', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const telegramId = req.telegramUser.id;
    
    const userResult = await client.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const userId = userResult.rows[0].id;
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().split('T')[0];
    
    let tournament = await client.query('SELECT * FROM weekly_tournaments WHERE week_start = $1', [weekStartStr]);
    
    if (tournament.rows.length === 0) {
      const result = await client.query(
        `INSERT INTO weekly_tournaments (week_start, week_end, is_active) VALUES ($1, $2, true) RETURNING *`,
        [weekStartStr, weekEndStr]
      );
      tournament = result;
    }
    
    const tournamentId = tournament.rows[0].id;
    
    const existing = await client.query(
      'SELECT * FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2',
      [tournamentId, userId]
    );
    
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Already joined this tournament' });
    
    await client.query(`INSERT INTO tournament_participants (tournament_id, user_id) VALUES ($1, $2)`, [tournamentId, userId]);
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

app.post('/api/tournament/standings', verifyTelegramData, async (req, res) => {
  try {
    const telegramId = req.telegramUser.id;
    
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const userId = userResult.rows[0].id;
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    
    const tournament = await pool.query('SELECT id FROM weekly_tournaments WHERE week_start = $1', [weekStartStr]);
    if (tournament.rows.length === 0) {
      return res.json({ standings: [], my_rank: null, my_points: 0, has_joined: false });
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
        COALESCE(SUM(ar.reward_amount), 0) as weekly_points, u.tier,
        ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(ar.reward_amount), 0) DESC) as rank
      FROM tournament_participants tp
      JOIN users u ON tp.user_id = u.id
      LEFT JOIN ad_rewards ar ON u.id = ar.user_id AND ar.created_at > NOW() - INTERVAL '7 days'
      WHERE tp.tournament_id = $1
      GROUP BY u.id
      ORDER BY weekly_points DESC
    `, [tournamentId]);
    
    let myRank = null, myPoints = 0;
    for (const row of standings.rows) {
      if (row.id === userId) { myRank = row.rank; myPoints = parseInt(row.weekly_points); break; }
    }
    
    res.json({ standings: standings.rows, my_rank: myRank, my_points: myPoints, has_joined: hasJoined });
    
  } catch (err) {
    console.error('Tournament standings error:', err);
    res.status(500).json({ error: 'Failed to fetch standings' });
  }
});

// ============================================
// TEAM API ENDPOINTS (COMPLETE & CORRECTED)
// ============================================

// Create a team (with duplicate name check)
app.post('/api/team/create', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { teamName } = req.body;
    const telegramId = req.telegramUser.id;
    
    if (!teamName || teamName.trim().length < 3) {
      return res.status(400).json({ error: 'Team name must be at least 3 characters' });
    }
    
    const userResult = await client.query(
      'SELECT id, team_id FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userId = userResult.rows[0].id;
    
    if (userResult.rows[0].team_id) {
      return res.status(400).json({ error: 'You are already in a team' });
    }
    
    // Check if team name already exists
    const existingTeam = await client.query(
      'SELECT id FROM teams WHERE name = $1',
      [teamName.trim()]
    );
    
    if (existingTeam.rows.length > 0) {
      return res.status(400).json({ error: 'Team name already exists. Please choose another name.' });
    }
    
    await client.query('BEGIN');
    
    // Generate unique team code (6 characters)
    let teamCode;
    let codeExists = true;
    while (codeExists) {
      teamCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      const existing = await client.query('SELECT id FROM teams WHERE code = $1', [teamCode]);
      codeExists = existing.rows.length > 0;
    }
    
    const teamResult = await client.query(
      'INSERT INTO teams (name, code, created_by) VALUES ($1, $2, $3) RETURNING *',
      [teamName.trim(), teamCode, userId]
    );
    
    const team = teamResult.rows[0];
    
    await client.query(
      'INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)',
      [team.id, userId]
    );
    
    await client.query(
      'UPDATE users SET team_id = $1 WHERE id = $2',
      [team.id, userId]
    );
    
    await awardAchievement(userId, 'Team Player');
    
    await client.query('COMMIT');
    
    res.json({ success: true, team });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create team error:', err);
    res.status(500).json({ error: 'Failed to create team' });
  } finally {
    client.release();
  }
});

// Join a team by code (with proper error handling)
app.post('/api/team/join', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { teamCode } = req.body;
    const telegramId = req.telegramUser.id;
    
    if (!teamCode || teamCode.trim().length < 4) {
      return res.status(400).json({ error: 'Invalid team code' });
    }
    
    const userResult = await client.query(
      'SELECT id, team_id FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userId = userResult.rows[0].id;
    
    if (userResult.rows[0].team_id) {
      return res.status(400).json({ error: 'You are already in a team. Leave your current team first.' });
    }
    
    const teamResult = await client.query(
      'SELECT * FROM teams WHERE code = $1',
      [teamCode.trim().toUpperCase()]
    );
    
    if (teamResult.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found. Check the code and try again.' });
    }
    
    const team = teamResult.rows[0];
    
    await client.query('BEGIN');
    
    await client.query(
      'INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)',
      [team.id, userId]
    );
    
    await client.query(
      'UPDATE users SET team_id = $1 WHERE id = $2',
      [team.id, userId]
    );
    
    await awardAchievement(userId, 'Team Player');
    
    await client.query('COMMIT');
    
    res.json({ success: true, team });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Join team error:', err);
    res.status(500).json({ error: 'Failed to join team' });
  } finally {
    client.release();
  }
});

// Get user's team info (or team info by ID for admin panel)
app.post('/api/team/info', verifyTelegramData, async (req, res) => {
  try {
    let teamId = req.body.teamId; // For admin panel calls
    const telegramId = req.telegramUser?.id;
    
    // If no teamId provided, get from current user
    if (!teamId && telegramId) {
      const userResult = await pool.query(
        'SELECT team_id FROM users WHERE telegram_id = $1',
        [telegramId]
      );
      if (userResult.rows.length > 0 && userResult.rows[0].team_id) {
        teamId = userResult.rows[0].team_id;
      }
    }
    
    if (!teamId) {
      return res.json({ has_team: false });
    }
    
    // Get team details with total points
    const teamResult = await pool.query(`
      SELECT t.*, 
        COALESCE(SUM(u.points), 0) as total_points,
        COUNT(tm.user_id) as member_count,
        COALESCE(SUM(u.referrals), 0) as total_referrals
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id
      LEFT JOIN users u ON tm.user_id = u.id
      WHERE t.id = $1
      GROUP BY t.id
    `, [teamId]);
    
    if (teamResult.rows.length === 0) {
      return res.json({ has_team: false });
    }
    
    const team = teamResult.rows[0];
    
    // Get team members (ordered by join date, then points)
    const membersResult = await pool.query(`
      SELECT u.id, u.telegram_id, u.first_name, u.username, u.photo_url, u.points, u.referrals, u.tier,
        (u.id = t.created_by) as is_leader,
        tm.joined_at
      FROM team_members tm
      JOIN users u ON tm.user_id = u.id
      JOIN teams t ON tm.team_id = t.id
      WHERE tm.team_id = $1
      ORDER BY tm.joined_at ASC, u.points DESC
    `, [teamId]);
    
    res.json({
      has_team: true,
      team,
      members: membersResult.rows
    });
  } catch (err) {
    console.error('Team info error:', err);
    res.status(500).json({ error: 'Failed to fetch team info' });
  }
});

// Leave team (with leader reassignment and auto-delete)
app.post('/api/team/leave', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const telegramId = req.telegramUser.id;
    
    const userResult = await client.query(
      'SELECT id, team_id FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userId = userResult.rows[0].id;
    const teamId = userResult.rows[0].team_id;
    
    if (!teamId) {
      return res.status(400).json({ error: 'You are not in a team' });
    }
    
    // Check if user is the leader
    const teamResult = await client.query(
      'SELECT created_by FROM teams WHERE id = $1',
      [teamId]
    );
    
    const isLeader = teamResult.rows[0]?.created_by === userId;
    
    await client.query('BEGIN');
    
    // Remove user from team
    await client.query(
      'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, userId]
    );
    
    await client.query(
      'UPDATE users SET team_id = NULL WHERE id = $1',
      [userId]
    );
    
    // Check remaining members
    const remainingMembers = await client.query(
      'SELECT user_id FROM team_members WHERE team_id = $1 ORDER BY joined_at ASC',
      [teamId]
    );
    
    if (remainingMembers.rows.length === 0) {
      // No members left - delete the team
      await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
      console.log(`🗑️ Team ${teamId} deleted (no members remaining)`);
    } else if (isLeader && remainingMembers.rows.length > 0) {
      // Leader left - assign new leader (oldest member)
      const newLeaderId = remainingMembers.rows[0].user_id;
      await client.query(
        'UPDATE teams SET created_by = $1 WHERE id = $2',
        [newLeaderId, teamId]
      );
      console.log(`👑 New leader assigned to team ${teamId}: user ${newLeaderId}`);
    }
    
    await client.query('COMMIT');
    
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Leave team error:', err);
    res.status(500).json({ error: 'Failed to leave team' });
  } finally {
    client.release();
  }
});

// Team leaderboard (with caching headers)
app.get('/api/team/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        t.id, t.name, t.code,
        COALESCE(SUM(u.points), 0) as total_points,
        COUNT(tm.user_id) as member_count,
        COALESCE(MAX(CASE WHEN u.id = t.created_by THEN u.first_name END), 'Unknown') as leader_name
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id
      LEFT JOIN users u ON tm.user_id = u.id
      GROUP BY t.id
      ORDER BY total_points DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Team leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// Monthly competition standings
app.post('/api/team/monthly-competition', async (req, res) => {
  try {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    
    const result = await pool.query(`
      SELECT 
        t.id, t.name,
        COALESCE(SUM(u.points), 0) as team_points,
        COUNT(tm.user_id) as member_count,
        COALESCE(MAX(CASE WHEN u.id = t.created_by THEN u.first_name END), 'Unknown') as leader_name
      FROM teams t
      JOIN team_members tm ON t.id = tm.team_id
      JOIN users u ON tm.user_id = u.id
      GROUP BY t.id
      ORDER BY team_points DESC
      LIMIT 10
    `);
    
    res.json({
      month: currentMonth,
      standings: result.rows
    });
  } catch (err) {
    console.error('Monthly competition error:', err);
    res.status(500).json({ error: 'Failed to fetch monthly standings' });
  }
});

// Check if team name exists (for real-time validation)
app.post('/api/team/check-name', verifyTelegramData, async (req, res) => {
  try {
    const { teamName } = req.body;
    if (!teamName) {
      return res.json({ exists: false });
    }
    
    const result = await pool.query(
      'SELECT id FROM teams WHERE name = $1',
      [teamName.trim()]
    );
    
    res.json({ exists: result.rows.length > 0 });
  } catch (err) {
    console.error('Check team name error:', err);
    res.json({ exists: false });
  }
});

// Check if team code exists (for validation before joining)
app.post('/api/team/check-code', verifyTelegramData, async (req, res) => {
  try {
    const { teamCode } = req.body;
    if (!teamCode) {
      return res.json({ exists: false });
    }
    
    const result = await pool.query(
      'SELECT id, name FROM teams WHERE code = $1',
      [teamCode.trim().toUpperCase()]
    );
    
    res.json({ 
      exists: result.rows.length > 0,
      teamName: result.rows[0]?.name || null
    });
  } catch (err) {
    console.error('Check team code error:', err);
    res.json({ exists: false });
  }
});

// ============================================
// BONUS REDEMPTION API
// ============================================

app.post('/api/bonus-redeem', verifyTelegramData, async (req, res) => {
  const { bonusCode, points } = req.body;
  const telegramId = req.telegramUser.id;
  
  try {
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const userId = userResult.rows[0].id;
    await pool.query(
      'INSERT INTO bonus_redemptions (user_id, bonus_code, reward_points) VALUES ($1, $2, $3)',
      [userId, bonusCode, points]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Bonus redeem error:', err);
    res.status(500).json({ error: 'Failed to save bonus redemption' });
  }
});

app.post('/api/bonus-history', verifyTelegramData, async (req, res) => {
  const telegramId = req.telegramUser.id;
  
  try {
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.json([]);
    
    const userId = userResult.rows[0].id;
    const history = await pool.query(`
      SELECT bonus_code, reward_points, redeemed_at
      FROM bonus_redemptions WHERE user_id = $1
      ORDER BY redeemed_at DESC
    `, [userId]);
    res.json(history.rows);
  } catch (err) {
    console.error('Bonus history error:', err);
    res.json([]);
  }
});

// ============================================
// WITHDRAWAL API
// ============================================

app.post('/api/withdraw', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { amount, walletAddress } = req.body;
    const telegramId = req.telegramUser.id;
    
    const userResult = await client.query('SELECT id, points FROM users WHERE telegram_id = $1', [String(telegramId)]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const user = userResult.rows[0];
    const pointsNeeded = amount * POINTS_PER_COIN;
    
    if (amount < MIN_WITHDRAWAL_COINS) {
      return res.status(400).json({ error: `Minimum withdrawal is ${MIN_WITHDRAWAL_COINS} COINS` });
    }
    
    if (user.points < pointsNeeded) {
      return res.status(400).json({ error: `Insufficient points. You need ${MIN_WITHDRAWAL_COINS} COINS to withdraw.` });
    }
    
    await client.query('BEGIN');
    await client.query('UPDATE users SET points = points - $1 WHERE id = $2', [pointsNeeded, user.id]);
    await client.query(
      `INSERT INTO withdrawals (user_id, amount, wallet_address, status) VALUES ($1, $2, $3, 'pending')`,
      [user.id, amount, walletAddress]
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

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'OK', uptime: process.uptime(), timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'DB unavailable' });
  }
});

// ============================================
// WEBHOOK HEALTH CHECK (Required for Render)
// ============================================

app.get('/webhook', (req, res) => {
    res.status(200).send('Webhook is active');
});

app.post('/webhook', (req, res) => {
    res.status(200).send('OK');
});

// ============================================
// ADMIN DELETE USER - COMPLETE CLEANUP WITH TEAM HANDLING
// ============================================

app.post('/api/admin/delete-user', verifyAdmin, async (req, res) => {
  const { userId } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get user info before deletion (for team handling)
    const userResult = await client.query(
      'SELECT id, team_id, telegram_id, first_name FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    const teamId = user.team_id;
    let wasLeader = false;
    let teamDeleted = false;
    
    // If user was in a team, handle team cleanup
    if (teamId) {
      // Check if user is the team leader
      const teamResult = await client.query(
        'SELECT created_by FROM teams WHERE id = $1',
        [teamId]
      );
      
      if (teamResult.rows.length > 0) {
        wasLeader = teamResult.rows[0].created_by === userId;
        
        // Remove user from team_members
        await client.query(
          'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2',
          [teamId, userId]
        );
        
        // Check remaining members
        const remainingMembers = await client.query(
          'SELECT user_id FROM team_members WHERE team_id = $1 ORDER BY joined_at ASC',
          [teamId]
        );
        
        if (remainingMembers.rows.length === 0) {
          // No members left - delete the team
          await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
          teamDeleted = true;
          console.log(`🗑️ Team ${teamId} deleted (no members remaining after user deletion)`);
        } else if (wasLeader && remainingMembers.rows.length > 0) {
          // Leader was deleted - assign new leader (oldest member)
          const newLeaderId = remainingMembers.rows[0].user_id;
          await client.query(
            'UPDATE teams SET created_by = $1 WHERE id = $2',
            [newLeaderId, teamId]
          );
          console.log(`👑 New leader assigned to team ${teamId}: user ${newLeaderId} after leader deletion`);
        }
      }
    }
    
    // Delete all user-related data (complete cleanup)
    
    // 1. Delete from referrals (where user is referrer OR referred)
    await client.query(
      'DELETE FROM referrals WHERE referrer_id = $1 OR referred_id = $1',
      [userId]
    );
    
    // 2. Delete ad rewards
    await client.query('DELETE FROM ad_rewards WHERE user_id = $1', [userId]);
    
    // 3. Delete withdrawals
    await client.query('DELETE FROM withdrawals WHERE user_id = $1', [userId]);
    
    // 4. Delete daily rewards
    await client.query('DELETE FROM daily_rewards WHERE user_id = $1', [userId]);
    
    // 5. Delete wheel spins
    await client.query('DELETE FROM wheel_spins WHERE user_id = $1', [userId]);
    
    // 6. Delete user achievements
    await client.query('DELETE FROM user_achievements WHERE user_id = $1', [userId]);
    
    // 7. Delete tournament participants
    await client.query('DELETE FROM tournament_participants WHERE user_id = $1', [userId]);
    
    // 8. Delete team_members (already done above if in team, but safe to do again)
    await client.query('DELETE FROM team_members WHERE user_id = $1', [userId]);
    
    // 9. Delete ad statistics
    await client.query('DELETE FROM ad_statistics WHERE user_id = $1', [userId]);
    
    // 10. Delete bonus redemptions
    await client.query('DELETE FROM bonus_redemptions WHERE user_id = $1', [userId]);
    
    // 11. Finally, delete the user
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    
    await client.query('COMMIT');
    
    console.log(`✅ User ${userId} (${user.first_name || 'Unknown'}) completely deleted. Team cleanup: ${teamDeleted ? 'Team deleted' : (wasLeader ? 'New leader assigned' : 'Just removed from team')}`);
    
    res.json({ 
      success: true, 
      message: 'User completely deleted',
      teamHandled: teamId ? true : false,
      teamDeleted: teamDeleted
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user: ' + err.message });
  } finally {
    client.release();
  }
});

// ============================================
// ADMIN REMOVE MEMBER FROM TEAM
// ============================================

app.post('/api/team/remove-member', verifyAdmin, async (req, res) => {
  const { teamId, memberTelegramId } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get the user by telegram_id
    const userResult = await client.query(
      'SELECT id, team_id FROM users WHERE telegram_id = $1',
      [memberTelegramId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userId = userResult.rows[0].id;
    
    // Check if user is in this team
    if (userResult.rows[0].team_id !== teamId) {
      return res.status(400).json({ error: 'User is not in this team' });
    }
    
    // Check if user is the leader
    const teamResult = await client.query(
      'SELECT created_by FROM teams WHERE id = $1',
      [teamId]
    );
    
    const isLeader = teamResult.rows[0]?.created_by === userId;
    
    // Remove from team_members
    await client.query(
      'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, userId]
    );
    
    // Update user's team_id
    await client.query(
      'UPDATE users SET team_id = NULL WHERE id = $1',
      [userId]
    );
    
    // Check remaining members
    const remainingMembers = await client.query(
      'SELECT user_id FROM team_members WHERE team_id = $1',
      [teamId]
    );
    
    if (remainingMembers.rows.length === 0) {
      // No members left - delete the team
      await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
      console.log(`🗑️ Team ${teamId} deleted (no members remaining after admin removal)`);
    } else if (isLeader && remainingMembers.rows.length > 0) {
      // Leader removed - assign new leader (oldest member)
      const newLeaderId = remainingMembers.rows[0].user_id;
      await client.query(
        'UPDATE teams SET created_by = $1 WHERE id = $2',
        [newLeaderId, teamId]
      );
      console.log(`👑 New leader assigned to team ${teamId} after admin removal`);
    }
    
    await client.query('COMMIT');
    
    res.json({ success: true, message: 'Member removed from team' });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  } finally {
    client.release();
  }
});

// ============================================
// ADMIN TEAM MANAGEMENT ENDPOINTS
// ============================================   
// Admin delete entire team
app.post('/api/admin/delete-team', verifyAdmin, async (req, res) => {
  const { teamId } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get all members of the team
    const members = await client.query(
      'SELECT user_id FROM team_members WHERE team_id = $1',
      [teamId]
    );
    
    // Remove team_id from all members
    for (const member of members.rows) {
      await client.query(
        'UPDATE users SET team_id = NULL WHERE id = $1',
        [member.user_id]
      );
    }
    
    // Delete team members
    await client.query('DELETE FROM team_members WHERE team_id = $1', [teamId]);
    
    // Delete the team
    await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
    
    await client.query('COMMIT');
    
    console.log(`🗑️ Team ${teamId} deleted by admin. ${members.rows.length} members affected.`);
    
    res.json({ success: true, message: 'Team deleted', membersAffected: members.rows.length });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete team error:', err);
    res.status(500).json({ error: 'Failed to delete team' });
  } finally {
    client.release();
  }
});

// ============================================
// ADMIN API ENDPOINTS
// ============================================

// Get all users (for admin panel)
app.get('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, telegram_id, first_name, last_name, username, photo_url, 
             referral_code, points, tier, referrals, wallet_address, created_at, team_id
      FROM users 
      ORDER BY id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get all withdrawals (for admin panel)
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

// Update withdrawal status
app.post('/api/admin/update-withdrawal', verifyAdmin, async (req, res) => {
  const { withdrawalId, status } = req.body;
  try {
    const withdrawalResult = await pool.query('SELECT user_id, amount FROM withdrawals WHERE id = $1', [withdrawalId]);
    if (withdrawalResult.rows.length === 0) return res.status(404).json({ error: 'Withdrawal not found' });
    
    const withdrawal = withdrawalResult.rows[0];
    if (status === 'rejected' || status === 'failed') {
      const pointsToRefund = withdrawal.amount * POINTS_PER_COIN;
      await pool.query('UPDATE users SET points = points + $1 WHERE id = $2', [pointsToRefund, withdrawal.user_id]);
    }
    
    await pool.query("UPDATE withdrawals SET status = $1, updated_at = NOW() WHERE id = $2", [status, withdrawalId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Update withdrawal error:', err);
    res.status(500).json({ error: 'Failed to update withdrawal' });
  }
});

// Add points to user
app.post('/api/admin/add-points', verifyAdmin, async (req, res) => {
  const { userId, points } = req.body;
  try {
    await pool.query('UPDATE users SET points = points + $1, total_points_earned = total_points_earned + $1 WHERE id = $2', [points, userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Add points error:', err);
    res.status(500).json({ error: 'Failed to add points' });
  }
});

// Deduct points from user
app.post('/api/admin/deduct-points', verifyAdmin, async (req, res) => {
  const { userId, points } = req.body;
  try {
    const result = await pool.query('UPDATE users SET points = points - $1 WHERE id = $2 AND points >= $1 RETURNING points', [points, userId]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Insufficient points' });
    res.json({ success: true });
  } catch (err) {
    console.error('Deduct points error:', err);
    res.status(500).json({ error: 'Failed to deduct points' });
  }
});

// Get analytics data
app.get('/api/admin/analytics', verifyAdmin, async (req, res) => {
  try {
    const totalUsers = await pool.query('SELECT COUNT(*) FROM users');
    const today = new Date().toISOString().split('T')[0];
    const activeToday = await pool.query('SELECT COUNT(*) FROM users WHERE last_login_date = $1', [today]);
    const activeWeek = await pool.query("SELECT COUNT(*) FROM users WHERE last_login_date >= CURRENT_DATE - INTERVAL '7 days'");
    const totalAds = await pool.query('SELECT COUNT(*) FROM ad_rewards');
    const adsToday = await pool.query("SELECT COUNT(*) FROM ad_rewards WHERE created_at::date = CURRENT_DATE");
    const totalPoints = await pool.query('SELECT COALESCE(SUM(points), 0) as total FROM users');
    const totalReferrals = await pool.query('SELECT COUNT(*) FROM referrals');
    const pendingWithdrawals = await pool.query("SELECT COUNT(*) FROM withdrawals WHERE status = 'pending'");
    const tierDistribution = await pool.query('SELECT tier, COUNT(*) as count FROM users GROUP BY tier ORDER BY tier');
    const dailyActive = await pool.query(`
      SELECT last_login_date, COUNT(*) as count
      FROM users WHERE last_login_date >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY last_login_date ORDER BY last_login_date DESC
    `);
    
    res.json({
      totalUsers: parseInt(totalUsers.rows[0].count),
      activeToday: parseInt(activeToday.rows[0].count),
      activeWeek: parseInt(activeWeek.rows[0].count),
      totalAds: parseInt(totalAds.rows[0].count),
      adsToday: parseInt(adsToday.rows[0].count),
      totalCoins: Math.floor(parseInt(totalPoints.rows[0].total) / POINTS_PER_COIN),
      totalReferrals: parseInt(totalReferrals.rows[0].count),
      pendingWithdrawals: parseInt(pendingWithdrawals.rows[0].count),
      tierDistribution: tierDistribution.rows,
      dailyActive: dailyActive.rows
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// ============================================
// TELEGRAM BOT - POLLING MODE WITH REFERRAL HANDLING
// ============================================

if (process.env.BOT_TOKEN) {
    const bot = new Telegraf(process.env.BOT_TOKEN);
    const MINI_APP_URL = process.env.MINI_APP_URL || 'https://yzemanbot-backend.onrender.com';
    const CHANNEL_URL = 'https://t.me/YzemanEarnBotChannel';
    
    // Main menu keyboard
    const mainMenuKeyboard = {
        reply_markup: {
            keyboard: [
                [{ text: "🚀 LAUNCH APP" }, { text: "💰 MY EARNINGS" }],
                [{ text: "👥 MY REFERRAL" }, { text: "📢 CHANNEL" }],
                [{ text: "❓ HELP" }, { text: "ℹ️ ABOUT" }]
            ],
            resize_keyboard: true,
            persistent: true
        }
    };
    
    // Helper to get user data
    async function getUserData(telegramId) {
        try {
            const result = await pool.query(
                'SELECT points, referrals, tier, referral_code FROM users WHERE telegram_id = $1',
                [telegramId]
            );
            return result.rows[0] || null;
        } catch (err) {
            console.error('Get user error:', err.message);
            return null;
        }
    }
    
    // --- FIXED START COMMAND ---
    bot.start(async (ctx) => {
        const firstName = ctx.from.first_name;
        const startPayload = ctx.startPayload || ''; // THIS captures the referral code from the link!
        let miniAppUrl = MINI_APP_URL;
        
        // Pass the referral code to the mini app
        if (startPayload) {
            miniAppUrl += `?start=${startPayload}`;
        }
        
        console.log(`📨 /start from ${firstName}, payload: ${startPayload || 'none'}`);
        
        await ctx.reply(
            `🎉 *Welcome to YzemanBot, ${firstName}!*\n\n` +
            `👇 *Tap below to start earning!*`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 LAUNCH APP', web_app: { url: miniAppUrl } }]
                    ]
                }
            }
        );
    });
    // --- END OF FIXED START COMMAND ---
    
    bot.help(async (ctx) => {
        await ctx.reply(
            `📚 *Help Center*\n\n` +
            `*How to earn:*\n` +
            `🎬 Watch Ads - Earn COINS\n` +
            `👥 Refer Friends - Get bonuses\n` +
            `📅 Daily Rewards - Streak bonuses\n` +
            `🎡 Wheel Spins - Every 3 days\n\n` +
            `*Withdrawal:* 100,000 COINS min\n` +
            `*Support:* @yzemanreal`,
            {
                parse_mode: 'Markdown',
                ...mainMenuKeyboard
            }
        );
    });
    
    bot.hears('💰 MY EARNINGS', async (ctx) => {
        const telegramId = ctx.from.id;
        const userData = await getUserData(telegramId);
        
        if (!userData) {
            await ctx.reply(
                `⚠️ *No account yet!*\n\nTap LAUNCH APP to create one.`,
                { parse_mode: 'Markdown', ...mainMenuKeyboard }
            );
            return;
        }
        
        const coins = (userData.points || 0) / 1000000;
        await ctx.reply(
            `💎 *Your Earnings*\n\n` +
            `💰 *Balance:* ${coins.toFixed(2)} COINS\n` +
            `👑 *Tier:* ${userData.tier || 'Fresher'}\n` +
            `👥 *Referrals:* ${userData.referrals || 0}\n\n` +
            `🎁 *Withdrawal Min:* 100,000 COINS`,
            { parse_mode: 'Markdown', ...mainMenuKeyboard }
        );
    });
    
    // --- FIXED MY REFERRAL BUTTON ---
    bot.hears('👥 MY REFERRAL', async (ctx) => {
        const telegramId = ctx.from.id;
        const userData = await getUserData(telegramId);
        
        if (!userData || !userData.referral_code) {
            await ctx.reply(
                `⚠️ *Create account first!*\n\nTap LAUNCH APP to start.`,
                { parse_mode: 'Markdown', ...mainMenuKeyboard }
            );
            return;
        }
        
        const botUsername = ctx.bot.botInfo?.username || 'YzemanBot';
        // The referral code is the user's unique code (e.g., "ref-ABCD1234")
        const referralLink = `https://t.me/${botUsername}?start=${userData.referral_code}`;
        
        await ctx.reply(
            `👥 *Your Referral Link*\n\n` +
            `🔗 \`${referralLink}\`\n\n` +
            `📊 *Total Referrals:* ${userData.referrals || 0}\n` +
            `💰 *You earn:* 0.5 COINS per referral\n\n` +
            `💡 *Share the link with friends!*`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📤 COPY LINK', callback_data: 'copy_link' }]
                    ]
                }
            }
        );
    });
    // --- END OF FIXED MY REFERRAL BUTTON ---
    
    // Copy link callback
    bot.action('copy_link', async (ctx) => {
        const telegramId = ctx.from.id;
        const userData = await getUserData(telegramId);
        if (userData && userData.referral_code) {
            const botUsername = ctx.bot.botInfo?.username || 'YzemanBot';
            const referralLink = `https://t.me/${botUsername}?start=${userData.referral_code}`;
            await ctx.answerCbQuery();
            await ctx.reply(`🔗 \`${referralLink}\``, { parse_mode: 'Markdown' });
        } else {
            await ctx.answerCbQuery('Error getting link');
        }
    });
    
    bot.hears('📢 CHANNEL', async (ctx) => {
        await ctx.reply(
            `📢 *Join Our Channel*\n\n` +
            `Get updates, bonus codes, and announcements!`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📢 JOIN CHANNEL', url: CHANNEL_URL }]
                    ]
                }
            }
        );
    });
    
    bot.hears('ℹ️ ABOUT', async (ctx) => {
        await ctx.reply(
            `ℹ️ *YzemanBot v2.0*\n\n` +
            `Earn real COINS through:\n` +
            `✅ Watch Ads\n✅ Refer Friends\n✅ Daily Rewards\n✅ Wheel Spins\n\n` +
            `💎 1 COIN = 1,000,000 points\n` +
            `💰 Withdraw to USDT (100K COINS min)`,
            { parse_mode: 'Markdown', ...mainMenuKeyboard }
        );
    });
    
    bot.hears('🚀 LAUNCH APP', async (ctx) => {
        let miniAppUrl = MINI_APP_URL;
        await ctx.reply(
            `🚀 *Launching YzemanBot...*`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 OPEN APP', web_app: { url: miniAppUrl } }]
                    ]
                }
            }
        );
    });
    
    bot.on('text', async (ctx) => {
        const text = ctx.message.text;
        const valid = ['🚀 LAUNCH APP', '💰 MY EARNINGS', '👥 MY REFERRAL', '📢 CHANNEL', '❓ HELP', 'ℹ️ ABOUT'];
        
        if (!valid.includes(text) && !text.startsWith('/')) {
            await ctx.reply(
                `❓ Use the buttons below:`,
                { ...mainMenuKeyboard }
            );
        }
    });
    
    // Launch bot in polling mode (NO WEBHOOK NEEDED!)
    bot.launch()
        .then(() => {
            console.log('🤖 Telegram Bot started in POLLING mode');
            console.log(`✅ Bot @${bot.botInfo?.username} is ready!`);
        })
        .catch((err) => {
            console.error('❌ Bot failed:', err.message);
        });
    
    // Graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

// ============================================
// START SERVER
// ============================================

async function startServer() {
  try {
    await initDB();
    console.log('✅ Database initialized and ready');
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`========================================`);
      console.log(`🚀 SERVER IS RUNNING!`);
      console.log(`📡 Port: ${PORT}`);
      console.log(`🌐 URL: ${process.env.MINI_APP_URL || 'https://yzemanbot-backend.onrender.com'}`);
      console.log(`❤️  Health: ${process.env.MINI_APP_URL || 'https://yzemanbot-backend.onrender.com'}/health`);
      console.log(`💰 1 COIN = ${POINTS_PER_COIN.toLocaleString()} points`);
      console.log(`💵 Min Withdrawal: ${MIN_WITHDRAWAL_COINS.toLocaleString()} COINS`);
      console.log(`========================================`);
    });
    
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
