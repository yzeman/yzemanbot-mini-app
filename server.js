// YZEMANBOT - BACKEND SERVER (COMPLETE - FIXED)
// COIN ECONOMY: 1 COIN = 1 UNIT (NO POINTS)
// WITHDRAWAL: 100,000 COINS minimum
// WITH 2% LIFETIME COMMISSION
// WITH WEBSOCKET FOR TEAM CHAT
// ============================================================

const { Pool } = require('pg');
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { Telegraf } = require('telegraf');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

const MIN_WITHDRAWAL_COINS = 1000000;  // 1,000,000 COINS to withdraw
const INVITEE_BONUS_COINS = 2000;
const COMMISSION_RATE = 0.02;

const REFERRAL_REWARDS_COINS = {
    'Fresher': 50,
    'Brute': 100,
    'Silver': 150,
    'Gold': 250,
    'Platinum': 500
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => console.error('Unexpected error on idle client', err));

app.use(bodyParser.json({ limit: '10kb' }));
// Shared admin authentication for both admin pages and every /api/admin endpoint.
const ADMIN_COOKIE='yz_admin_session', ADMIN_SESSION_TTL=8*60*60*1000;
const adminSessions=new Map(), adminLoginAttempts=new Map();
function readCookie(req,name){const item=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='));return item?decodeURIComponent(item.slice(name.length+1)):null;}
function adminSessionKey(token){return crypto.createHmac('sha256',process.env.ADMIN_SESSION_SECRET).update(token).digest('hex');}
function hasAdminSession(req){const token=readCookie(req,ADMIN_COOKIE);if(!token||!process.env.ADMIN_SESSION_SECRET)return false;const key=adminSessionKey(token),expires=adminSessions.get(key);if(!expires||expires<=Date.now()){adminSessions.delete(key);return false;}return true;}
function setAdminCookie(res,token){const secure=process.env.NODE_ENV==='production'?'; Secure':'';res.setHeader('Set-Cookie',`${ADMIN_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=28800${secure}`);}
function clearAdminCookie(res){const secure=process.env.NODE_ENV==='production'?'; Secure':'';res.setHeader('Set-Cookie',`${ADMIN_COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure}`);}
function verifyAdmin(req,res,next){if(!hasAdminSession(req))return res.status(401).json({error:'Admin login required'});next();}
app.post('/api/admin/auth/login',(req,res)=>{const ip=req.ip||req.socket.remoteAddress||'unknown',now=Date.now();const a=adminLoginAttempts.get(ip)||{count:0,resetAt:now+900000};if(a.resetAt<=now){a.count=0;a.resetAt=now+900000;}if(a.count>=5)return res.status(429).json({error:'Too many attempts. Try again in 15 minutes.'});const expected=Buffer.from(process.env.ADMIN_PASSWORD||''),given=Buffer.from(typeof req.body?.password==='string'?req.body.password:'');const ok=Boolean(expected.length&&process.env.ADMIN_SESSION_SECRET&&expected.length===given.length&&crypto.timingSafeEqual(expected,given));if(!ok){a.count++;adminLoginAttempts.set(ip,a);return res.status(401).json({error:'Incorrect password or admin login is not configured.'});}adminLoginAttempts.delete(ip);const token=crypto.randomBytes(32).toString('hex');adminSessions.set(adminSessionKey(token),now+ADMIN_SESSION_TTL);setAdminCookie(res,token);res.json({success:true,next:req.body?.next==='/analytics.html'?'/analytics.html':'/yzeadmin.html'});});
app.get('/api/admin/auth/status',(req,res)=>res.json({authenticated:hasAdminSession(req)}));
app.post('/api/admin/auth/logout',(req,res)=>{const token=readCookie(req,ADMIN_COOKIE);if(token&&process.env.ADMIN_SESSION_SECRET)adminSessions.delete(adminSessionKey(token));clearAdminCookie(res);res.json({success:true});});
app.use((req,res,next)=>{if(req.path!=='/yzeadmin.html'&&req.path!=='/analytics.html')return next();if(hasAdminSession(req))return next();const target=req.path==='/analytics.html'?'/analytics.html':'/yzeadmin.html';return res.redirect(302,'/admin-login.html?next='+encodeURIComponent(target));});

// Prevent Telegram's embedded browser from reusing stale tournament chat HTML.
app.use('/tournament-chat.html', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

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
    // Add these lines inside your initDB() function, after the other ALTER TABLE statements
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_friends INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_blocks_received INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trust_score INTEGER DEFAULT 50`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP`);

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
        coins_at_join DECIMAL(20,3) DEFAULT 0,
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
      CREATE TABLE IF NOT EXISTS user_monthly_earnings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        month_year DATE NOT NULL,
        coins_earned DECIMAL(20,3) DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, month_year)
      )
    `);

      // Add these tables inside your initDB() function, after the other tables
await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ip_address TEXT`);
      
// Private messages table
await client.query(`
  CREATE TABLE IF NOT EXISTS private_messages (
    id SERIAL PRIMARY KEY,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    is_edited BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )
`);

// Create indexes
await client.query(`CREATE INDEX IF NOT EXISTS idx_private_messages_sender_id ON private_messages(sender_id)`);
await client.query(`CREATE INDEX IF NOT EXISTS idx_private_messages_receiver_id ON private_messages(receiver_id)`);
await client.query(`CREATE INDEX IF NOT EXISTS idx_private_messages_created_at ON private_messages(created_at DESC)`);
await client.query(`ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`);
await client.query(`ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP`);

    // ============================================
    // TEAM CHAT TABLES - ADD INSIDE initDB()
    // ============================================
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS team_messages (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        message TEXT NOT NULL,
        is_edited BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_team_messages_team_id ON team_messages(team_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_team_messages_created_at ON team_messages(created_at DESC)`);
    await client.query(`ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`
      DO $softdelete$
      BEGIN
        IF to_regclass('public.tournament_messages') IS NOT NULL THEN
          ALTER TABLE public.tournament_messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
        END IF;
      END $softdelete$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS team_message_reads (
        id SERIAL PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES team_messages(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        read_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(message_id, user_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS team_typing_status (
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        is_typing BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (team_id, user_id)
      )
    `);

    // ============================================
    // ACHIEVEMENTS INSERT
    // ============================================
    await client.query(`
      INSERT INTO achievements (name, description, badge_icon, required_value, coins_reward) VALUES
        ('Loyal User', '30 day login streak', '🔥', 30, 5000),
        ('Referral Master', 'Get 100 referrals', '👑', 100, 20000),
        ('Points Millionaire', 'Earn 1,000,000 COINS', '💰', 1000000, 15000),
        ('Social Butterfly', 'Complete all social tasks', '🦋', 5, 100000),
        ('Tournament Winner', 'Win a weekly tournament', '🏆', 1, 10000),
        ('Team Player', 'Join a team', '🤝', 1, 2000),
        ('Platinum Elite', 'Reach Platinum tier', '💎', 1500, 50000),
        ('Wheel Champion', 'Win 20 COINS on wheel', '🎡', 20, 10000),
        ('Daily Streak 7', '7 day login streak', '📅', 7, 5000),
        ('Super Referrer', 'Get 500 referrals', '⭐', 500, 50000),
        ('Ad Master', 'Watch 5000 ads', '📺', 5000, 30000),
        ('Team Winner', 'Your team wins monthly competition', '🏅', 1, 25000),
        ('Leaderboard Winner', 'Finish Top 3 on monthly leaderboard', '👑', 3, 15000),
        ('Ad Master Platinum', 'Watch 10000 ads', '💎', 10000, 100000),
        ('Referral King', 'Get 1000 referrals', '👑', 1000, 200000),
        ('Monthly Top Earner', 'Finish #1 on monthly leaderboard', '⭐', 1, 25000)
      ON CONFLICT (name) DO UPDATE SET
        description = EXCLUDED.description,
        coins_reward = EXCLUDED.coins_reward,
        required_value = EXCLUDED.required_value
    `);
    
    console.log('✅ Database initialized successfully');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database initialization failed:', err.stack);
    throw err;
  } finally {
    client.release();
  }
}

// ============================================
// AUTOMATED CLEANUP SCHEDULER
// ============================================
async function runCleanupJob() {
    const client = await pool.connect();
    try {
        console.log('🧹 Running scheduled cleanup...');
        
        // Delete team messages older than 30 days
        const msgResult = await client.query(
            'DELETE FROM team_messages WHERE created_at < NOW() - INTERVAL \'30 days\''
        );
        console.log(`🗑️ Deleted ${msgResult.rowCount} old team messages`);
        
        // Delete ad_rewards older than 90 days
        const adResult = await client.query(
            'DELETE FROM ad_rewards WHERE created_at < NOW() - INTERVAL \'90 days\''
        );
        console.log(`🗑️ Deleted ${adResult.rowCount} old ad rewards`);
        
        // Delete referral commissions older than 90 days
        const refResult = await client.query(
            'DELETE FROM referral_commissions WHERE created_at < NOW() - INTERVAL \'90 days\''
        );
        console.log(`🗑️ Deleted ${refResult.rowCount} old referral commissions`);
        
        // Delete private messages older than 60 days
        const pmResult = await client.query(
            'DELETE FROM private_messages WHERE created_at < NOW() - INTERVAL \'60 days\''
        );
        console.log(`🗑️ Deleted ${pmResult.rowCount} old private messages`);
        
        // Delete old typing status
        const typeResult = await client.query(
            'DELETE FROM team_typing_status WHERE updated_at < NOW() - INTERVAL \'1 day\''
        );
        console.log(`🗑️ Deleted ${typeResult.rowCount} old typing statuses`);
        
        // ============================================
        // ✅ SOFT DELETE: Users inactive for 4-12 months
        // ============================================
        const softDeleteUsers = await client.query(`
            SELECT id, telegram_id, first_name 
            FROM users 
            WHERE last_seen IS NOT NULL 
            AND last_seen < NOW() - INTERVAL '4 months'
            AND last_seen >= NOW() - INTERVAL '1 year'
            AND coins > 0
        `);

        if (softDeleteUsers.rows.length > 0) {
            for (const user of softDeleteUsers.rows) {
                // Delete personal history data
                await client.query('DELETE FROM ad_rewards WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM daily_rewards WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM wheel_spins WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM user_achievements WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM social_tasks WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM user_monthly_earnings WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM tournament_participants WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM ad_statistics WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM team_members WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM private_messages WHERE sender_id = $1 OR receiver_id = $1', [user.id]);
                
                // ✅ KEEP user account but reset coins
                await client.query(`
                    UPDATE users SET 
                        coins = 0, 
                        total_coins_earned = 0, 
                        last_seen = NULL,
                        wallet_address = NULL
                    WHERE id = $1
                `, [user.id]);
            }
            console.log(`🧹 Soft deleted ${softDeleteUsers.rows.length} users (4+ months inactive)`);
        }

        // ============================================
        // ✅ FULL DELETE: Users inactive for 1+ year
        // ============================================
        const fullDeleteUsers = await client.query(`
            SELECT id, telegram_id, first_name 
            FROM users 
            WHERE last_seen IS NOT NULL 
            AND last_seen < NOW() - INTERVAL '1 year'
        `);

        if (fullDeleteUsers.rows.length > 0) {
            for (const user of fullDeleteUsers.rows) {
                // ✅ Decrease referral count for whoever referred this user
                await client.query(`
                    UPDATE users SET referrals = GREATEST(referrals - 1, 0)
                    WHERE id IN (SELECT referrer_id FROM referrals WHERE referred_id = $1)
                `, [user.id]);
                
                // Delete all related records
                await client.query('DELETE FROM referral_commissions WHERE referrer_id = $1 OR referred_id = $1', [user.id]);
                await client.query('DELETE FROM referrals WHERE referrer_id = $1 OR referred_id = $1', [user.id]);
                await client.query('DELETE FROM ad_rewards WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM daily_rewards WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM wheel_spins WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM user_achievements WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM social_tasks WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM user_monthly_earnings WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM tournament_participants WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM ad_statistics WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM team_members WHERE user_id = $1', [user.id]);
                await client.query('DELETE FROM private_messages WHERE sender_id = $1 OR receiver_id = $1', [user.id]);
                await client.query('DELETE FROM users WHERE id = $1', [user.id]);
            }
            
            // ✅ Recalculate all referral counts to ensure accuracy
            await client.query(`
                UPDATE users u SET referrals = COALESCE((
                    SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = u.id
                ), 0)
            `);
            
            console.log(`🗑️ Fully deleted ${fullDeleteUsers.rows.length} users (1+ year inactive)`);
        }

        if (softDeleteUsers.rows.length === 0 && fullDeleteUsers.rows.length === 0) {
            console.log('✅ No inactive users to clean up');
        }
        
        // Reclaim space
        await client.query('VACUUM');
        console.log('✅ Cleanup completed successfully');
    } catch (err) {
        console.error('❌ Cleanup error:', err);
    } finally {
        client.release();
    }
}

// Run cleanup every 24 hours (86400000 ms)
setInterval(runCleanupJob, 86400000);

// Also run once on startup
setTimeout(runCleanupJob, 60000); // Wait 1 minute after server starts

// ============================================
// TOURNAMENT CHAT CLEANUP - Delete messages older than 24 hours
// ============================================
async function cleanupTournamentChat() {
    try {
        const result = await pool.query(
            "DELETE FROM tournament_messages WHERE created_at < NOW() - INTERVAL '24 hours'"
        );
        if (result.rowCount > 0) {
            console.log(`🗑️ Deleted ${result.rowCount} old tournament messages`);
        }
    } catch (err) {
        console.error('Tournament chat cleanup error:', err);
    }
}

// Run every hour (3600000 ms)
setInterval(cleanupTournamentChat, 3600000);

// Also run once on startup
setTimeout(cleanupTournamentChat, 30000);

// ============================================
// HELPER: Track Monthly Earnings
// ============================================
async function trackMonthlyEarnings(client, userId, coinsEarned) {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  
  await client.query(`
    INSERT INTO user_monthly_earnings (user_id, month_year, coins_earned)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, month_year) 
    DO UPDATE SET coins_earned = user_monthly_earnings.coins_earned + $3, updated_at = NOW()
  `, [userId, firstOfMonth, coinsEarned]);
}

// ============================================
// HELPER: Award 2% Commission to Referrer (WITH TRACKING)
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
        
        // ✅ TRACK COMMISSION - Leaderboard Only (NOT Tournament)
        await client.query(
            'INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)',
            [referrerId, commission, 'referral_commission']
        );
        
        // Track monthly earnings for commission
        await trackMonthlyEarnings(client, referrerId, commission);
        
        console.log(`💰 Commission: User ${referredUserId} earned ${coinsEarned} COINS → referrer ${referrerId} gets ${commission} COINS`);
    } catch (err) {
        console.error('Commission error:', err);
    }
}

// ============================================
// HELPER: Send Prize Notification to User via Telegram Bot
// ============================================
async function sendPrizeNotification(telegramId, prizeType, prizeAmount, rank, extraInfo = '') {
    if (!telegramId || !process.env.BOT_TOKEN) return;
    
    let title, message, icon;
    
    switch(prizeType) {
        case 'tournament':
            icon = '🏆';
            title = 'Weekly Tournament Winner!';
            message = `You placed *#${rank}* in the weekly tournament!\n\n🏆 You've been awarded *+${prizeAmount} COINS*!${extraInfo}`;
            break;
        case 'leaderboard':
            icon = '👑';
            title = 'Monthly Leaderboard Winner!';
            message = `You finished *#${rank}* on the monthly leaderboard!\n\n👑 You've been awarded *+${prizeAmount} COINS*!${extraInfo}`;
            break;
        case 'referral':
            icon = '⭐';
            title = 'Weekly Referral Champion!';
            message = `You were the #${rank} top referrer this week!\n\n⭐ You've been awarded *+${prizeAmount} COINS*!${extraInfo}`;
            break;
        default:
            icon = '🎉';
            title = 'Prize Awarded!';
            message = `You've been awarded *+${prizeAmount} COINS*!${extraInfo}`;
    }
    
    const fullMessage = `${icon} *${title}* ${icon}\n\n${message}\n\nKeep up the great work! 🚀`;
    
    try {
        await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: telegramId,
                text: fullMessage,
                parse_mode: 'Markdown'
            })
        });
        console.log(`📨 Prize notification sent to ${telegramId} for ${prizeType} (${prizeAmount} COINS)`);
    } catch (err) {
        console.error(`Failed to send notification to ${telegramId}:`, err.message);
    }
}

// ============================================
// HELPER: Award Achievement (UPDATED FOR COINS WITH TRACKING + COMPLETIONIST)
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
            
            // ✅ TRACK ACHIEVEMENT REWARD IN AD_REWARDS FOR TOURNAMENT/LEADERBOARD
            await client.query(
                'INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)',
                [userId, coinsReward, 'achievement']
            );
            
            // Track monthly earnings
            await trackMonthlyEarnings(client, userId, coinsReward);
            
            console.log(`🎉 Achievement "${achievementName}" awarded to user ${userId} +${coinsReward} COINS`);
        }
        
        // ✅ CHECK FOR COMPLETIONIST (unlocked all achievements)
        if (achievementName !== 'Completionist') {
            const totalAchievements = await client.query(
                'SELECT COUNT(*) as total FROM achievements WHERE name != $1',
                ['Completionist']
            );
            const unlockedCount = await client.query(
                'SELECT COUNT(*) as total FROM user_achievements WHERE user_id = $1',
                [userId]
            );
            
            const total = parseInt(totalAchievements.rows[0].total);
            const unlocked = parseInt(unlockedCount.rows[0].total);
            
            if (unlocked >= total) {
                // Award Completionist (call recursively, but this time it will skip the check)
                await awardAchievementInternal(userId, 'Completionist', client);
                console.log(`🌟 COMPLETIONIST awarded to user ${userId}! All ${total} achievements unlocked!`);
            }
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

// Internal helper to avoid infinite loop with Completionist check
async function awardAchievementInternal(userId, achievementName, client) {
    const achievement = await client.query(
        'SELECT id, coins_reward FROM achievements WHERE name = $1',
        [achievementName]
    );
    
    if (achievement.rows.length === 0) return false;
    
    const achievementId = achievement.rows[0].id;
    const coinsReward = achievement.rows[0].coins_reward;
    
    const existing = await client.query(
        'SELECT * FROM user_achievements WHERE user_id = $1 AND achievement_id = $2',
        [userId, achievementId]
    );
    
    if (existing.rows.length > 0) return false;
    
    await client.query(
        'INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2)',
        [userId, achievementId]
    );
    
    if (coinsReward > 0) {
        await client.query(
            'UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
            [coinsReward, userId]
        );
        await client.query(
            'INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)',
            [userId, coinsReward, 'achievement']
        );
        await trackMonthlyEarnings(client, userId, coinsReward);
    }
    
    return true;
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

// verifyAdmin uses the shared cookie session defined above.


// ============================================
// WEBSOCKET SERVER FOR TEAM CHAT & PRIVATE CHAT
// ============================================

// Store connected users { socketId: { userId, teamId, firstName } }
const connectedUsers = new Map();
const userSockets = new Map(); // userId -> socketId (for push notifications)
const presenceSockets = new Map(); // socketId -> verified { userId, firstName }

io.use(async (socket, next) => {
    const initData = socket.handshake.auth.initData;
    if (!initData) {
        return next(new Error('Authentication required'));
    }
    
    try {
        const initDataParsed = new URLSearchParams(initData);
        const hash = initDataParsed.get('hash');
        const authDate = initDataParsed.get('auth_date');
        
        if (Date.now() / 1000 - parseInt(authDate) > 86400) {
            return next(new Error('Expired authentication'));
        }
        
        initDataParsed.delete('hash');
        const dataCheckString = Array.from(initDataParsed.entries())
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
            return next(new Error('Invalid hash'));
        }
        
        const user = JSON.parse(initDataParsed.get('user'));
        socket.user = user;
        next();
    } catch (err) {
        console.error('Socket auth error:', err);
        next(new Error('Authentication failed'));
    }
});

async function getSocketTeamMembership(socket, requestedTeamId) {
    if (!socket.user?.id || !requestedTeamId) return null;
    const result = await pool.query(`
        SELECT u.id, u.first_name FROM users u
        JOIN team_members tm ON tm.user_id = u.id
        WHERE u.telegram_id = $1 AND tm.team_id = $2 AND u.team_id = $2
        LIMIT 1
    `, [socket.user.id, requestedTeamId]);
    if (!result.rows.length) return null;
    socket.dbUserId = result.rows[0].id;
    return result.rows[0];
}

io.on('connection', (socket) => {
    console.log('🟢 User connected:', socket.id);
    
    // Track each authenticated Telegram socket as online across the whole app.
    // Run asynchronously so chat event handlers are registered immediately.
    (async () => {
        try {
            const result = await pool.query(
                'SELECT id, first_name FROM users WHERE telegram_id = $1',
                [socket.user.id]
            );
            if (!io.sockets.sockets.has(socket.id) || !result.rows.length) return;

            const member = result.rows[0];
            const alreadyOnline = Array.from(presenceSockets.values())
                .some(item => String(item.userId) === String(member.id));
            const presence = { userId: member.id, firstName: member.first_name || 'User' };
            socket.dbUserId = member.id;
            presenceSockets.set(socket.id, presence);
            socket.join(`user_${member.id}`);
            userSockets.set(member.id, socket.id);

            const friends = await pool.query(
                `SELECT CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END AS friend_id
                 FROM friends f
                 WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'`,
                [member.id]
            );
            if (!presenceSockets.has(socket.id)) return;

            // Tell this newly connected user which accepted friends are already online.
            // This makes presence symmetric even when a friend connected earlier.
            const onlineFriends = new Map();
            for (const friend of friends.rows) {
                const onlinePresence = Array.from(presenceSockets.values())
                    .find(item => String(item.userId) === String(friend.friend_id));
                if (onlinePresence) {
                    onlineFriends.set(String(friend.friend_id), onlinePresence);
                }
            }
            onlineFriends.forEach((onlinePresence, friendId) => {
                socket.emit('friend-online', {
                    userId: friendId,
                    firstName: onlinePresence.firstName
                });
            });

            // Notify existing friends only when this user transitions from offline to online.
            if (!alreadyOnline) {
                friends.rows.forEach(friend => {
                    io.to(`user_${friend.friend_id}`).emit('friend-online', {
                        userId: member.id,
                        firstName: presence.firstName
                    });
                });
            }
        } catch (err) {
            console.error('Online presence registration error:', err);
        }
    })();
    
// ============================================
// JOIN STATUS ROOM (for online status)
// ============================================
socket.on('join-status', () => {
    // User identity is resolved from the authenticated Telegram session.
    if (socket.dbUserId) {
        socket.join(`user_${socket.dbUserId}`);
        socket.userId = socket.dbUserId;
        userSockets.set(socket.dbUserId, socket.id);
    }
});
    
    // ============================================
    // TEAM STATUS (for unread message badges)
    // ============================================
    
    socket.on('join-team-status', async (data) => {
        const { teamId } = data || {};
        try {
            const member = await getSocketTeamMembership(socket, teamId);
            if (!member) return;
            socket.join(`team_status_${teamId}`);
            const result = await pool.query(`
                SELECT COUNT(*) as count
                FROM team_messages tm
                WHERE tm.team_id = $1
                  AND tm.user_id <> $2 AND tm.is_deleted = FALSE
                  AND NOT EXISTS (
                    SELECT 1 FROM team_message_reads tmr
                    WHERE tmr.message_id = tm.id AND tmr.user_id = $2
                  )
            `, [teamId, member.id]);
            socket.emit('team-unread-update', { count: parseInt(result.rows[0].count, 10) });
        } catch (err) {
            console.error('Team unread count error:', err);
            socket.emit('team-unread-update', { count: 0 });
        }
    });
    
    // ============================================
    // TEAM CHAT
    // ============================================
    socket.on('join-team', async (data) => {
        const { teamId } = data || {};
        try {
            const member = await getSocketTeamMembership(socket, teamId);
            if (!member) {
                socket.emit('team-access-revoked', { message: 'You are no longer a member of this team.' });
                return;
            }
            if (socket.teamRoomId && String(socket.teamRoomId) !== String(teamId)) socket.leave(`team_${socket.teamRoomId}`);
            const userId = member.id, firstName = member.first_name || 'User';
            socket.teamRoomId = String(teamId);
            connectedUsers.set(socket.id, { userId, teamId, firstName, socketId: socket.id, connectedAt: Date.now() });
            userSockets.set(userId, socket.id);
            socket.join(`team_${teamId}`);
            // Accepted friends were notified when this authenticated socket connected.
            await pool.query('UPDATE users SET last_seen = NOW() WHERE id = $1', [userId]);
            const messages = await pool.query(`
                SELECT tm.*, u.first_name, u.photo_url FROM team_messages tm
                JOIN users u ON tm.user_id = u.id
                WHERE tm.team_id = $1 ORDER BY tm.created_at DESC LIMIT 50
            `, [teamId]);
            socket.emit('chat-history', messages.rows.reverse());
            socket.to(`team_${teamId}`).emit('user-joined', { userId, firstName, message: `${firstName} joined the chat` });
        } catch (err) {
            console.error('Join team chat error:', err);
            socket.emit('message-error', { error: 'Unable to join team chat' });
        }
    });
    
    socket.on('send-message', async (data, acknowledge) => {
        const { teamId, message } = data || {};
        const reply = (payload) => {
            if (typeof acknowledge === 'function') acknowledge(payload);
        };

        if (!message || typeof message !== 'string' || !message.trim() || message.length > 500) {
            reply({ ok: false, error: 'Message must contain 1–500 characters.' });
            return;
        }
        try {
            const member = await getSocketTeamMembership(socket, teamId);
            if (!member || String(socket.teamRoomId) !== String(teamId)) {
                socket.emit('team-access-revoked', { message: 'You no longer have access to this team chat.' });
                reply({ ok: false, error: 'You no longer have access to this team chat.' });
                return;
            }
            const userId = member.id, firstName = member.first_name || 'User';
            const result = await pool.query(`
                INSERT INTO team_messages (team_id, user_id, message) VALUES ($1, $2, $3)
                RETURNING id, created_at
            `, [teamId, userId, message.trim()]);
            const messageData = { id: result.rows[0].id, team_id: teamId, user_id: userId, first_name: firstName,
                message: message.trim(), created_at: result.rows[0].created_at, is_edited: false };

            // Deliver the saved message to every socket in this team's room.
            io.to(`team_${teamId}`).emit('new-message', messageData);
            // Also notify members viewing the team page so their unread badges update live.
            io.to(`team_status_${teamId}`).emit('new-message', messageData);
            // Confirm persistence to the sender; the client de-duplicates if the
            // broadcast was already rendered before this acknowledgement arrives.
            reply({ ok: true, message: messageData });

            await pool.query(`UPDATE team_typing_status SET is_typing = false, updated_at = NOW() WHERE team_id = $1 AND user_id = $2`, [teamId, userId]);
            socket.to(`team_${teamId}`).emit('user-typing', { userId, firstName, isTyping: false });
        } catch (err) {
            console.error('Send message error:', err);
            reply({ ok: false, error: 'Failed to send message. Please try again.' });
            socket.emit('message-error', { error: 'Failed to send message' });
        }
    });
    
    socket.on('typing', async (data) => {
        const { teamId, isTyping } = data || {};
        try {
            const member = await getSocketTeamMembership(socket, teamId);
            if (!member || String(socket.teamRoomId) !== String(teamId)) return;
            await pool.query(`
                INSERT INTO team_typing_status (team_id, user_id, is_typing, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (team_id, user_id) DO UPDATE SET is_typing = $3, updated_at = NOW()
            `, [teamId, member.id, Boolean(isTyping)]);
            socket.to(`team_${teamId}`).emit('user-typing', {
                userId: member.id, firstName: member.first_name || 'User', isTyping: Boolean(isTyping)
            });
        } catch (err) { console.error('Typing status error:', err); }
    });
    
    socket.on('edit-message', async (data) => {
        const { messageId, newMessage, teamId } = data || {};
        if (!newMessage || typeof newMessage !== 'string' || !newMessage.trim() || newMessage.length > 500) return;
        try {
            const member = await getSocketTeamMembership(socket, teamId);
            if (!member || String(socket.teamRoomId) !== String(teamId)) return;
            const result = await pool.query(`
                UPDATE team_messages SET message = $1, is_edited = true, updated_at = NOW()
                WHERE id = $2 AND user_id = $3 AND team_id = $4 AND is_deleted = FALSE RETURNING id
            `, [newMessage.trim(), messageId, member.id, teamId]);
            if (result.rows.length) io.to(`team_${teamId}`).emit('message-edited', {
                messageId, newMessage: newMessage.trim(), userId: member.id
            });
        } catch (err) { socket.emit('message-error', { error: 'Failed to edit message' }); }
    });
    
    socket.on('delete-message', async (data) => {
        const { messageId, teamId } = data || {};
        try {
            const member = await getSocketTeamMembership(socket, teamId);
            if (!member || String(socket.teamRoomId) !== String(teamId)) return;
            const result = await pool.query(`
                UPDATE team_messages SET message = '', is_deleted = TRUE, updated_at = NOW() WHERE id = $1 AND user_id = $2 AND team_id = $3 AND is_deleted = FALSE RETURNING id
            `, [messageId, member.id, teamId]);
            if (result.rows.length) {
                io.to(`team_${teamId}`).emit('message-deleted', { messageId, isDeleted: true });
                io.to(`team_status_${teamId}`).emit('message-deleted', { messageId, isDeleted: true });
            }
        } catch (err) { socket.emit('message-error', { error: 'Failed to delete message' }); }
    });
    
    // ============================================
    // PRIVATE CHAT
    // ============================================
    socket.on('join-private', async (data, ack) => {
    try {
        const friendId=Number(data?.friendId);
        if(!socket.user?.id||!Number.isInteger(friendId)||friendId<=0){if(typeof ack==='function')ack({success:false,error:'Invalid chat participant'});return;}
        const me=await pool.query('SELECT id,first_name FROM users WHERE telegram_id=$1 LIMIT 1',[socket.user.id]);
        if(!me.rows.length||String(me.rows[0].id)===String(friendId)){if(typeof ack==='function')ack({success:false,error:'Invalid chat participant'});return;}
        const member=me.rows[0];
        const relation=await pool.query(`SELECT 1 FROM friends WHERE status='accepted' AND ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) LIMIT 1`,[member.id,friendId]);
        if(!relation.rows.length){if(typeof ack==='function')ack({success:false,error:'You can only message accepted friends'});return;}
        const chatId=[Number(member.id),friendId].sort((a,b)=>a-b).join('-');
        socket.dbUserId=member.id;socket.privateChatId=chatId;socket.privateFriendId=friendId;
        connectedUsers.set(socket.id,{userId:member.id,friendId,firstName:member.first_name||'User',chatId,socketId:socket.id});
        userSockets.set(member.id,socket.id);socket.join(`private_${chatId}`);
        const newlyRead = await pool.query(`
            UPDATE private_messages
            SET delivered_at=COALESCE(delivered_at,NOW()), is_read=TRUE
            WHERE sender_id=$1 AND receiver_id=$2 AND is_deleted=FALSE
            RETURNING id
        `,[friendId,member.id]);
        if(newlyRead.rows.length) io.to(`private_${chatId}`).emit('private-message-status',{
            messageIds:newlyRead.rows.map(row=>row.id),status:'read',recipientId:member.id
        });
        if(typeof ack==='function')ack({success:true,chatId});
    }catch(err){console.error('Join private chat error:',err);if(typeof ack==='function')ack({success:false,error:'Unable to join private chat'});}
});

socket.on('send-private-message', async (data, ack) => {
    const senderId=socket.dbUserId,receiverId=socket.privateFriendId,chatId=socket.privateChatId;
    const message=typeof data?.message==='string'?data.message.trim():'';
    if(!senderId||!receiverId||!chatId||!socket.rooms.has(`private_${chatId}`)){if(typeof ack==='function')ack({success:false,error:'Join the private chat first'});return;}
    if(!message||message.length>500){if(typeof ack==='function')ack({success:false,error:'Message must be between 1 and 500 characters'});return;}
    try{
        const relation=await pool.query(`SELECT 1 FROM friends WHERE status='accepted' AND ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) LIMIT 1`,[senderId,receiverId]);
        if(!relation.rows.length){if(typeof ack==='function')ack({success:false,error:'Friendship is no longer active'});return;}
        const result=await pool.query(`INSERT INTO private_messages(sender_id,receiver_id,message) VALUES($1,$2,$3) RETURNING id,created_at`,[senderId,receiverId,message]);
        const roomSockets=await io.in(`private_${chatId}`).fetchSockets();
        const recipientInChat=roomSockets.some(activeSocket=>String(connectedUsers.get(activeSocket.id)?.userId)===String(receiverId));
        let deliveredAt=null;
        if(recipientInChat){
            const delivered=await pool.query('UPDATE private_messages SET delivered_at=COALESCE(delivered_at,NOW()) WHERE id=$1 RETURNING delivered_at',[result.rows[0].id]);
            deliveredAt=delivered.rows[0]?.delivered_at||null;
        }
        const sender=await pool.query('SELECT first_name FROM users WHERE id=$1',[senderId]);
        const item={id:result.rows[0].id,sender_id:senderId,receiver_id:receiverId,sender_name:sender.rows[0]?.first_name||'User',message,created_at:result.rows[0].created_at,delivered_at:deliveredAt,is_read:false,is_edited:false,is_deleted:false};
        io.to(`private_${chatId}`).emit('private-message',item);
        if(deliveredAt) io.to(`private_${chatId}`).emit('private-message-status',{messageIds:[item.id],status:'delivered',recipientId:receiverId});
        if(typeof ack==='function')ack({success:true,messageId:item.id});
        const online=Array.from(presenceSockets.values()).some(p=>String(p.userId)===String(receiverId));
        if(!online&&process.env.BOT_TOKEN){
            try{
                const receiver=await pool.query('SELECT telegram_id FROM users WHERE id=$1',[receiverId]);
                if(receiver.rows.length){
                    const preview=message.length>50?message.slice(0,50)+'...':message;
                    const appUrl=process.env.MINI_APP_URL||'https://yzemanbot-backend.onrender.com';
                    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:receiver.rows[0].telegram_id,text:`💬 New Message from ${item.sender_name}\n\n📝 "${preview}"\n\n🔔 Tap to reply!`,reply_markup:{inline_keyboard:[[{text:'💬 REPLY',web_app:{url:`${appUrl}/profile.html?userId=${senderId}`}}]]}})});
                }
            }catch(e){console.error('Private message notification error:',e);}
        }
    }catch(err){console.error('Send private message error:',err);if(typeof ack==='function')ack({success:false,error:'Failed to send message'});socket.emit('message-error',{error:'Failed to send message'});}
});

socket.on('edit-private-message', async (data, ack) => {
    const senderId=socket.dbUserId,receiverId=socket.privateFriendId,chatId=socket.privateChatId;
    const messageId=Number(data?.messageId),newMessage=typeof data?.newMessage==='string'?data.newMessage.trim():'';
    if(!senderId||!receiverId||!chatId||!socket.rooms.has(`private_${chatId}`)||!Number.isInteger(messageId)||!newMessage||newMessage.length>500){if(typeof ack==='function')ack({success:false,error:'Invalid edit request'});return;}
    try{
        const result=await pool.query(`UPDATE private_messages SET message=$1,is_edited=true,updated_at=NOW() WHERE id=$2 AND sender_id=$3 AND receiver_id=$4 AND is_deleted=FALSE RETURNING id`,[newMessage,messageId,senderId,receiverId]);
        if(!result.rows.length){if(typeof ack==='function')ack({success:false,error:'Message not found or no longer editable'});return;}
        io.to(`private_${chatId}`).emit('private-message-edited',{messageId,newMessage,userId:senderId});
        if(typeof ack==='function')ack({success:true});
    }catch(err){console.error('Edit private message error:',err);if(typeof ack==='function')ack({success:false,error:'Failed to edit message'});socket.emit('message-error',{error:'Failed to edit message'});}
});

socket.on('delete-private-message', async (data, ack) => {
    const senderId=socket.dbUserId,receiverId=socket.privateFriendId,chatId=socket.privateChatId,messageId=Number(data?.messageId);
    if(!senderId||!receiverId||!chatId||!socket.rooms.has(`private_${chatId}`)||!Number.isInteger(messageId)){if(typeof ack==='function')ack({success:false,error:'Invalid delete request'});return;}
    try{
        const result=await pool.query(`UPDATE private_messages SET message='',is_deleted=TRUE,updated_at=NOW() WHERE id=$1 AND sender_id=$2 AND receiver_id=$3 AND is_deleted=FALSE RETURNING id`,[messageId,senderId,receiverId]);
        if(!result.rows.length){if(typeof ack==='function')ack({success:false,error:'Message not found or already deleted'});return;}
        io.to(`private_${chatId}`).emit('private-message-deleted',{messageId,isDeleted:true});
        if(typeof ack==='function')ack({success:true});
    }catch(err){console.error('Delete private message error:',err);if(typeof ack==='function')ack({success:false,error:'Failed to delete message'});socket.emit('message-error',{error:'Failed to delete message'});}
});

socket.on('typing-private', data => {
    const userId=socket.dbUserId,chatId=socket.privateChatId;
    if(!userId||!chatId||!socket.rooms.has(`private_${chatId}`))return;
    socket.to(`private_${chatId}`).emit('user-typing-private',{userId,isTyping:Boolean(data?.isTyping)});
});

// TOURNAMENT CHAT
// ============================================

async function getSocketTournamentUser(socket) {
    if (!socket.user?.id) return null;
    const result = await pool.query('SELECT id, first_name FROM users WHERE telegram_id = $1 LIMIT 1', [socket.user.id]);
    return result.rows[0] || null;
}

// Tournament chat typing indicator. Identity is resolved from authenticated Telegram initData.
socket.on('tournament-typing', async (data) => {
    try {
        if (!socket.user?.id || !socket.rooms.has('tournament_chat')) return;
        const member = await pool.query('SELECT id, first_name FROM users WHERE telegram_id = $1 LIMIT 1', [socket.user.id]);
        if (!member.rows.length) return;
        socket.to('tournament_chat').emit('tournament-user-typing', {
            userId: member.rows[0].id,
            firstName: member.rows[0].first_name || 'User',
            isTyping: Boolean(data?.isTyping)
        });
    } catch (err) { console.error('Tournament typing error:', err); }
});

// When user joins tournament chat
socket.on('join-tournament', async (_data, acknowledge) => {
    const reply = (payload) => {
        if (typeof acknowledge === 'function') acknowledge(payload);
    };
    try {
        const member = await getSocketTournamentUser(socket);
        if (!member) {
            const error = 'Unable to verify your account for tournament chat.';
            socket.emit('chat-error', { error });
            reply({ ok: false, error });
            return;
        }
        const userId = member.id;
        const firstName = member.first_name || 'User';
        console.log(`🏆 User ${firstName} (${userId}) joined tournament chat`);
        socket.join('tournament_chat');
        await pool.query(`
            INSERT INTO tournament_chat_reads (user_id, last_read_at)
            VALUES ($1, NOW())
            ON CONFLICT (user_id)
            DO UPDATE SET last_read_at = NOW()
        `, [userId]);
        await pool.query("DELETE FROM tournament_messages WHERE created_at < NOW() - INTERVAL '24 hours'");
        const result = await pool.query(`
            SELECT tm.*, u.first_name
            FROM tournament_messages tm
            JOIN users u ON tm.user_id = u.id
            ORDER BY tm.created_at DESC
            LIMIT 50
        `);
        const history = result.rows.reverse();
        console.log(`📚 Tournament chat history loaded for user ${userId}: ${history.length} messages`);
        socket.emit('chat-history', history);
        reply({ ok: true, messages: history });
        socket.to('tournament_chat').emit('user-joined', { userId, firstName });
    } catch (err) {
        console.error('Join tournament error:', err);
        const error = 'Unable to load tournament messages. Please try again.';
        socket.emit('chat-error', { error });
        reply({ ok: false, error });
    }
});

// When tournament page badge socket connects (for unread counts)
socket.on('join-tournament-status', async () => {
    const member = await getSocketTournamentUser(socket);
    const userId = member?.id;
    if (userId) {
        socket.join(`tournament_status_${userId}`);
        
        try {
            const lastReadResult = await pool.query(
                'SELECT last_read_at FROM tournament_chat_reads WHERE user_id = $1',
                [userId]
            );
            const lastReadAt = lastReadResult.rows[0]?.last_read_at || new Date(0);
            
            const unreadResult = await pool.query(`
                SELECT COUNT(*) as count 
                FROM tournament_messages
                WHERE created_at > $1 AND user_id <> $2 AND is_deleted = FALSE
            `, [lastReadAt, userId]);
            
            const unreadCount = parseInt(unreadResult.rows[0].count);
            socket.emit('tournament-unread-count', { count: unreadCount });
            console.log(`📊 Sent unread count ${unreadCount} to user ${userId}`);
        } catch (err) {
            console.error('Tournament status error:', err);
            socket.emit('tournament-unread-count', { count: 0 });
        }
    }
});

// When sending a new tournament message
socket.on('send-tournament-message', async (data) => {
    const { message } = data || {};
    if (!message || typeof message !== 'string' || message.trim().length === 0 || message.length > 500) return;
    try {
        const member = await getSocketTournamentUser(socket);
        if (!member || !socket.rooms.has('tournament_chat')) return;
        const userId = member.id;
        const firstName = member.first_name || 'User';
        
        const result = await pool.query(
            'INSERT INTO tournament_messages (user_id, message) VALUES ($1, $2) RETURNING id, created_at',
            [userId, message.trim()]
        );
        
        const messageData = {
            id: result.rows[0].id,
            user_id: userId,
            first_name: firstName,
            message: message.trim(),
            created_at: result.rows[0].created_at
        };
        
        console.log('📡 Broadcasting tournament message to ALL:', messageData);
        io.emit('tournament-new-message', messageData);
        
    } catch (err) {
        console.error('Send tournament message error:', err);
        socket.emit('message-error', { error: 'Failed to send' });
    }
});

    // Tournament Chat - Edit & Delete
socket.on('edit-tournament-message', async (data) => {
    const { messageId, newMessage } = data || {};
    if (!newMessage || typeof newMessage !== 'string' || !newMessage.trim() || newMessage.length > 500) return;
    try {
        const member = await getSocketTournamentUser(socket);
        if (!member || !socket.rooms.has('tournament_chat')) return;
        const userId = member.id;
        const result = await pool.query(
            'UPDATE tournament_messages SET message = $1, is_edited = true, updated_at = NOW() WHERE id = $2 AND user_id = $3 AND is_deleted = FALSE RETURNING id',
            [newMessage.trim(), messageId, userId]
        );
        if (result.rows.length > 0) {
            io.to('tournament_chat').emit('message-edited', { messageId, newMessage: newMessage.trim(), userId });
        }
    } catch (err) { socket.emit('message-error', { error: 'Failed to edit' }); }
});

socket.on('delete-tournament-message', async (data) => {
    const { messageId } = data || {};
    try {
        const member = await getSocketTournamentUser(socket);
        if (!member || !socket.rooms.has('tournament_chat')) return;
        const userId = member.id;
        const result = await pool.query(
            `UPDATE tournament_messages SET message = '', is_deleted = TRUE WHERE id = $1 AND user_id = $2 AND is_deleted = FALSE RETURNING id`,
            [messageId, userId]
        );
        if (result.rows.length > 0) {
            io.to('tournament_chat').emit('message-deleted', { messageId, isDeleted: true });
            io.emit('tournament-message-deleted', { messageId });
        }
    } catch (err) { socket.emit('message-error', { error: 'Failed to delete' }); }
});
    
    // ============================================
    // DISCONNECT
    // ============================================
    socket.on('disconnect', async () => {
        const user = connectedUsers.get(socket.id);
        const presence = presenceSockets.get(socket.id);
        const userId = presence?.userId || user?.userId || socket.dbUserId;
        const firstName = presence?.firstName || user?.firstName || 'User';

        connectedUsers.delete(socket.id);
        presenceSockets.delete(socket.id);

        if (userId) {
            const stillOnline = Array.from(presenceSockets.values())
                .some(item => String(item.userId) === String(userId));

            const storedSocketId = userSockets.get(userId);
            if (storedSocketId === socket.id) {
                const replacement = Array.from(presenceSockets.entries())
                    .find(([, item]) => String(item.userId) === String(userId));
                if (replacement) userSockets.set(userId, replacement[0]);
                else userSockets.delete(userId);
            }

            if (!stillOnline) {
                console.log(`🔴 User ${firstName} (${userId}) disconnected`);
                try {
                    const offlineResult = await pool.query(
                        `UPDATE users
                         SET last_seen = timezone('UTC', NOW())
                         WHERE id = $1
                         RETURNING to_char(last_seen, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_seen_utc`,
                        [userId]
                    );
                    const lastSeenUtc = offlineResult.rows[0]?.last_seen_utc || null;
                    const friends = await pool.query(
                        `SELECT CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END AS friend_id
                         FROM friends f
                         WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'`,
                        [userId]
                    );
                    friends.rows.forEach(friend => {
                        io.to(`user_${friend.friend_id}`).emit('friend-offline', { userId, lastSeenUtc });
                    });
                } catch (err) {
                    console.error('Friend offline broadcast error:', err);
                }
            }
        }
    });
});


// ============================================
// USER API ENDPOINT (UPDATED FOR COINS + LAST SEEN + RETURNING USER)
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
    let isReturningUser = false; // ✅ Track if user was soft-deleted
    
    if (existingUser.rows.length > 0) {
      // ✅ CHECK IF USER WAS SOFT-DELETED (coins = 0 and last_seen was null)
      if (parseFloat(existingUser.rows[0].coins) === 0 && existingUser.rows[0].last_seen === null) {
        isReturningUser = true;
        console.log(`👋 Returning user detected: ${first_name} (${id}) — balance was reset due to inactivity`);
        
        // Send welcome back message via Telegram bot
        const BOT_TOKEN = process.env.BOT_TOKEN;
        if (BOT_TOKEN) {
          const referrals = existingUser.rows[0].referrals || 0;
          const tier = existingUser.rows[0].tier || 'Fresher';
          const welcomeMessage = `👋 *WELCOME BACK TO YZEMANBOT\\!*\n\nYou've been inactive for a while, so your COINS balance was reset to *0*\\.\n\nBut don't worry — your progress is safe:\n👥 *Referrals:* ${referrals}\n🏆 *Tier:* ${tier}\n\nHere's a fresh start — watch ads, spin the wheel, and join tournaments to rebuild your earnings\\!\n\n🚀 *Start earning again now\\!*`;
          
          try {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: id,
                text: welcomeMessage,
                parse_mode: 'Markdown'
              })
            });
            console.log(`📨 Welcome back message sent to returning user ${id}`);
          } catch (e) {
            console.error('Failed to send welcome back message:', e);
          }
        }
      }
      
      // UPDATE EXISTING USER - Added last_seen
      const updateQuery = `
        UPDATE users 
        SET first_name = $1, last_name = $2, username = $3, photo_url = $4,
            wallet_address = COALESCE($5, wallet_address), 
            last_login_date = (CURRENT_DATE AT TIME ZONE 'Africa/Lagos')::date,
            last_seen = NOW(),
            updated_at = NOW()
        WHERE telegram_id = $6
        RETURNING *
      `;
      const result = await client.query(updateQuery, [
        first_name, last_name, username, photo_url, walletAddress, id
      ]);
      user = result.rows[0];
      user.is_returning = isReturningUser; // ✅ Add flag to user object
      console.log(`✅ Existing user ${id} updated, last_seen set`);
    } else {
      // NEW USER - Create account with last_seen
      const userReferralCode = `ref-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      
      const insertQuery = `
        INSERT INTO users (telegram_id, first_name, last_name, username, photo_url, referral_code, wallet_address, last_login_date, last_seen)
        VALUES ($1, $2, $3, $4, $5, $6, $7, (CURRENT_DATE AT TIME ZONE 'Africa/Lagos')::date, NOW())
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
            
            // Give bonus to REFERRER
            await client.query(
              'UPDATE users SET coins = coins + $1, referrals = referrals + 1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
              [referrerReward, referrerId]
            );
            
            // Track referrer's bonus in history
            await client.query(
              'INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)',
              [referrerId, referrerReward, 'referral_bonus']
            );
            
            // Give bonus to REFEREE
            await client.query(
              'UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
              [refereeBonus, user.id]
            );
            
            console.log(`ℹ️ Referee ${user.id} received ${refereeBonus} COINS (not tracked in leaderboard)`);
            
            // Track monthly earnings for the referee's bonus
            await trackMonthlyEarnings(client, user.id, refereeBonus);
            
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

// ✅ CORRECTED IP TRACKING
const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
const cleanIp = clientIp ? clientIp.split(',')[0].trim() : null;

await client.query(`
  UPDATE users 
  SET ip_address = $1 
  WHERE telegram_id = $2
`, [cleanIp, id]); // 'id' is the correct variable name!
      
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
    console.log(`📤 Response sent for user ${id}: coins=${user.coins}, referrals=${stats?.referrals || 0}, returning=${isReturningUser}`);
    res.json({ ...user, ...stats, is_returning: isReturningUser });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ User Error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
// ============================================
// TOURNAMENT UNREAD COUNT
// ============================================
app.post('/api/tournament/unread-count', verifyTelegramData, async (req, res) => {
    try {
        const telegramId = req.telegramUser.id;
        const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        if (userResult.rows.length === 0) {
            return res.json({ unread_count: 0 });
        }
        
        const userId = userResult.rows[0].id;
        
        // Get last read time
        const lastReadResult = await pool.query(
            'SELECT last_read_at FROM tournament_chat_reads WHERE user_id = $1',
            [userId]
        );
        const lastReadAt = lastReadResult.rows[0]?.last_read_at || new Date(0);
        
        // Count unread messages
        const unreadResult = await pool.query(`
            SELECT COUNT(*) as count 
            FROM tournament_messages
            WHERE created_at > $1 AND user_id <> $2 AND is_deleted = FALSE
        `, [lastReadAt, userId]);
        
        res.json({ unread_count: parseInt(unreadResult.rows[0].count) });
    } catch (err) {
        console.error('Tournament unread count error:', err);
        res.json({ unread_count: 0 });
    }
});

// ============================================
// TOURNAMENT: Update last read time
// ============================================
app.post('/api/tournament/update-read', verifyTelegramData, async (req, res) => {
    try {
        const telegramId = req.telegramUser.id;
        const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        if (userResult.rows.length === 0) {
            return res.json({ success: false });
        }
        
        const userId = userResult.rows[0].id;
        
        await pool.query(`
            INSERT INTO tournament_chat_reads (user_id, last_read_at)
            VALUES ($1, NOW())
            ON CONFLICT (user_id) 
            DO UPDATE SET last_read_at = NOW()
        `, [userId]);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Update tournament read error:', err);
        res.json({ success: false });
    }
});

// ============================================
// AD REWARD ENDPOINT (WITH COMMISSION & ERROR TRACKING)
// ============================================
app.post('/api/ad-reward', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { rewardAmount, adType } = req.body;
    const telegramId = req.telegramUser.id;

    const userResult = await client.query('SELECT id, coins FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const userId = userResult.rows[0].id;
    
    await client.query('BEGIN');
    
    // ✅ 1. Log the ad (either 'ad' or 'error')
    await client.query(
      'INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)',
      [userId, rewardAmount, adType || 'ad'] 
    );
    
    // ✅ 2. ONLY process rewards if it was a SUCCESSFUL ad
    if (adType !== 'error' && rewardAmount > 0) {
        // Update user's coin balance
        await client.query(
          'UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
          [rewardAmount, userId]
        );
        
        // Award referral commission
        await awardReferralCommission(client, userId, rewardAmount);
        
        // Track monthly earnings
        await trackMonthlyEarnings(client, userId, rewardAmount);
        
        // ✅ 3. Update ad_statistics (This fixes the "Ads Today" counter)
        await client.query(`
          INSERT INTO ad_statistics (user_id, total_ads, ads_today, ads_week, updated_at)
          VALUES ($1, 1, 1, 1, NOW())
          ON CONFLICT (user_id) DO UPDATE SET
            total_ads = ad_statistics.total_ads + 1,
            ads_today = CASE 
              WHEN DATE(ad_statistics.updated_at AT TIME ZONE 'Africa/Lagos') = (CURRENT_DATE AT TIME ZONE 'Africa/Lagos')::date
              THEN ad_statistics.ads_today + 1 
              ELSE 1 
            END,
            ads_week = CASE 
              WHEN DATE(ad_statistics.updated_at AT TIME ZONE 'Africa/Lagos') >= ((CURRENT_DATE AT TIME ZONE 'Africa/Lagos')::date - INTERVAL '6 days')
              THEN ad_statistics.ads_week + 1 
              ELSE 1 
            END,
            updated_at = NOW()
        `, [userId]);
        
        // Check for Points Millionaire achievement
        if (parseFloat(userResult.rows[0].coins) + rewardAmount >= 1000000) {
          await awardAchievement(userId, 'Points Millionaire', client);
        }
        
        // Check for Ad Master achievements
        const adStats = await client.query(
          'SELECT total_ads FROM ad_statistics WHERE user_id = $1',
          [userId]
        );
        if (adStats.rows.length > 0) {
          const totalAds = parseInt(adStats.rows[0].total_ads);
          if (totalAds >= 5000) await awardAchievement(userId, 'Ad Master', client);
          if (totalAds >= 10000) await awardAchievement(userId, 'Ad Master Platinum', client);
        }
    }
    
    await client.query('COMMIT');
      
    // Fetch the updated coins to send back to the frontend
    const finalCoins = await client.query('SELECT coins FROM users WHERE id = $1', [userId]);
    res.json({ success: true, coins: finalCoins.rows[0].coins });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Ad Reward Error:', err);
    res.status(500).json({ error: 'Failed to process ad reward' });
  } finally {
    client.release();
  }
});
 

// ============================================
// USER EARNINGS HISTORY (DETAILED)
// ============================================
app.post('/api/earnings-history', verifyTelegramData, async (req, res) => {
  try {
    const telegramId = req.telegramUser.id;
    const month = req.body.month; // Format: 'YYYY-MM' (e.g., '2026-04')
    
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userId = userResult.rows[0].id;
    
    const monthStart = month + '-01';
    const nextMonth = new Date(monthStart);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const monthEnd = nextMonth.toISOString().split('T')[0];
    
    // Fetch all ad_rewards for this user in the given month
    // Join with referral info for commission/referral entries
    const earnings = await pool.query(`
      SELECT 
        ar.id,
        ar.reward_amount as amount,
        ar.ad_type as type,
        ar.created_at,
        -- For referral_bonus: get the user who was referred
        CASE WHEN ar.ad_type = 'referral_bonus' THEN
          (SELECT u2.first_name FROM referrals r2 JOIN users u2 ON r2.referred_id = u2.id WHERE r2.referrer_id = $1 AND r2.created_at::date = ar.created_at::date ORDER BY r2.id DESC LIMIT 1)
        ELSE NULL END as referral_name,
        -- For referral_commission: get the user who earned the coins
        CASE WHEN ar.ad_type = 'referral_commission' THEN
          (SELECT u3.first_name FROM referral_commissions rc JOIN users u3 ON rc.referred_id = u3.id WHERE rc.referrer_id = $1 AND rc.created_at = ar.created_at LIMIT 1)
        ELSE NULL END as commission_from,
        -- For admin_add: who added it
        CASE WHEN ar.ad_type = 'admin_add' THEN 'Admin' ELSE NULL END as admin_note
      FROM ad_rewards ar
      WHERE ar.user_id = $1
        AND ar.created_at >= $2::timestamp
        AND ar.created_at < $3::timestamp
      ORDER BY ar.created_at DESC
      LIMIT 200
    `, [userId, monthStart, monthEnd]);
    
    // Calculate totals by type
    const totals = {};
    let overallTotal = 0;
    earnings.rows.forEach(row => {
      const amount = parseFloat(row.amount);
      overallTotal += amount;
      totals[row.type] = (totals[row.type] || 0) + amount;
    });
    
    res.json({
      month,
      overallTotal,
      totals,
      transactions: earnings.rows
    });
  } catch (err) {
    console.error('Earnings history error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});


// ============================================
// DAILY REWARD ENDPOINT - FIXED STREAK
// ============================================
function isValidDailyLocalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function previousDailyDate(value) {
  const date = new Date(value + 'T00:00:00.000Z'); date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
function databaseDateString(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

// ============================================
// DAILY REWARD ENDPOINT - VALIDATED ATOMIC CLAIM
// ============================================
app.post('/api/daily-reward', verifyTelegramData, async (req, res) => {
  const client = await pool.connect(); let transactionStarted = false;
  try {
    const { localDate } = req.body;
    if (!isValidDailyLocalDate(localDate)) return res.status(400).json({ error: 'Invalid localDate. Use YYYY-MM-DD.' });
    const telegramId = req.telegramUser.id, todayStr = localDate, yesterdayStr = previousDailyDate(localDate);
    await client.query('BEGIN'); transactionStarted = true;
    const userResult = await client.query('SELECT id, tier FROM users WHERE telegram_id = $1 FOR UPDATE', [telegramId]);
    if (!userResult.rows.length) { await client.query('ROLLBACK'); transactionStarted = false; return res.status(404).json({ error: 'User not found' }); }
    const user = userResult.rows[0], userId = user.id;
    const existing = await client.query('SELECT 1 FROM daily_rewards WHERE user_id = $1 AND reward_date = $2', [userId, todayStr]);
    if (existing.rows.length) { await client.query('ROLLBACK'); transactionStarted = false; return res.status(400).json({ error: 'Already claimed today' }); }
    const lastClaim = await client.query('SELECT reward_date, streak_count FROM daily_rewards WHERE user_id = $1 ORDER BY reward_date DESC LIMIT 1', [userId]);
    let streak = 1;
    if (lastClaim.rows.length && databaseDateString(lastClaim.rows[0].reward_date) === yesterdayStr) streak = (lastClaim.rows[0].streak_count || 0) + 1;
    const baseReward = 2, streakBonus = streak * 0.5, weeklyBonus = streak % 7 === 0 ? 10 : 0;
    const milestoneBonus = streak === 30 ? 1000 : (streak === 100 ? 5000 : 0);
    const multipliers = { Fresher: 1, Brute: 1.5, Silver: 2, Gold: 2.5, Platinum: 3 };
    const multiplier = multipliers[user.tier] || 1;
    const finalReward = (baseReward + streakBonus + weeklyBonus + milestoneBonus) * multiplier;
    await client.query('INSERT INTO daily_rewards (user_id, reward_date, streak_count, reward_coins) VALUES ($1, $2, $3, $4)', [userId, todayStr, streak, finalReward]);
    await client.query('UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1, last_login_date = $2 WHERE id = $3', [finalReward, todayStr, userId]);
    await client.query('INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)', [userId, finalReward, 'daily']);
    await trackMonthlyEarnings(client, userId, finalReward);
    await awardReferralCommission(client, userId, finalReward);
    if (streak >= 7) await awardAchievement(userId, 'Daily Streak 7', client);
    if (streak >= 30) await awardAchievement(userId, 'Loyal User', client);
    await client.query('COMMIT'); transactionStarted = false;
    res.json({ success: true, reward: finalReward, streak, milestoneBonus: milestoneBonus * multiplier });
  } catch (err) {
    if (transactionStarted) { try { await client.query('ROLLBACK'); } catch (rollbackErr) { console.error('Daily reward rollback failed:', rollbackErr); } }
    console.error('Daily reward error:', err); res.status(500).json({ error: 'Failed to process daily reward' });
  } finally { client.release(); }
});

// ============================================
// DAILY STATS ENDPOINT - VIEWER LOCAL DATE
// ============================================
app.post('/api/daily-stats', verifyTelegramData, async (req, res) => {
  try {
    const { localDate } = req.body;
    if (!isValidDailyLocalDate(localDate)) return res.status(400).json({ error: 'Invalid localDate. Use YYYY-MM-DD.' });
    const telegramId = req.telegramUser.id;
    const userResult = await pool.query('SELECT id, tier FROM users WHERE telegram_id = $1', [telegramId]);
    if (!userResult.rows.length) return res.json({ claimed_today: false, last_7_days: [], max_streak: 0, current_streak: 0, total_claims: 0, tier: 'Fresher' });
    const userId = userResult.rows[0].id, todayStr = localDate, yesterdayStr = previousDailyDate(localDate);
    const claimedToday = await pool.query('SELECT * FROM daily_rewards WHERE user_id = $1 AND reward_date = $2', [userId, todayStr]);
    const last7Days = await pool.query('SELECT reward_date, streak_count, reward_coins FROM daily_rewards WHERE user_id = $1 ORDER BY reward_date DESC LIMIT 7', [userId]);
    const maxStreak = await pool.query('SELECT COALESCE(MAX(streak_count), 0) as max_streak FROM daily_rewards WHERE user_id = $1', [userId]);
    const totalClaims = await pool.query('SELECT COUNT(*) as total FROM daily_rewards WHERE user_id = $1', [userId]);
    let currentStreak = 0;
    if (claimedToday.rows.length) currentStreak = claimedToday.rows[0].streak_count;
    else if (last7Days.rows.length && databaseDateString(last7Days.rows[0].reward_date) === yesterdayStr) currentStreak = last7Days.rows[0].streak_count;
    const normalizedLast7Days = last7Days.rows.map(row => ({ ...row, reward_date: databaseDateString(row.reward_date) }));
    res.json({ claimed_today: claimedToday.rows.length > 0, last_7_days: normalizedLast7Days,
      max_streak: parseInt(maxStreak.rows[0].max_streak, 10) || 0, current_streak: currentStreak,
      total_claims: parseInt(totalClaims.rows[0].total, 10) || 0, tier: userResult.rows[0].tier || 'Fresher' });
  } catch (err) { console.error('Daily stats error:', err); res.status(500).json({ error: 'Failed to fetch daily stats' }); }
});

// ============================================
// WHEEL SPIN ENDPOINT - USES USER'S LOCAL DATE
// ============================================
app.post('/api/wheel-spin', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const { localDate } = req.body;
    if (!isValidDailyLocalDate(localDate)) return res.status(400).json({ error: 'Invalid localDate. Use YYYY-MM-DD.' });
    await client.query('BEGIN'); transactionStarted = true;
    const telegramId = req.telegramUser.id;
    // Serialize spins for this user so concurrent requests cannot award twice.
    const userResult = await client.query('SELECT id, tier FROM users WHERE telegram_id = $1 FOR UPDATE', [telegramId]);
    if (!userResult.rows.length) {
      await client.query('ROLLBACK'); transactionStarted = false;
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userResult.rows[0], userId = user.id;
    const lastSpin = await client.query('SELECT spin_date FROM wheel_spins WHERE user_id = $1 ORDER BY spin_date DESC LIMIT 1', [userId]);
    if (lastSpin.rows.length) {
      const lastDate = databaseDateString(lastSpin.rows[0].spin_date);
      const lastMs = Date.parse(lastDate + 'T00:00:00.000Z');
      const currentMs = Date.parse(localDate + 'T00:00:00.000Z');
      const daysDiff = Math.round((currentMs - lastMs) / 86400000);
      if (daysDiff < 3) {
        await client.query('ROLLBACK'); transactionStarted = false;
        const daysLeft = Math.max(1, 3 - daysDiff);
        return res.status(400).json({ error: `Next spin in ${daysLeft} day(s)`, daysLeft });
      }
    }
    const prizes = [200, 300, 500, 1000, 2000, 5000, 200, 300, 500, 1000, 2000, 500];
    const prizeIndex = Math.floor(Math.random() * prizes.length);
    const baseReward = prizes[prizeIndex];
    const multipliers = { Fresher: 1.0, Brute: 1.5, Silver: 2.0, Gold: 2.5, Platinum: 3.0 };
    const finalReward = baseReward * (multipliers[user.tier] || 1.0);
    await client.query('INSERT INTO wheel_spins (user_id, spin_date, reward_coins) VALUES ($1, $2, $3)', [userId, localDate, finalReward]);
    await client.query('UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2', [finalReward, userId]);
    await client.query('INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)', [userId, finalReward, 'wheel']);
    await awardReferralCommission(client, userId, finalReward);
    await trackMonthlyEarnings(client, userId, finalReward);
    if (baseReward >= 5000) await awardAchievement(userId, 'Wheel Champion', client);
    await client.query('COMMIT'); transactionStarted = false;
    res.json({ success: true, reward: finalReward, prize_index: prizeIndex });
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); } catch (rollbackErr) { console.error('Wheel spin rollback failed:', rollbackErr); }
    }
    console.error('Wheel spin error:', err);
    res.status(500).json({ error: 'Failed to process wheel spin' });
  } finally { client.release(); }
});

// ============================================
// WHEEL STATUS ENDPOINT - VIEWER LOCAL DATE
// ============================================
app.post('/api/wheel-status', verifyTelegramData, async (req, res) => {
  try {
    const { localDate } = req.body;
    if (!isValidDailyLocalDate(localDate)) return res.status(400).json({ error: 'Invalid localDate. Use YYYY-MM-DD.' });
    const telegramId = req.telegramUser.id;
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (!userResult.rows.length) return res.json({ can_spin: true, days_left: 0, last_reward: 0 });
    const lastSpin = await pool.query('SELECT spin_date, reward_coins FROM wheel_spins WHERE user_id = $1 ORDER BY spin_date DESC LIMIT 1', [userResult.rows[0].id]);
    let canSpin = true, daysLeft = 0, lastReward = 0;
    if (lastSpin.rows.length) {
      lastReward = lastSpin.rows[0].reward_coins;
      const lastDate = databaseDateString(lastSpin.rows[0].spin_date);
      const lastMs = Date.parse(lastDate + 'T00:00:00.000Z');
      const currentMs = Date.parse(localDate + 'T00:00:00.000Z');
      const daysDiff = Math.round((currentMs - lastMs) / 86400000);
      if (daysDiff < 3) { canSpin = false; daysLeft = Math.max(1, 3 - daysDiff); }
    }
    res.json({ can_spin: canSpin, days_left: daysLeft, last_reward: lastReward });
  } catch (err) {
    console.error('Wheel status error:', err);
    res.status(500).json({ error: 'Failed to fetch wheel status' });
  }
});

// ============================================
// TASK COMPLETION ENDPOINT (WITH TRACKING)
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
    
    // ✅ TRACK IN AD_REWARDS FOR TOURNAMENT/LEADERBOARD
    await client.query(
      'INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)',
      [userId, coins, 'task']
    );
    
    await awardReferralCommission(client, userId, coins);
    await trackMonthlyEarnings(client, userId, coins);
    
    const socialTasks = ['YouTube', 'twitter', 'facebook', 'instagram', 'tiktok', 'telegram'];
const completed = await client.query(
    'SELECT task_name FROM social_tasks WHERE user_id = $1 AND task_name = ANY($2::text[])', 
    [userId, socialTasks]
);
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

app.post('/api/leaderboard/top-earners', verifyTelegramData, async (req, res) => {
  try {
    // Use the month start sent from user's local timezone
    const monthStart = req.body.localMonthStart || new Date().toISOString().split('T')[0];
    
    console.log(`📊 Fetching monthly leaderboard for month starting: ${monthStart}`);
    
    const result = await pool.query(`
      SELECT 
        u.id, u.username, u.first_name, u.photo_url,
        COALESCE(SUM(ar.reward_amount), 0) as monthly_coins,
        u.tier, u.referrals, u.telegram_id,
        u.coins as total_coins
      FROM users u
      LEFT JOIN ad_rewards ar ON u.id = ar.user_id 
        AND ar.created_at::date >= $1::date
        AND ar.ad_type IN (
          'ad', 'daily', 'wheel', 'achievement', 'task',
          'referral_commission', 'bonus', 'admin_add'
        )
      GROUP BY u.id
      ORDER BY monthly_coins DESC
      LIMIT 50
    `, [monthStart]);
    
    res.json(result.rows || []);
  } catch (err) {
    console.error('❌ Top earners error:', err);
    res.status(500).json({ error: 'Failed to fetch top earners' });
  }
});

// ============================================
// LEADERBOARD: Weekly Top Referrals (RESETS EVERY SUNDAY)
// ============================================
app.post('/api/leaderboard/weekly-referrers', verifyTelegramData, async (req, res) => {
  try {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysSinceSunday = dayOfWeek;
    
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
    const adStats = await pool.query('SELECT COALESCE(total_ads, 0) AS total_ads FROM ad_statistics WHERE user_id = $1', [userId]);
    const socialTasks = await pool.query('SELECT COUNT(*) AS completed FROM social_tasks WHERE user_id = $1', [userId]);
    res.json({
      achievements: achievements.rows,
      userStats: {
        coins: user.coins,
        referrals: user.referrals,
        tier: user.tier,
        total_coins_earned: user.total_coins_earned,
        total_login_days: parseInt(totalLoginDays.rows[0].days),
        max_streak: maxStreak.rows[0].max_streak || 0,
        achievements_count: parseInt(achievementsCount.rows[0].count),
        total_ads: parseInt(adStats.rows[0]?.total_ads || 0),
        social_tasks_completed: parseInt(socialTasks.rows[0]?.completed || 0)
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
    
    let tournament = await client.query(
      'SELECT * FROM weekly_tournaments WHERE week_start = $1 AND is_active = true',
      [weekStartStr]
    );
    
    if (tournament.rows.length === 0) {
      const existingInactive = await client.query(
        'SELECT * FROM weekly_tournaments WHERE week_start = $1',
        [weekStartStr]
      );
      
      if (existingInactive.rows.length > 0) {
        await client.query(
          'UPDATE weekly_tournaments SET is_active = true WHERE id = $1',
          [existingInactive.rows[0].id]
        );
        tournament = { rows: [existingInactive.rows[0]] };
      } else {
        const result = await client.query(
          `INSERT INTO weekly_tournaments (week_start, week_end, is_active) VALUES ($1, $2, true) RETURNING *`,
          [weekStartStr, weekEndStr]
        );
        tournament = result;
      }
    }
    
    const tournamentId = tournament.rows[0].id;
    
    const existing = await client.query(
      'SELECT * FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2',
      [tournamentId, userId]
    );
    
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'You already joined this week\'s tournament' });
    }
    
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
// TOURNAMENT: Current Week Standings (PRIVACY FIXED)
// ============================================
app.post('/api/tournament/standings', verifyTelegramData, async (req, res) => {
  try {
    const telegramId = req.telegramUser.id;
    
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const userId = userResult.rows[0].id;
    const now = new Date();
    const dayOfWeek = now.getDay();
    
    let daysSinceMonday = dayOfWeek - 1;
    if (daysSinceMonday < 0) daysSinceMonday += 7;
    
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - daysSinceMonday);
    weekStart.setHours(0, 0, 0, 0);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    
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
    
    // IMPORTANT: Do NOT send username, telegram_id, or any contact info
    const standings = await pool.query(`
      SELECT 
        u.id,
        -- Use first_name only, no username, no telegram_id
        u.first_name,
        COALESCE(SUM(ar.reward_amount), 0) as weekly_coins,
        u.tier,
        ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(ar.reward_amount), 0) DESC) as rank
      FROM tournament_participants tp
      JOIN users u ON tp.user_id = u.id
      LEFT JOIN ad_rewards ar ON u.id = ar.user_id 
        AND ar.created_at >= $2
        AND ar.ad_type IN ('ad', 'daily', 'wheel', 'task')
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
  let transactionStarted = false;
  try {
    const { teamCode } = req.body;
    const telegramId = req.telegramUser.id;

    if (!teamCode || typeof teamCode !== 'string' || teamCode.trim().length < 4) {
      return res.status(400).json({ error: 'Invalid team code' });
    }

    // Lock the joining user and target team inside one transaction. The team
    // row lock serializes all joins for this team, so concurrent requests
    // cannot both pass the 10-member check.
    await client.query('BEGIN');
    transactionStarted = true;

    const userResult = await client.query(
      'SELECT id, team_id, coins FROM users WHERE telegram_id = $1 FOR UPDATE',
      [telegramId]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;
    const userCoins = parseFloat(userResult.rows[0].coins) || 0;

    if (userResult.rows[0].team_id) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'You are already in a team. Leave your current team first.' });
    }

    const teamResult = await client.query(
      'SELECT * FROM teams WHERE code = $1 FOR UPDATE',
      [teamCode.trim().toUpperCase()]
    );

    if (teamResult.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ error: 'Team not found. Check the code and try again.' });
    }

    const team = teamResult.rows[0];
    const memberCount = await client.query(
      'SELECT COUNT(*)::int AS count FROM team_members WHERE team_id = $1',
      [team.id]
    );

    if (memberCount.rows[0].count >= 10) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'Team is full! Maximum 10 members allowed.' });
    }

    await client.query(
      'INSERT INTO team_members (team_id, user_id, coins_at_join) VALUES ($1, $2, $3)',
      [team.id, userId, userCoins]
    );

    await client.query(
      'UPDATE users SET team_id = $1 WHERE id = $2',
      [team.id, userId]
    );

    await awardAchievement(userId, 'Team Player', client);
    await client.query('COMMIT');
    transactionStarted = false;

    res.json({ success: true, team });
  } catch (err) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    console.error('Join team error:', err);
    res.status(500).json({ error: 'Failed to join team' });
  } finally {
    client.release();
  }
});

app.post('/api/team/info', verifyTelegramData, async (req, res) => {
  try {
    const telegramId = req.telegramUser?.id;
    const userResult = await pool.query(
      'SELECT id, team_id FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    if (userResult.rows.length === 0 || !userResult.rows[0].team_id) {
      return res.json({ has_team: false });
    }
    const viewerUserId = userResult.rows[0].id;
    const teamId = userResult.rows[0].team_id;
    
    if (!teamId) {
      return res.json({ has_team: false });
    }
    
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    
    const teamResult = await pool.query(`
      SELECT t.*, 
        COALESCE(SUM(u.coins), 0) as total_coins,
        COALESCE(SUM(ume.coins_earned), 0) as monthly_coins,
        COUNT(DISTINCT tm.user_id) as member_count,
        COALESCE(SUM(u.referrals), 0) as total_referrals
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id
      LEFT JOIN users u ON tm.user_id = u.id
      LEFT JOIN user_monthly_earnings ume ON u.id = ume.user_id AND ume.month_year = $2
      WHERE t.id = $1
      GROUP BY t.id
    `, [teamId, firstOfMonth]);
    
    if (teamResult.rows.length === 0) {
      return res.json({ has_team: false });
    }
    
    const team = teamResult.rows[0];
    
    const membersResult = await pool.query(`
      SELECT 
        u.id, u.telegram_id, u.first_name, u.username, u.photo_url, 
        u.coins, u.referrals, u.tier,
        (u.id = t.created_by) as is_leader,
        tm.joined_at,
        COALESCE(ume.coins_earned, 0) as monthly_coins
      FROM team_members tm
      JOIN users u ON tm.user_id = u.id
      JOIN teams t ON tm.team_id = t.id
      LEFT JOIN user_monthly_earnings ume ON u.id = ume.user_id AND ume.month_year = $2
      WHERE tm.team_id = $1
      ORDER BY tm.joined_at ASC, u.coins DESC
    `, [teamId, firstOfMonth]);
    
    res.json({
      has_team: true,
      viewer_is_leader: team.created_by === viewerUserId,
      team: {
        ...team,
        total_coins: parseFloat(team.total_coins) || 0,
        monthly_coins: parseFloat(team.monthly_coins) || 0
      },
      members: membersResult.rows.map(m => ({
        ...m,
        coins: parseFloat(m.coins) || 0,
        monthly_coins: parseFloat(m.monthly_coins) || 0
      }))
    });
    
  } catch (err) {
    console.error('Team info error:', err);
    res.status(500).json({ error: 'Failed to fetch team info' });
  }
});

app.post('/api/team/remove-member', verifyTelegramData, async (req, res) => {
  const targetUserId = Number(req.body?.memberId);
  if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) return res.status(400).json({ error: 'Invalid team member' });
  const client = await pool.connect();
  let teamId = null;
  try {
    await client.query('BEGIN');
    const actorResult = await client.query('SELECT id, team_id FROM users WHERE telegram_id = $1 FOR UPDATE', [req.telegramUser.id]);
    if (!actorResult.rows.length || !actorResult.rows[0].team_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You are not in a team' });
    }
    const actorId = actorResult.rows[0].id;
    teamId = actorResult.rows[0].team_id;
    const teamResult = await client.query('SELECT created_by FROM teams WHERE id = $1 FOR UPDATE', [teamId]);
    if (!teamResult.rows.length || teamResult.rows[0].created_by !== actorId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the team leader can remove members' });
    }
    if (targetUserId === actorId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You cannot remove yourself. Use Leave Team instead.' });
    }
    const targetResult = await client.query('SELECT user_id FROM team_members WHERE team_id = $1 AND user_id = $2 FOR UPDATE', [teamId, targetUserId]);
    if (!targetResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'That user is not a member of your team' });
    }
    await client.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [teamId, targetUserId]);
    await client.query('UPDATE users SET team_id = NULL WHERE id = $1 AND team_id = $2', [targetUserId, teamId]);
    await client.query('DELETE FROM team_typing_status WHERE team_id = $1 AND user_id = $2', [teamId, targetUserId]);
    await client.query('COMMIT');
    for (const activeSocket of io.sockets.sockets.values()) {
      if (activeSocket.dbUserId === targetUserId && (String(activeSocket.teamRoomId) === String(teamId) || activeSocket.rooms.has(`team_status_${teamId}`))) {
        activeSocket.emit('team-member-removed', { teamId, message: 'The team leader removed you from this team.' });
        activeSocket.leave(`team_${teamId}`);
        activeSocket.leave(`team_status_${teamId}`);
        activeSocket.teamRoomId = null;
        connectedUsers.delete(activeSocket.id);
      }
    }
    io.to(`team_status_${teamId}`).emit('team-members-updated', { teamId });
    res.json({ success: true, message: 'Member removed. They can rejoin with the team code.' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Remove team member error:', err);
    res.status(500).json({ error: 'Failed to remove team member' });
  } finally { client.release(); }
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
    const remainingMembers = await client.query('SELECT user_id FROM team_members WHERE team_id = $1 ORDER BY joined_at ASC, id ASC', [teamId]);
    if (remainingMembers.rows.length === 0) {
      await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
    } else if (isLeader && remainingMembers.rows.length > 0) {
      await client.query('UPDATE teams SET created_by = $1 WHERE id = $2', [remainingMembers.rows[0].user_id, teamId]);
    }
    await client.query('COMMIT');
    for (const activeSocket of io.sockets.sockets.values()) {
      if (activeSocket.dbUserId === userId && (String(activeSocket.teamRoomId) === String(teamId) || activeSocket.rooms.has(`team_status_${teamId}`))) {
        activeSocket.emit('team-member-removed', { teamId, message: 'You left this team.' });
        activeSocket.leave(`team_${teamId}`);
        activeSocket.leave(`team_status_${teamId}`);
        activeSocket.teamRoomId = null;
        connectedUsers.delete(activeSocket.id);
      }
    }
    res.json({ success: true, message: 'Left team. Your coins are no longer contributing to the team.' });
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

app.post('/api/team/monthly-competition', verifyTelegramData, async (req, res) => {
  try {
    // Keep month keys consistent with the monthly earnings ledger at UTC boundaries.
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const telegramId = req.telegramUser?.id;

    const standingsResult = await pool.query(`
      WITH team_totals AS (
        SELECT
          t.id, t.name,
          COALESCE(SUM(ume.coins_earned), 0) AS team_coins,
          COUNT(DISTINCT tm.user_id) AS member_count,
          COALESCE(MAX(CASE WHEN u.id = t.created_by THEN u.first_name END), 'Unknown') AS leader_name
        FROM teams t
        JOIN team_members tm ON t.id = tm.team_id
        JOIN users u ON u.id = tm.user_id
        LEFT JOIN user_monthly_earnings ume ON u.id = ume.user_id AND ume.month_year = $1
        GROUP BY t.id
      ),
      ranked AS (
        SELECT team_totals.*,
          ROW_NUMBER() OVER (ORDER BY team_coins DESC, id ASC) AS rank
        FROM team_totals
      )
      SELECT id, name, team_coins, member_count, leader_name
      FROM ranked
      ORDER BY rank
      LIMIT 10
    `, [firstOfMonth]);

    const myTeamResult = await pool.query(`
      WITH team_totals AS (
        SELECT
          t.id, t.name,
          COALESCE(SUM(ume.coins_earned), 0) AS team_coins,
          COUNT(DISTINCT tm.user_id) AS member_count,
          COALESCE(MAX(CASE WHEN u.id = t.created_by THEN u.first_name END), 'Unknown') AS leader_name
        FROM teams t
        JOIN team_members tm ON t.id = tm.team_id
        JOIN users u ON u.id = tm.user_id
        LEFT JOIN user_monthly_earnings ume ON u.id = ume.user_id AND ume.month_year = $1
        GROUP BY t.id
      ),
      ranked AS (
        SELECT team_totals.*,
          ROW_NUMBER() OVER (ORDER BY team_coins DESC, id ASC) AS rank
        FROM team_totals
      ),
      viewer_team AS (
        SELECT team_id FROM users WHERE telegram_id = $2
      )
      SELECT r.id, r.name, r.team_coins, r.member_count, r.rank,
        previous.team_coins AS next_team_coins,
        previous.name AS next_team_name
      FROM ranked r
      JOIN viewer_team v ON v.team_id = r.id
      LEFT JOIN ranked previous ON previous.rank = r.rank - 1
      LIMIT 1
    `, [firstOfMonth, telegramId]);

    res.json({
      month: firstOfMonth,
      standings: standingsResult.rows,
      my_team: myTeamResult.rows[0] || null
    });
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
// BONUS CODE REDEMPTION (WITH TRACKING) - FIXED ERROR MESSAGES
// ============================================
app.post('/api/redeem-bonus', verifyTelegramData, async (req, res) => {
  const { code } = req.body;
  const telegramId = req.telegramUser.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '❌ User not found. Please restart the app.' });
    }
    const userId = userResult.rows[0].id;
    
    // Check if already redeemed
    const existing = await client.query(
      'SELECT * FROM user_bonus_redemptions WHERE user_id = $1 AND bonus_code = $2', 
      [userId, code.toUpperCase()]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: '❌ You have already redeemed this bonus code!' });
    }
    
    // Check if bonus code exists and is active
    const bonus = await client.query(
      'SELECT * FROM bonus_codes WHERE code = $1 AND is_active = true', 
      [code.toUpperCase()]
    );
    if (bonus.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: '❌ Invalid or expired bonus code!' });
    }
    
    const coins = bonus.rows[0].coins;
    
    // Update user balance
    await client.query(
      'UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
      [coins, userId]
    );
    
    // Record redemption
    await client.query(
      'INSERT INTO user_bonus_redemptions (user_id, bonus_code) VALUES ($1, $2)', 
      [userId, code.toUpperCase()]
    );
    
    // Track in ad_rewards for leaderboard
    await client.query(
      'INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)',
      [userId, coins, 'bonus']
    );
    
    await awardReferralCommission(client, userId, coins);
    await trackMonthlyEarnings(client, userId, coins);
    
    await client.query('COMMIT');
    res.json({ success: true, coins, message: `🎉 Success! +${coins} COINS added!` });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bonus redemption error:', err);
    
    // Catch any other database errors
    let errorMessage = '❌ Failed to redeem code. Please try again.';
    if (err.message && err.message.includes('duplicate')) {
      errorMessage = '❌ You have already redeemed this bonus code!';
    }
    
    res.status(400).json({ error: errorMessage });
  } finally {
    client.release();
  }
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

app.use('/api/admin', verifyAdmin);

app.get('/api/admin/teams', verifyAdmin, async (req, res) => {
  try {
    const teamsResult = await pool.query(`
      SELECT t.id, t.name, t.code, t.created_by,
        COALESCE(leader.first_name, 'Unknown') AS leader_name,
        COUNT(tm.user_id)::int AS member_count,
        COALESCE(SUM(u.coins), 0) AS total_coins
      FROM teams t
      LEFT JOIN users leader ON leader.id = t.created_by
      LEFT JOIN team_members tm ON tm.team_id = t.id
      LEFT JOIN users u ON u.id = tm.user_id
      GROUP BY t.id, leader.first_name
      ORDER BY total_coins DESC, t.id ASC
    `);
    const membersResult = await pool.query(`
      SELECT tm.team_id, u.id, u.telegram_id, u.first_name, u.username, u.coins,
        (u.id = t.created_by) AS is_leader
      FROM team_members tm JOIN users u ON u.id = tm.user_id
      JOIN teams t ON t.id = tm.team_id
      ORDER BY tm.team_id, tm.joined_at ASC, tm.id ASC
    `);
    const grouped = new Map();
    for (const member of membersResult.rows) {
      if (!grouped.has(member.team_id)) grouped.set(member.team_id, []);
      grouped.get(member.team_id).push(member);
    }
    res.json(teamsResult.rows.map(team => ({
      ...team, total_coins: Number(team.total_coins) || 0,
      members: grouped.get(team.id) || []
    })));
  } catch (err) {
    console.error('Admin teams error:', err);
    res.status(500).json({ error: 'Failed to fetch teams and members' });
  }
});

app.post('/api/admin/team/remove-member', verifyAdmin, async (req, res) => {
  const teamId = Number(req.body?.teamId), userId = Number(req.body?.userId);
  if (!Number.isSafeInteger(teamId) || teamId <= 0 || !Number.isSafeInteger(userId) || userId <= 0)
    return res.status(400).json({ error: 'Invalid team or member' });
  const client = await pool.connect();
  let teamDeleted = false, newLeaderId = null;
  try {
    await client.query('BEGIN');
    const team = await client.query('SELECT id, created_by FROM teams WHERE id = $1 FOR UPDATE', [teamId]);
    if (!team.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Team not found' }); }
    const member = await client.query('SELECT user_id FROM team_members WHERE team_id = $1 AND user_id = $2 FOR UPDATE', [teamId, userId]);
    if (!member.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Member not found in this team' }); }
    await client.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
    await client.query('UPDATE users SET team_id = NULL WHERE id = $1 AND team_id = $2', [userId, teamId]);
    await client.query('DELETE FROM team_typing_status WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
    if (Number(team.rows[0].created_by) === userId) {
      const successor = await client.query('SELECT user_id FROM team_members WHERE team_id = $1 ORDER BY joined_at ASC, id ASC LIMIT 1', [teamId]);
      if (successor.rows.length) {
        newLeaderId = successor.rows[0].user_id;
        await client.query('UPDATE teams SET created_by = $1 WHERE id = $2', [newLeaderId, teamId]);
      } else {
        await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
        teamDeleted = true;
      }
    }
    await client.query('COMMIT');
    for (const socket of io.sockets.sockets.values()) {
      if (socket.dbUserId === userId && (String(socket.teamRoomId) === String(teamId) || socket.rooms.has(`team_status_${teamId}`))) {
        socket.emit('team-member-removed', { teamId, message: 'An administrator removed you from this team.' });
        socket.leave(`team_${teamId}`); socket.leave(`team_status_${teamId}`);
        socket.teamRoomId = null; connectedUsers.delete(socket.id);
      }
    }
    io.to(`team_status_${teamId}`).emit('team-members-updated', { teamId });
    res.json({ success: true, team_deleted: teamDeleted, new_leader_id: newLeaderId });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Admin remove team member error:', err);
    res.status(500).json({ error: 'Failed to remove team member' });
  } finally { client.release(); }
});

app.post('/api/admin/team/delete', verifyAdmin, async (req, res) => {
  const teamId = Number(req.body?.teamId);
  if (!Number.isSafeInteger(teamId) || teamId <= 0) return res.status(400).json({ error: 'Invalid team ID' });
  const client = await pool.connect();
  let memberIds = [];
  try {
    await client.query('BEGIN');
    const team = await client.query('SELECT id FROM teams WHERE id = $1 FOR UPDATE', [teamId]);
    if (!team.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Team not found' }); }
    const members = await client.query('SELECT user_id FROM team_members WHERE team_id = $1', [teamId]);
    memberIds = members.rows.map(row => row.user_id);
    await client.query('UPDATE users SET team_id = NULL WHERE team_id = $1', [teamId]);
    await client.query('DELETE FROM team_typing_status WHERE team_id = $1', [teamId]);
    await client.query('DELETE FROM team_members WHERE team_id = $1', [teamId]);
    // Team messages and dependent read receipts are removed by the teams foreign-key cascade.
    await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
    await client.query('COMMIT');
    for (const socket of io.sockets.sockets.values()) {
      if (memberIds.includes(socket.dbUserId) && (String(socket.teamRoomId) === String(teamId) || socket.rooms.has(`team_status_${teamId}`))) {
        socket.emit('team-member-removed', { teamId, message: 'This team was deleted by an administrator.' });
        socket.leave(`team_${teamId}`); socket.leave(`team_status_${teamId}`);
        socket.teamRoomId = null; connectedUsers.delete(socket.id);
      }
    }
    res.json({ success: true, removed_members: memberIds.length });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Admin delete team error:', err);
    res.status(500).json({ error: 'Failed to delete team' });
  } finally { client.release(); }
});

app.get('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.photo_url, 
             u.referral_code, u.coins, u.tier, u.referrals, u.wallet_address, u.created_at, u.team_id,
             COALESCE(ads.total_ads, 0) as total_ads,
             COALESCE(ads.ads_today, 0) as ads_today,
             COALESCE(ads.ads_week, 0) as ads_week,
             u.last_login_date
      FROM users u
      LEFT JOIN ad_statistics ads ON u.id = ads.user_id
      ORDER BY u.id DESC
    `);
    res.json(result.rows);
  } catch (err) { 
    console.error('Admin users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' }); 
  }
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

// ============================================
// ADMIN: Add Coins (Leaderboard Only)
// ============================================
app.post('/api/admin/add-coins', verifyAdmin, async (req, res) => {
  const { userId, coins } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query(
      'UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
      [coins, userId]
    );
    
    // ✅ TRACK ADMIN ADDED COINS - Leaderboard Only (NOT Tournament)
    await client.query(
      'INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)',
      [userId, coins, 'admin_add']
    );
    
    await trackMonthlyEarnings(client, userId, coins);
    
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Add coins error:', err);
    res.status(500).json({ error: 'Failed to add coins' });
  } finally {
    client.release();
  }
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
    const removedTeamId = u.rows[0].team_id;
    if (removedTeamId) {
      const t = await client.query('SELECT created_by FROM teams WHERE id = $1 FOR UPDATE', [u.rows[0].team_id]);
      const wasLeader = t.rows[0]?.created_by === Number(userId);
      await client.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [u.rows[0].team_id, userId]);
      const rem = await client.query('SELECT user_id FROM team_members WHERE team_id = $1 ORDER BY joined_at ASC, id ASC LIMIT 1', [u.rows[0].team_id]);
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
    await client.query('DELETE FROM user_monthly_earnings WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
    if (removedTeamId) {
      for (const activeSocket of io.sockets.sockets.values()) {
        if (activeSocket.dbUserId === Number(userId) &&
            (String(activeSocket.teamRoomId) === String(removedTeamId) || activeSocket.rooms.has(`team_status_${removedTeamId}`))) {
          activeSocket.emit('team-member-removed', { teamId: removedTeamId, message: 'Your account was removed by an administrator.' });
          activeSocket.leave(`team_${removedTeamId}`);
          activeSocket.leave(`team_status_${removedTeamId}`);
          activeSocket.teamRoomId = null;
          connectedUsers.delete(activeSocket.id);
        }
      }
      io.to(`team_status_${removedTeamId}`).emit('team-members-updated', { teamId: removedTeamId });
    }
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to delete user' });
  } finally { client.release(); }
});

// ============================================
// ADMIN: Analytics Dashboard (FIXED)
// ============================================
app.get('/api/admin/analytics', async (req, res) => {
  try {
    const totalUsers = await pool.query('SELECT COUNT(*) FROM users');
    const totalTeams = await pool.query('SELECT COUNT(*) FROM teams');
    const pendingWithdrawals = await pool.query("SELECT COUNT(*) FROM withdrawals WHERE status = 'pending'");
    const totalRefs = await pool.query('SELECT SUM(referrals) as total FROM users');
    const totalCoins = await pool.query('SELECT SUM(coins) as total FROM users');

    // ✅ Total Ads (Only real video ads)
    const totalAds = await pool.query(`
      SELECT COUNT(*) FROM ad_rewards 
      WHERE ad_type = 'ad'
    `);
    
    // ✅ Ads Today (Only real video ads today, Lagos Time)
    const adsToday = await pool.query(`
      SELECT COUNT(*) FROM ad_rewards 
      WHERE ad_type = 'ad' 
      AND DATE(created_at AT TIME ZONE 'Africa/Lagos') = (CURRENT_DATE AT TIME ZONE 'Africa/Lagos')::date
    `);

    // ✅ Active Today (Only users who watched an ad today)
    const activeToday = await pool.query(`
      SELECT COUNT(DISTINCT user_id) 
      FROM ad_rewards 
      WHERE ad_type = 'ad' 
      AND DATE(created_at AT TIME ZONE 'Africa/Lagos') = (CURRENT_DATE AT TIME ZONE 'Africa/Lagos')::date
    `);
    
    // ✅ Active Week
    const activeWeek = await pool.query(`SELECT COUNT(*) FROM users WHERE last_seen >= NOW() - INTERVAL '7 days'`);

    // ✅ Tier Distribution
    const tiers = await pool.query(`SELECT tier, COUNT(*) as count FROM users GROUP BY tier ORDER BY count DESC`);

    // ✅ Daily Active Users (Last 7 Days) - RESTORED
    const dailyActive = await pool.query(`
      SELECT DATE(last_seen AT TIME ZONE 'Africa/Lagos') as activity_date, COUNT(*) as count
      FROM users 
      WHERE last_seen >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(last_seen AT TIME ZONE 'Africa/Lagos')
      ORDER BY activity_date DESC
    `);

    res.json({
      totalUsers: parseInt(totalUsers.rows[0].count),
      totalTeams: parseInt(totalTeams.rows[0].count),
      pendingWithdrawals: parseInt(pendingWithdrawals.rows[0].count),
      totalAds: parseInt(totalAds.rows[0].count),
      adsToday: parseInt(adsToday.rows[0].count),
      activeToday: parseInt(activeToday.rows[0].count),
      activeWeek: parseInt(activeWeek.rows[0].count),
      tierDistribution: tiers.rows,
      dailyActive: dailyActive.rows,
      totalReferrals: parseInt(totalRefs.rows[0].total) || 0,
      totalCoins: parseFloat(totalCoins.rows[0].total) || 0
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// ADMIN: Previous Tournament Winners (Last Week Only) - FIXED
// ============================================
app.get('/api/admin/tournament-winners', async (req, res) => {    try {
        const lastTournament = await pool.query(`
            SELECT id, week_start, week_end 
            FROM weekly_tournaments 
            WHERE week_end < CURRENT_DATE 
            ORDER BY week_end DESC 
            LIMIT 1
        `);
        
        if (lastTournament.rows.length === 0) {
            return res.json([]);
        }
        
        const tid = lastTournament.rows[0].id;
        const weekStart = lastTournament.rows[0].week_start;
        const weekEnd = lastTournament.rows[0].week_end;
        
        const winners = await pool.query(`
            SELECT 
                u.first_name,
                tp.rank,
                COALESCE(SUM(ar.reward_amount), 0) as weekly_coins,
                CASE WHEN tp.rank = 1 THEN 8000 WHEN tp.rank = 2 THEN 5000 WHEN tp.rank = 3 THEN 3000 END as prize_amount,
                to_char($2::date, 'Mon DD') || ' - ' || to_char($3::date, 'Mon DD, YYYY') as week_label
            FROM tournament_participants tp
            JOIN users u ON tp.user_id = u.id
            LEFT JOIN ad_rewards ar ON u.id = ar.user_id 
                AND ar.created_at >= $2
                AND ar.created_at < ($3::date + 1)::timestamp
                AND ar.ad_type IN ('ad', 'daily', 'wheel', 'task')
            WHERE tp.tournament_id = $1 AND tp.rank IN (1, 2, 3)
            GROUP BY u.id, u.first_name, tp.rank
            ORDER BY tp.rank ASC
        `, [tid, weekStart, weekEnd]);
        
        res.json(winners.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// ADMIN: Previous Leaderboard Winners (Last Month Only)
// ============================================
app.get('/api/admin/leaderboard-winners', async (req, res) => {    try {
        // Get last month (previous completed month)
        const lastMonth = await pool.query(`
            SELECT date_trunc('month', NOW())::date - INTERVAL '1 month' as month_start
        `);
        const monthStart = lastMonth.rows[0].month_start;
        
        const winners = await pool.query(`
            SELECT 
                u.first_name,
                ume.coins_earned as monthly_coins,
                ROW_NUMBER() OVER (ORDER BY ume.coins_earned DESC) as rank,
                to_char($1::date, 'Month YYYY') as month_label
            FROM user_monthly_earnings ume
            JOIN users u ON ume.user_id = u.id
            WHERE ume.month_year = $1 AND ume.coins_earned > 0
            ORDER BY ume.coins_earned DESC
            LIMIT 3
        `, [monthStart]);
        
        // Add prize amounts
        const prizes = { 1: 5000, 2: 3000, 3: 1000 };
        const result = winners.rows.map(w => ({
            ...w,
            prize_amount: prizes[w.rank] || 0
        }));
        
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// ADMIN: Previous Referral Winners (Most Recent Week With Referrals)
// ============================================
app.get('/api/admin/referral-winners', async (req, res) => {    try {
        // Find the most recent referral date
        const lastReferralDate = await pool.query(`
            SELECT MAX(created_at) as last_date FROM referrals
        `);
        
        if (!lastReferralDate.rows[0].last_date) {
            return res.json([]);
        }
        
        const lastDate = new Date(lastReferralDate.rows[0].last_date);
        const dayOfWeek = lastDate.getDay();
        let daysSinceMonday = dayOfWeek - 1;
        if (daysSinceMonday < 0) daysSinceMonday += 7;
        
        const weekStart = new Date(lastDate);
        weekStart.setDate(lastDate.getDate() - daysSinceMonday);
        weekStart.setHours(0, 0, 0, 0);
        
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        
        const weekStartStr = weekStart.toISOString();
        const weekEndStr = weekEnd.toISOString();
        
        const winners = await pool.query(`
            SELECT 
                u.first_name,
                COUNT(r.id) as weekly_referrals,
                to_char($1::date, 'Mon DD') || ' - ' || to_char($2::date, 'Mon DD, YYYY') as week_label
            FROM referrals r
            JOIN users u ON r.referrer_id = u.id
            WHERE r.created_at >= $1::timestamp 
              AND r.created_at <= $2::timestamp
            GROUP BY u.id, u.first_name
            ORDER BY weekly_referrals DESC
            LIMIT 3
        `, [weekStartStr, weekEndStr]);
        
        // Add proper prize amounts
        const prizeTiers = { 1: 10000, 2: 5000, 3: 2500 };
        const result = winners.rows.map((w, i) => ({
            ...w,
            rank: i + 1,
            prize_amount: prizeTiers[i + 1] || 0
        }));
        
        res.json(result);
    } catch (err) {
        console.error('Referral winners error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// ADMIN: Previous Team Winners (Last Month Only)
// ============================================
app.get('/api/admin/team-winners', async (req, res) => {    try {
        const lastMonth = await pool.query(`
            SELECT date_trunc('month', NOW())::date - INTERVAL '1 month' as month_start
        `);
        const monthStart = lastMonth.rows[0].month_start;
        
        const winners = await pool.query(`
            SELECT 
                t.name as team_name,
                COUNT(tm.id) as member_count,
                COALESCE(SUM(ume.coins_earned), 0) as monthly_coins,
                ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(ume.coins_earned), 0) DESC) as rank,
                to_char($1::date, 'Month YYYY') as month_label
            FROM teams t
            LEFT JOIN team_members tm ON t.id = tm.team_id
            LEFT JOIN users u ON tm.user_id = u.id
            LEFT JOIN user_monthly_earnings ume ON u.id = ume.user_id AND ume.month_year = $1
            GROUP BY t.id, t.name
            HAVING COUNT(tm.id) > 0
            ORDER BY monthly_coins DESC
            LIMIT 3
        `, [monthStart]);
        
        const prizes = { 1: 2500, 2: 1000, 3: 500 };
        const result = winners.rows.map(w => ({
            ...w,
            prize_amount: prizes[w.rank] || 0
        }));
        
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ============================================
// ADMIN: Top 10 Earners (All Time - Full List)
// ============================================
app.get('/api/admin/top-earners-full', async (req, res) => {  try {
    const result = await pool.query(`
      SELECT 
        u.id,
        u.first_name,
        u.username,
        u.photo_url,
        u.tier,
        u.coins as total_coins,
        u.referrals,
        ROW_NUMBER() OVER (ORDER BY u.coins DESC) as rank
      FROM users u
      WHERE u.coins > 0
      ORDER BY u.coins DESC
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) { 
    console.error('Top earners full error:', err);
    res.json([]); 
  }
});

// ============================================
// ADMIN: Bonus Codes Management
// ============================================
app.get('/api/admin/bonus-codes', verifyAdmin, async (req, res) => {
  try { 
    res.json(await pool.query('SELECT * FROM bonus_codes ORDER BY created_at DESC').then(r => r.rows)); 
  }
  catch (err) { 
    res.status(500).json({ error: 'Failed to fetch bonus codes' }); 
  }
});

app.post('/api/admin/bonus-codes', verifyAdmin, async (req, res) => {
  const { code, coins, description } = req.body;
  if (!code || coins === undefined) return res.status(400).json({ error: 'Code and coins required' });
  try {
    const r = await pool.query(
      'INSERT INTO bonus_codes (code, coins, description, is_active) VALUES ($1, $2, $3, true) RETURNING *',
      [code.toUpperCase(), coins, description || null]
    );
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Bonus code already exists' });
    console.error('Add bonus code error:', err);
    res.status(500).json({ error: 'Failed to add bonus code' });
  }
});

app.delete('/api/admin/bonus-codes/:code', verifyAdmin, async (req, res) => {
  try { 
    await pool.query('DELETE FROM bonus_codes WHERE code = $1', [req.params.code.toUpperCase()]); 
    res.json({ success: true }); 
  }
  catch (err) { 
    res.status(500).json({ error: 'Failed to delete' }); 
  }
});

// ============================================
// ADMIN: Today's Activity (Detailed) - FIXED
// ============================================
app.get('/api/admin/today-activity', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.photo_url,
        u.coins, u.tier, u.referrals,
        COALESCE(ads.total_ads, 0) as total_ads,
        COUNT(ar_today.id) as ads_today,
        COALESCE(ads.ads_week, 0) as ads_week,
        u.last_login_date,
        (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = u.id AND r.created_at >= (CURRENT_DATE AT TIME ZONE 'Africa/Lagos') AND r.created_at < (CURRENT_DATE AT TIME ZONE 'Africa/Lagos' + INTERVAL '1 day')) as referrals_today
      FROM users u
      LEFT JOIN ad_statistics ads ON u.id = ads.user_id
      LEFT JOIN ad_rewards ar_today ON u.id = ar_today.user_id 
        AND ar_today.ad_type = 'ad'
        AND ar_today.created_at >= (CURRENT_DATE AT TIME ZONE 'Africa/Lagos')
        AND ar_today.created_at < (CURRENT_DATE AT TIME ZONE 'Africa/Lagos' + INTERVAL '1 day')
      WHERE ar_today.id IS NOT NULL
      GROUP BY u.id, ads.total_ads, ads.ads_week
      ORDER BY ads_today DESC, u.coins DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Today activity error:', err);
    res.status(500).json({ error: 'Failed to fetch today activity' });
  }
});

// ============================================
// ADMIN: Today's User Activity (Detailed) - FIXED
// ============================================
app.get('/api/admin/today-user-activity', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.photo_url,
        u.coins, u.tier,
        COALESCE(ads.total_ads, 0) as total_ads,
        COUNT(ar_today.id) as ads_today,
        COALESCE(SUM(ar_today.reward_amount), 0) as coins_earned_today,
        (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = u.id AND r.created_at >= (CURRENT_DATE AT TIME ZONE 'Africa/Lagos') AND r.created_at < (CURRENT_DATE AT TIME ZONE 'Africa/Lagos' + INTERVAL '1 day')) as referrals_today
      FROM users u
      LEFT JOIN ad_statistics ads ON u.id = ads.user_id
      LEFT JOIN ad_rewards ar_today ON u.id = ar_today.user_id 
        AND ar_today.ad_type = 'ad'
        AND ar_today.created_at >= (CURRENT_DATE AT TIME ZONE 'Africa/Lagos')
        AND ar_today.created_at < (CURRENT_DATE AT TIME ZONE 'Africa/Lagos' + INTERVAL '1 day')
      WHERE ar_today.id IS NOT NULL
      GROUP BY u.id, ads.total_ads
      ORDER BY coins_earned_today DESC, ads_today DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Today user activity error:', err);
    res.status(500).json({ error: 'Failed to fetch today user activity' });
  }
});

// ============================================
// ADMIN: Top Referrers (All Time)
// ============================================
app.get('/api/admin/top-referrers', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.photo_url,
        u.referrals, u.coins, u.tier
      FROM users u
      WHERE u.referrals > 0
      ORDER BY u.referrals DESC
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Top referrers error:', err);
    res.status(500).json({ error: 'Failed to fetch top referrers' });
  }
});

// ============================================
// ADMIN: Daily Active Users (Last 7 Days)
// ============================================
app.get('/api/admin/daily-active', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        last_login_date,
        COUNT(*) as count
      FROM users 
      WHERE last_login_date >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY last_login_date 
      ORDER BY last_login_date DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Daily active error:', err);
    res.status(500).json({ error: 'Failed to fetch daily active' });
  }
});

// ============================================
// ADMIN: Broadcast to Users + Channel
// ============================================
app.post('/api/admin/broadcast', verifyAdmin, async (req, res) => {
  const { message, imageUrl, videoUrl, buttons, target } = req.body;
  const CHANNEL_USERNAME = '@YzemanEarnBotChannel';
  
  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message is required' });
  }
  
  try {
    const BOT_TOKEN = process.env.BOT_TOKEN;
    if (!BOT_TOKEN) {
      return res.status(500).json({ error: 'Bot token not configured' });
    }
    
    // Build inline keyboard
    // Users → web_app (opens mini app directly)
    // Channel → url (opens bot with /start, user taps Open App)
    function buildKeyboard(forChannel) {
      const inlineKeyboard = [];
      if (buttons && buttons.length > 0) {
        const row = buttons.map(btn => {
          if (forChannel) {
            return { text: btn.text, url: 'https://t.me/YzemanBot?start=app' };
          } else {
            return { text: btn.text, web_app: { url: btn.url } };
          }
        });
        inlineKeyboard.push(row);
      }
      return inlineKeyboard;
    }
    
    const result = {
      success: true,
      usersSent: 0,
      usersFailed: 0,
      failedUsers: [],  // ✅ Collect failed user IDs
      channelSent: false
    };
    
    async function sendTelegramMessage(chatId, isChannel = false) {
      let method = 'sendMessage';
      const telegramBody = {
        chat_id: chatId,
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      };
      
      if (videoUrl) {
        method = 'sendVideo';
        telegramBody.video = videoUrl;
        telegramBody.caption = message;
        telegramBody.supports_streaming = true;
      } else if (imageUrl) {
        method = 'sendPhoto';
        telegramBody.photo = imageUrl;
        telegramBody.caption = message;
      } else {
        telegramBody.text = message;
      }
      
      const keyboard = buildKeyboard(isChannel);
      if (keyboard.length > 0) {
        telegramBody.reply_markup = { inline_keyboard: keyboard };
      }
      
      const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(telegramBody)
      });
      
      return response.json();
    }
    
    // ============================================
    // SEND TO USERS
    // ============================================
    if (target === 'users' || target === 'both') {
      const users = await pool.query('SELECT telegram_id FROM users WHERE telegram_id IS NOT NULL');
      
      for (const user of users.rows) {
        try {
          const res = await sendTelegramMessage(user.telegram_id, false);
          if (res.ok) {
            result.usersSent++;
          } else {
            result.usersFailed++;
            result.failedUsers.push(user.telegram_id);  // ✅ Save failed ID
          }
        } catch (err) {
          result.usersFailed++;
          result.failedUsers.push(user.telegram_id);  // ✅ Save failed ID
        }
        await new Promise(r => setTimeout(r, 50));
      }
    }
    
    // ============================================
    // SEND TO CHANNEL
    // ============================================
    if (target === 'channel' || target === 'both') {
      try {
        const channelRes = await sendTelegramMessage(CHANNEL_USERNAME, true);
        result.channelSent = channelRes.ok;
      } catch (err) {
        result.channelSent = false;
      }
    }
    
    console.log(`📢 Broadcast: Users=${result.usersSent}/${result.usersSent + result.usersFailed}, Failed=${result.usersFailed}`);
    console.log(`❌ Failed IDs:`, result.failedUsers.join(', '));  // ✅ Log to console
    
    res.json(result);
    
  } catch (err) {
    console.error('Broadcast error:', err);
    res.status(500).json({ error: 'Failed to send broadcast: ' + err.message });
  }
});

// ============================================
// TEST BROADCAST - Users + Channel
// ============================================
app.post('/api/admin/test-broadcast', async (req, res) => {
  try {
    const { message, imageUrl, videoUrl, testTelegramId, buttons, target } = req.body;
    const BOT_TOKEN = process.env.BOT_TOKEN;
    const CHANNEL_USERNAME = '@YzemanEarnBotChannel';
    
    if (!BOT_TOKEN) {
      return res.status(500).json({ error: 'Bot token not configured' });
    }
    
    const isChannel = target === 'channel';
    const chatId = isChannel ? CHANNEL_USERNAME : parseInt(testTelegramId);
    
    // Build inline keyboard
    const inlineKeyboard = [];
    if (buttons && buttons.length > 0) {
      const row = buttons.map(btn => {
        if (isChannel) {
          return { text: btn.text, url: 'https://t.me/YzemanBot?start=app' };
        } else {
          return { text: btn.text, web_app: { url: btn.url } };
        }
      });
      inlineKeyboard.push(row);
    }
    
    let method = 'sendMessage';
    const telegramBody = {
      chat_id: chatId,
      parse_mode: 'Markdown',
      disable_web_page_preview: false
    };
    
    if (videoUrl) {
      method = 'sendVideo';
      telegramBody.video = videoUrl;
      telegramBody.caption = message;
      telegramBody.supports_streaming = true;
    } else if (imageUrl) {
      method = 'sendPhoto';
      telegramBody.photo = imageUrl;
      telegramBody.caption = message;
    } else {
      telegramBody.text = message;
    }
    
    if (inlineKeyboard.length > 0) {
      telegramBody.reply_markup = { inline_keyboard: inlineKeyboard };
    }
    
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telegramBody)
    });
    
    const result = await response.json();
    
    if (result.ok) {
      res.json({ success: true });
    } else {
      res.json({ success: false, error: result.description });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ============================================
// ADMIN: Award Monthly Prizes (Based on THIS Month's Earnings)
// ============================================
app.post('/api/admin/award-monthly-prizes', verifyAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    
    const topEarners = await client.query(`
      SELECT u.id, u.first_name, u.telegram_id, COALESCE(SUM(ar.reward_amount), 0) as monthly_coins
      FROM users u
      LEFT JOIN ad_rewards ar ON u.id = ar.user_id 
        AND ar.created_at >= $1
        AND ar.ad_type IN ('ad', 'daily', 'wheel', 'achievement', 'task', 'referral_commission', 'bonus', 'admin_add')
      GROUP BY u.id
      ORDER BY monthly_coins DESC
      LIMIT 3
    `, [firstOfMonth]);
    
    const prizes = [20000, 10000, 5000];
    
    for (let i = 0; i < topEarners.rows.length; i++) {
      const user = topEarners.rows[i];
      const prize = prizes[i];
      const rank = i + 1;
      
      if (user.monthly_coins > 0) {
        // Update user's coin balance
        await client.query(
          'UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
          [prize, user.id]
        );
        
        // Track in ad_rewards
        await client.query(
          'INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)',
          [user.id, prize, 'leaderboard_prize']
        );
        
        // ✅ AWARD ACHIEVEMENTS
        await awardAchievement(user.id, 'Leaderboard Winner', client);
        if (rank === 1) {
          await awardAchievement(user.id, 'Monthly Top Earner', client);
        }
        
        // Send notification
        await sendPrizeNotification(user.telegram_id, 'leaderboard', prize, rank);
        
        console.log(`🏆 Monthly prize: ${prize} COINS awarded to ${user.first_name} (rank #${rank})`);
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
// ADMIN: Award Weekly Prizes (FIXED - Current Week)
// ============================================
app.post('/api/admin/award-weekly-prizes', verifyAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    // ✅ Only run on Sundays
    const today = new Date();
    if (today.getDay() !== 0) {
      return res.json({ success: false, error: 'Weekly prizes can only be awarded on Sundays' });
    }
    
    // ✅ Calculate THIS week (Monday to Sunday)
    const thisSunday = new Date(today);
    thisSunday.setHours(23, 59, 59, 999);
    const sundayStr = thisSunday.toISOString().split('T')[0];
    
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() - 6);
    thisMonday.setHours(0, 0, 0, 0);
    const mondayStr = thisMonday.toISOString().split('T')[0];
    
    console.log(`📅 Referral week: ${mondayStr} to ${sundayStr}`);
    
    // ✅ Check if prizes already awarded for this week
    const alreadyAwarded = await client.query(`
      SELECT COUNT(*) FROM ad_rewards 
      WHERE ad_type = 'weekly_prize' 
      AND created_at::date = $1
    `, [sundayStr]);
    
    if (parseInt(alreadyAwarded.rows[0].count) > 0) {
      return res.json({ success: false, error: 'Prizes already awarded for this week' });
    }
    
    await client.query('BEGIN');
    
    const topReferrers = await client.query(`
      SELECT u.id, u.first_name, u.telegram_id, COUNT(r.id) as referral_count
      FROM users u
      LEFT JOIN referrals r ON u.id = r.referrer_id 
        AND r.created_at::date >= $1::date
        AND r.created_at::date <= $2::date
      GROUP BY u.id
      HAVING COUNT(r.id) > 0
      ORDER BY referral_count DESC
      LIMIT 3
    `, [mondayStr, sundayStr]);
    
    const prizes = [10000, 5000, 2500];
    
    for (let i = 0; i < topReferrers.rows.length; i++) {
      const user = topReferrers.rows[i];
      const prize = prizes[i];
      const rank = i + 1;
      
      if (user.referral_count > 0) {
        await client.query(
          'UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
          [prize, user.id]
        );
        await client.query(
          'INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)',
          [user.id, prize, 'weekly_prize']
        );
        
        const extraInfo = `\n\n📊 You referred *${user.referral_count} friends* this week!`;
        await sendPrizeNotification(user.telegram_id, 'referral', prize, rank, extraInfo);
        
        console.log(`🏆 Weekly referral prize: ${prize} COINS awarded to ${user.first_name} (${user.referral_count} referrals)`);
      }
    }
    
    await client.query('COMMIT');
    res.json({ success: true, awarded: topReferrers.rows.length, week: `${mondayStr} to ${sundayStr}` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Award weekly error:', err);
    res.status(500).json({ error: 'Failed to award weekly prizes' });
  } finally {
    client.release();
  }
});

// TEMPORARY: Test weekly prize endpoint via GET (FIXED DATE)
app.get('/api/admin/test-weekly-prizes', async (req, res) => {  try {
    const now = new Date();
    // Today is Sunday May 18. Last week: Monday May 11 - Sunday May 17
    const today = new Date();
    const currentDay = today.getDay(); // 0=Sunday, 1=Monday...
    
    // Last Sunday (end of last week) = today or most recent Sunday
    const lastSunday = new Date(today);
    lastSunday.setDate(today.getDate() - currentDay);
    lastSunday.setHours(23, 59, 59, 999);
    const lastSundayStr = lastSunday.toISOString().split('T')[0];
    
    // Last Monday (start of last week) = 6 days before last Sunday
    const lastMonday = new Date(lastSunday);
    lastMonday.setDate(lastSunday.getDate() - 6);
    lastMonday.setHours(0, 0, 0, 0);
    const lastMondayStr = lastMonday.toISOString().split('T')[0];
    
    const topReferrers = await pool.query(`
      SELECT u.first_name, COUNT(r.id) as referral_count
      FROM users u
      LEFT JOIN referrals r ON u.id = r.referrer_id 
        AND DATE(r.created_at AT TIME ZONE 'Africa/Lagos') >= $1
        AND DATE(r.created_at AT TIME ZONE 'Africa/Lagos') <= $2
      GROUP BY u.id, u.first_name
      HAVING COUNT(r.id) > 0
      ORDER BY referral_count DESC
      LIMIT 3
    `, [lastMondayStr, lastSundayStr]);
    
    res.json({
      today: today.toISOString().split('T')[0],
      currentDay: currentDay,
      week: `${lastMondayStr} to ${lastSundayStr}`,
      top_referrers: topReferrers.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ============================================
// ADMIN: Award Tournament Prizes (Every Monday Midnight)
// ============================================
app.post('/api/admin/award-tournament-prizes', verifyAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const now = new Date();
    const dayOfWeek = now.getDay();
    let daysSinceMonday = dayOfWeek - 1;
    if (daysSinceMonday < 0) daysSinceMonday += 7;
    
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - daysSinceMonday);
    lastMonday.setHours(0, 0, 0, 0);
    const lastMondayStr = lastMonday.toISOString().split('T')[0];
    
    const tournament = await client.query(
      'SELECT id FROM weekly_tournaments WHERE week_start = $1',
      [lastMondayStr]
    );
    
    if (tournament.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: true, message: 'No tournament found for this week' });
    }
    
    const tournamentId = tournament.rows[0].id;
    
    const topParticipants = await client.query(`
  SELECT 
    u.id, u.first_name, u.telegram_id,
    COALESCE(SUM(ar.reward_amount), 0) as weekly_coins
  FROM tournament_participants tp
  JOIN users u ON tp.user_id = u.id
  LEFT JOIN ad_rewards ar ON u.id = ar.user_id 
    AND ar.created_at >= $2
    AND ar.created_at < ($3::date + 1)::timestamp
    AND ar.ad_type IN ('ad', 'daily', 'wheel', 'task')
  WHERE tp.tournament_id = $1
  GROUP BY u.id
  ORDER BY weekly_coins DESC
  LIMIT 3
`, [tournamentId, lastMondayStr, now.toISOString()]);
      
    const prizes = [8000, 5000, 3000];
    
    for (let i = 0; i < topParticipants.rows.length; i++) {
      const user = topParticipants.rows[i];
      const prize = prizes[i];
      const rank = i + 1;
      
      if (user.weekly_coins > 0) {
        // Update user's coin balance
        await client.query(
          'UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
          [prize, user.id]
        );
        
        // Track in ad_rewards
        await client.query(
          'INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)',
          [user.id, prize, 'tournament_prize']
        );
        
        // Mark as awarded
        await client.query(
          'UPDATE tournament_participants SET prize_awarded = true, rank = $1 WHERE tournament_id = $2 AND user_id = $3',
          [rank, tournamentId, user.id]
        );
        
        // ✅ AWARD ACHIEVEMENT
        if (rank === 1) {
          await awardAchievement(user.id, 'Tournament Winner', client);
        }
        
        // Send notification
        await sendPrizeNotification(user.telegram_id, 'tournament', prize, rank);
        
        console.log(`🏆 Tournament prize: ${prize} COINS awarded to ${user.first_name} (rank #${rank})`);
      }
    }
    
    // Mark tournament as inactive
    await client.query('UPDATE weekly_tournaments SET is_active = false WHERE id = $1', [tournamentId]);
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
// ADMIN: Award Team Monthly Prizes (1st of Month @ Midnight)
// Teams stay intact – only monthly coins reset
// ============================================
app.post('/api/admin/award-team-prizes', verifyAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    
    console.log(`🏆 Awarding team prizes for month starting ${currentMonth}...`);
    
    // Get top 3 teams based on THIS month's earnings
    const topTeams = await client.query(`
      SELECT 
        t.id, t.name,
        COALESCE(SUM(ume.coins_earned), 0) as monthly_coins
      FROM teams t
      JOIN team_members tm ON t.id = tm.team_id
      JOIN users u ON tm.user_id = u.id
      LEFT JOIN user_monthly_earnings ume ON u.id = ume.user_id AND ume.month_year = $1
      GROUP BY t.id
      ORDER BY monthly_coins DESC
      LIMIT 3
    `, [currentMonth]);
    
    if (topTeams.rows.length === 0) {
      await client.query('ROLLBACK');
      console.log('ℹ️ No teams found for monthly prize');
      return res.json({ success: true, message: 'No teams to award', awarded: 0 });
    }
    
    const prizes = [12000, 6000, 3000];
    let totalAwarded = 0;
    
    for (let i = 0; i < topTeams.rows.length; i++) {
      const team = topTeams.rows[i];
      const prizePerMember = prizes[i];
      const rank = i + 1;
      
      if (team.monthly_coins <= 0) {
        console.log(`⚠️ Team ${team.name} has 0 monthly coins, skipping prize`);
        continue;
      }
      
      // Get all current team members
      const members = await client.query(
        `SELECT u.id, u.first_name, u.telegram_id 
         FROM team_members tm 
         JOIN users u ON tm.user_id = u.id 
         WHERE tm.team_id = $1`,
        [team.id]
      );
      
      console.log(`🏆 Team "${team.name}" placed #${rank} with ${team.monthly_coins} monthly coins`);
      console.log(`   Awarding ${prizePerMember} COINS to ${members.rows.length} members...`);
      
      for (const member of members.rows) {
        // Award prize to each member
        await client.query(
          'UPDATE users SET coins = coins + $1, total_coins_earned = total_coins_earned + $1 WHERE id = $2',
          [prizePerMember, member.id]
        );
        
        // Track prize in ad_rewards
        await client.query(
          'INSERT INTO ad_rewards (user_id, reward_amount, ad_type) VALUES ($1, $2, $3)',
          [member.id, prizePerMember, 'team_prize']
        );
        
        // ✅ AWARD ACHIEVEMENT
        await awardAchievement(member.id, 'Team Winner', client);
        
        totalAwarded++;
        
        // Send Telegram notification
        const BOT_TOKEN = process.env.BOT_TOKEN;
        if (BOT_TOKEN && member.telegram_id) {
          const message = `🎉 *CONGRATULATIONS!* 🎉\n\n` +
            `Your team *${team.name}* placed *#${rank}* in this month's team competition!\n\n` +
            `🏆 You've been awarded *+${prizePerMember} COINS*!\n\n` +
            `🏅 Achievement Unlocked: *Team Winner* (+5,000 COINS)\n\n` +
            `Keep earning with your team to win again next month! 🚀`;
          
          try {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: member.telegram_id,
                text: message,
                parse_mode: 'Markdown'
              })
            });
          } catch (e) {
            console.error(`Failed to notify member ${member.telegram_id}:`, e.message);
          }
        }
      }
    }
    
    await client.query('COMMIT');
    
    console.log(`✅ Team prizes awarded successfully! Total members awarded: ${totalAwarded}`);
    res.json({ 
      success: true, 
      awarded: totalAwarded,
      teams: topTeams.rows.map((t, i) => ({ name: t.name, place: i + 1, prize: prizes[i] }))
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Award team prizes error:', err);
    res.status(500).json({ error: 'Failed to award team prizes: ' + err.message });
  } finally {
    client.release();
  }
});

app.get('/api/admin/db-size', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                pg_size_pretty(pg_database_size(current_database())) as total_size,
                (SELECT COUNT(*) FROM users) as users,
                (SELECT COUNT(*) FROM team_messages) as messages,
                (SELECT COUNT(*) FROM ad_rewards) as ad_rewards_count
        `);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/db-size-detail', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                pg_size_pretty(pg_database_size(current_database())) as total_size,
                pg_size_pretty(pg_total_relation_size('users')) as users_table,
                pg_size_pretty(pg_total_relation_size('team_messages')) as team_messages,
                pg_size_pretty(pg_total_relation_size('ad_rewards')) as ad_rewards,
                pg_size_pretty(pg_total_relation_size('referral_commissions')) as referral_commissions,
                pg_size_pretty(pg_total_relation_size('private_messages')) as private_messages,
                (SELECT COUNT(*) FROM users) as user_count,
                (SELECT COUNT(*) FROM team_messages) as message_count,
                (SELECT COUNT(*) FROM ad_rewards) as ad_reward_count
        `);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// FRIENDS SYSTEM API ENDPOINTS
// ============================================

// Get user's friends list with total count
app.post('/api/friends/list', verifyTelegramData, async (req, res) => {
    try {
        const telegramId = req.telegramUser.id;
        const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        if (userResult.rows.length === 0) return res.json({ friends: [], total_friends: 0 });
        const userId = userResult.rows[0].id;
        
        // Get friends where status is accepted
        const friends = await pool.query(`
            SELECT 
                u.id, u.first_name, u.username, u.photo_url, u.tier, u.coins,
                to_char(u.last_seen, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_seen,
                COALESCE(ubs.total_blocks_received, 0) as total_blocks_received,
                50 - COALESCE(ubs.total_blocks_received, 0) * 5 as trust_score
            FROM friends f
            JOIN users u ON (f.friend_id = u.id)
            LEFT JOIN user_block_stats ubs ON u.id = ubs.user_id
            WHERE f.user_id = $1 AND f.status = 'accepted'
            UNION
            SELECT 
                u.id, u.first_name, u.username, u.photo_url, u.tier, u.coins,
                to_char(u.last_seen, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_seen,
                COALESCE(ubs.total_blocks_received, 0) as total_blocks_received,
                50 - COALESCE(ubs.total_blocks_received, 0) * 5 as trust_score
            FROM friends f
            JOIN users u ON (f.user_id = u.id)
            LEFT JOIN user_block_stats ubs ON u.id = ubs.user_id
            WHERE f.friend_id = $1 AND f.status = 'accepted'
        `, [userId]);
        
        const totalFriends = friends.rows.length;
        
        // Update the user's total_friends in the users table
        await pool.query(`
            UPDATE users SET total_friends = $1 WHERE id = $2
        `, [totalFriends, userId]);
        
        res.json({ friends: friends.rows, total_friends: totalFriends });
    } catch (err) {
        console.error('Friends list error:', err);
        res.status(500).json({ error: 'Failed to fetch friends: ' + err.message });
    }
});

// Get pending friend requests
app.post('/api/friends/requests', verifyTelegramData, async (req, res) => {
    try {
        const telegramId = req.telegramUser.id;
        const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        if (userResult.rows.length === 0) return res.json({ requests: [] });
        const userId = userResult.rows[0].id;
        
        const requests = await pool.query(`
            SELECT 
                u.id, u.first_name, u.username, u.photo_url, u.tier,
                COALESCE(ubs.total_blocks_received, 0) as total_blocks_received,
                50 - COALESCE(ubs.total_blocks_received, 0) * 5 as trust_score
            FROM friends f
            JOIN users u ON f.user_id = u.id
            LEFT JOIN user_block_stats ubs ON u.id = ubs.user_id
            WHERE f.friend_id = $1 AND f.status = 'pending'
        `, [userId]);
        
        res.json({ requests: requests.rows });
    } catch (err) {
        console.error('Friend requests error:', err);
        res.status(500).json({ error: 'Failed to fetch requests' });
    }
});

// Send friend request
app.post('/api/friends/request', verifyTelegramData, async (req, res) => {
    const { friendId } = req.body;
    const client = await pool.connect();
    try {
        const telegramId = req.telegramUser.id;
        const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const userId = userResult.rows[0].id;
        
        if (userId === friendId) {
            return res.status(400).json({ error: 'Cannot add yourself as friend' });
        }
        
        // Check if already friends or pending
        const existing = await client.query(`
            SELECT * FROM friends 
            WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)
        `, [userId, friendId]);
        
        if (existing.rows.length > 0) {
            const status = existing.rows[0].status;
            if (status === 'accepted') return res.status(400).json({ error: 'Already friends' });
            if (status === 'pending') return res.status(400).json({ error: 'Friend request already pending' });
            if (status === 'blocked') return res.status(400).json({ error: 'Cannot send request to blocked user' });
        }
        
        await client.query('BEGIN');
        
        await client.query(`
            INSERT INTO friends (user_id, friend_id, status)
            VALUES ($1, $2, 'pending')
        `, [userId, friendId]);
        
        await client.query('COMMIT');
        res.json({ success: true, message: 'Friend request sent!' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Friend request error:', err);
        res.status(500).json({ error: 'Failed to send request' });
    } finally {
        client.release();
    }
});

// Accept friend request
app.post('/api/friends/accept', verifyTelegramData, async (req, res) => {
    const { friendId } = req.body;
    const client = await pool.connect();
    try {
        const telegramId = req.telegramUser.id;
        const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const userId = userResult.rows[0].id;
        
        await client.query('BEGIN');
        
        const result = await client.query(`
            UPDATE friends 
            SET status = 'accepted', updated_at = NOW()
            WHERE friend_id = $1 AND user_id = $2 AND status = 'pending'
            RETURNING *
        `, [userId, friendId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Friend request not found' });
        }
        
        await client.query('COMMIT');
        res.json({ success: true, message: 'Friend request accepted!' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Accept friend error:', err);
        res.status(500).json({ error: 'Failed to accept request' });
    } finally {
        client.release();
    }
});

// Reject friend request
app.post('/api/friends/reject', verifyTelegramData, async (req, res) => {
    const { friendId } = req.body;
    try {
        const telegramId = req.telegramUser.id;
        const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const userId = userResult.rows[0].id;
        
        await pool.query(`
            DELETE FROM friends
            WHERE friend_id = $1 AND user_id = $2 AND status = 'pending'
        `, [userId, friendId]);
        
        res.json({ success: true, message: 'Friend request rejected' });
    } catch (err) {
        console.error('Reject friend error:', err);
        res.status(500).json({ error: 'Failed to reject request' });
    }
});

// Block user
app.post('/api/friends/block', verifyTelegramData, async (req, res) => {
    const { friendId } = req.body;
    const client = await pool.connect();
    try {
        const telegramId = req.telegramUser.id;
        const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const userId = userResult.rows[0].id;
        
        await client.query('BEGIN');
        
        // Delete any existing friendship
        await client.query(`
            DELETE FROM friends 
            WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)
        `, [userId, friendId]);
        
        // Add as blocked
        await client.query(`
            INSERT INTO friends (user_id, friend_id, status)
            VALUES ($1, $2, 'blocked')
            ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'blocked'
        `, [userId, friendId]);
        
        // Update block stats for the blocked user
        await client.query(`
            INSERT INTO user_block_stats (user_id, total_blocks_received, total_blocks_given)
            VALUES ($1, 1, 0)
            ON CONFLICT (user_id) DO UPDATE SET 
                total_blocks_received = user_block_stats.total_blocks_received + 1,
                updated_at = NOW()
        `, [friendId]);
        
        await client.query('COMMIT');
        res.json({ success: true, message: 'User blocked' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Block user error:', err);
        res.status(500).json({ error: 'Failed to block user' });
    } finally {
        client.release();
    }
});

// Search users
app.post('/api/users/search', verifyTelegramData, async (req, res) => {
    const { query } = req.body;
    try {
        const telegramId = req.telegramUser.id;
        const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        if (userResult.rows.length === 0) return res.json({ users: [] });
        const userId = userResult.rows[0].id;
        
        const users = await pool.query(`
            SELECT 
                u.id, u.first_name, u.username, u.photo_url, u.tier,
                COALESCE(ubs.total_blocks_received, 0) as total_blocks_received,
                50 - COALESCE(ubs.total_blocks_received, 0) * 5 as trust_score,
                CASE 
                    WHEN f.status = 'accepted' THEN 'friends'
                    WHEN f.status = 'pending' AND f.user_id = $1 THEN 'pending_sent'
                    WHEN f.status = 'pending' AND f.friend_id = $1 THEN 'pending_received'
                    WHEN f.status = 'blocked' THEN 'blocked'
                    ELSE 'none'
                END as relationship
            FROM users u
            LEFT JOIN friends f ON (f.user_id = $1 AND f.friend_id = u.id) OR (f.friend_id = $1 AND f.user_id = u.id)
            LEFT JOIN user_block_stats ubs ON u.id = ubs.user_id
            WHERE u.id != $1
            AND (u.first_name ILIKE $2 OR u.username ILIKE $2)
            LIMIT 20
        `, [userId, `%${query}%`]);
        
        res.json({ users: users.rows });
    } catch (err) {
        console.error('Search users error:', err);
        res.status(500).json({ error: 'Failed to search users' });
    }
});

// Get user relationship status
app.post('/api/friends/relationship', verifyTelegramData, async (req, res) => {
    const { friendId } = req.body;
    try {
        const telegramId = req.telegramUser.id;
        const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        if (userResult.rows.length === 0) return res.json({ is_friend: false, status: 'none' });
        const userId = userResult.rows[0].id;
        
        const result = await pool.query(`
            SELECT status FROM friends 
            WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)
        `, [userId, friendId]);
        
        if (result.rows.length === 0) {
            return res.json({ is_friend: false, status: 'none' });
        }
        
        const status = result.rows[0].status;
        let isFriend = status === 'accepted';
        let relationshipStatus = status;
        
        // Determine direction of pending request
        if (status === 'pending') {
            const checkDirection = await pool.query(`
                SELECT user_id FROM friends WHERE user_id = $1 AND friend_id = $2
            `, [userId, friendId]);
            relationshipStatus = checkDirection.rows.length > 0 ? 'pending_sent' : 'pending_received';
        }
        
        res.json({ is_friend: isFriend, status: relationshipStatus });
    } catch (err) {
        console.error('Relationship error:', err);
        res.json({ is_friend: false, status: 'none' });
    }
});

// Get user profile by ID (for friends only)
app.post('/api/user/profile', verifyTelegramData, async (req, res) => {
    const { userId } = req.body;
    try {
        const telegramId = req.telegramUser.id;
        const requestorResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        if (requestorResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const requestorId = requestorResult.rows[0].id;
        
        // Check if they are friends
        const friendCheck = await pool.query(`
            SELECT status FROM friends 
            WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)
        `, [requestorId, userId]);
        
        const isFriend = friendCheck.rows.length > 0 && friendCheck.rows[0].status === 'accepted';
        
        if (!isFriend && requestorId !== userId) {
            return res.status(403).json({ error: 'Profile only visible to friends' });
        }
        
        const userResult = await pool.query(`
            SELECT id, first_name, username, photo_url, tier, coins, referrals, total_coins_earned,
                   COALESCE(ubs.total_blocks_received, 0) as total_blocks_received,
                   (SELECT COUNT(*) FROM friends WHERE (user_id = u.id OR friend_id = u.id) AND status = 'accepted') as total_friends
            FROM users u
            LEFT JOIN user_block_stats ubs ON u.id = ubs.user_id
            WHERE u.id = $1
        `, [userId]);
        
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        
        res.json(userResult.rows[0]);
    } catch (err) {
        console.error('User profile error:', err);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// ============================================
// GET UNREAD PRIVATE MESSAGES COUNT
// ============================================
app.post('/api/private/messages/unread', verifyTelegramData, async (req, res) => {
    try {
        const telegramId = req.telegramUser.id;
        const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        if (userResult.rows.length === 0) return res.json({ unread_count: 0 });
        const userId = userResult.rows[0].id;
        
        const result = await pool.query(`
            SELECT COUNT(*) as count 
            FROM private_messages 
            WHERE receiver_id = $1 AND is_read = false AND is_deleted = FALSE
        `, [userId]);
        
        res.json({ unread_count: parseInt(result.rows[0].count) });
    } catch (err) {
        console.error('Unread messages error:', err);
        res.json({ unread_count: 0 });
    }
});

// Get unread message counts per friend
app.post('/api/private/messages/unread-by-friend', verifyTelegramData, async (req, res) => {
    try {
        const telegramId = req.telegramUser.id;
        const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        if (userResult.rows.length === 0) return res.json({ unread_counts: {} });
        const userId = userResult.rows[0].id;
        
        const result = await pool.query(`
            SELECT 
                sender_id,
                COUNT(*) as unread_count
            FROM private_messages 
            WHERE receiver_id = $1 AND is_read = false AND is_deleted = FALSE
            GROUP BY sender_id
        `, [userId]);
        
        const unreadCounts = {};
        result.rows.forEach(row => {
            unreadCounts[row.sender_id] = parseInt(row.unread_count);
        });
        
        res.json({ unread_counts: unreadCounts });
    } catch (err) {
        console.error('Unread by friend error:', err);
        res.json({ unread_counts: {} });
    }
});

// ============================================
// PRIVATE MESSAGES API ENDPOINTS
// ============================================

// Get message history between two users
app.post('/api/private/messages/history', verifyTelegramData, async (req, res) => {
    const friendId=Number(req.body?.friendId);
    try {
        const userResult=await pool.query('SELECT id FROM users WHERE telegram_id=$1',[req.telegramUser.id]);
        if(!userResult.rows.length)return res.json({messages:[]});
        if(!Number.isInteger(friendId)||friendId<=0)return res.status(400).json({error:'Invalid friend'});
        const userId=userResult.rows[0].id;
        const friendship=await pool.query(`
            SELECT 1 FROM friends WHERE status='accepted'
            AND ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) LIMIT 1
        `,[userId,friendId]);
        if(!friendship.rows.length)return res.status(403).json({error:'Private chat is only available between accepted friends'});
        const newlyRead = await pool.query(`
            UPDATE private_messages
            SET delivered_at=COALESCE(delivered_at,NOW()), is_read=TRUE
            WHERE receiver_id=$1 AND sender_id=$2 AND is_read=FALSE AND is_deleted=FALSE
            RETURNING id
        `,[userId,friendId]);
        const chatId=[Number(userId),Number(friendId)].sort((a,b)=>a-b).join('-');
        if(newlyRead.rows.length) io.to(`private_${chatId}`).emit('private-message-status',{
            messageIds:newlyRead.rows.map(row=>row.id),status:'read',recipientId:userId
        });
        const messages=await pool.query(`
            SELECT pm.*,u1.first_name AS sender_name,u2.first_name AS receiver_name
            FROM private_messages pm
            JOIN users u1 ON pm.sender_id=u1.id
            JOIN users u2 ON pm.receiver_id=u2.id
            WHERE (pm.sender_id=$1 AND pm.receiver_id=$2) OR (pm.sender_id=$2 AND pm.receiver_id=$1)
            ORDER BY pm.created_at ASC LIMIT 100
        `,[userId,friendId]);
        res.json({messages:messages.rows});
    }catch(err){
        console.error('Message history error:',err);
        res.status(500).json({error:'Failed to fetch messages'});
    }
});

// Mark message as read
app.post('/api/private/messages/status', verifyTelegramData, async (req, res) => {
    try {
        const friendId=Number(req.body?.friendId);
        const user=await pool.query('SELECT id FROM users WHERE telegram_id=$1',[req.telegramUser.id]);
        if(!user.rows.length||!Number.isInteger(friendId)||friendId<=0)return res.status(400).json({error:'Invalid friend'});
        const userId=user.rows[0].id;
        const relation=await pool.query(`SELECT 1 FROM friends WHERE status='accepted' AND ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) LIMIT 1`,[userId,friendId]);
        if(!relation.rows.length)return res.status(403).json({error:'Friendship required'});
        const online=Array.from(presenceSockets.values()).some(p=>String(p.userId)===String(friendId));
        const last=await pool.query(`SELECT to_char(last_seen,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_seen FROM users WHERE id=$1`,[friendId]);
        res.json({online,last_seen:online?null:(last.rows[0]?.last_seen||null)});
    }catch(err){console.error('Private chat status error:',err);res.status(500).json({error:'Failed to fetch friend status'});}
});

app.post('/api/private/messages/mark-read', verifyTelegramData, async (req, res) => {
    const messageId=Number(req.body?.messageId);
    try {
        const user=await pool.query('SELECT id FROM users WHERE telegram_id=$1',[req.telegramUser.id]);
        if(!user.rows.length||!Number.isInteger(messageId))return res.status(400).json({success:false});
        const result=await pool.query('UPDATE private_messages SET delivered_at=COALESCE(delivered_at,NOW()),is_read=true WHERE id=$1 AND receiver_id=$2 AND is_deleted=FALSE RETURNING id,sender_id,receiver_id',[messageId,user.rows[0].id]);
        if(result.rows.length){
            const row=result.rows[0];
            const chatId=[Number(row.sender_id),Number(row.receiver_id)].sort((a,b)=>a-b).join('-');
            io.to(`private_${chatId}`).emit('private-message-status',{messageIds:[row.id],status:'read',recipientId:row.receiver_id});
        }
        res.json({success:result.rows.length>0});
    }catch(err){res.status(500).json({success:false});}
});

// Get unread message count for notification badge
app.post('/api/private/messages/unread', verifyTelegramData, async (req, res) => {
    try {
        const telegramId = req.telegramUser.id;
        const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        if (userResult.rows.length === 0) return res.json({ unread_count: 0 });
        const userId = userResult.rows[0].id;
        
        const result = await pool.query(`
            SELECT COUNT(*) as count 
            FROM private_messages 
            WHERE receiver_id = $1 AND is_read = false AND is_deleted = FALSE
        `, [userId]);
        
        res.json({ unread_count: parseInt(result.rows[0].count) });
    } catch (err) {
        console.error('Unread messages error:', err);
        res.json({ unread_count: 0 });
    }
});

// ============================================
// GET ONLINE STATUS FOR FRIENDS
// ============================================
app.post('/api/friends/online-status', verifyTelegramData, async (req, res) => {
    try {
        const telegramId = req.telegramUser.id;
        const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        if (userResult.rows.length === 0) return res.json({ online_status: {} });
        const userId = userResult.rows[0].id;
        
        // Get all friends of the user
        const friendsResult = await pool.query(`
            SELECT u.id
            FROM friends f
            JOIN users u ON (f.friend_id = u.id)
            WHERE f.user_id = $1 AND f.status = 'accepted'
            UNION
            SELECT u.id
            FROM friends f
            JOIN users u ON (f.user_id = u.id)
            WHERE f.friend_id = $1 AND f.status = 'accepted'
        `, [userId]);
        
        const friendIds = friendsResult.rows.map(row => row.id);
        
        // Presence is tracked for every authenticated Socket.IO connection.
        const onlineUserIds = new Set(
            Array.from(presenceSockets.values()).map(presence => String(presence.userId))
        );
        const onlineStatus = {};
        for (const friendId of friendIds) {
            onlineStatus[friendId] = onlineUserIds.has(String(friendId));
        }
        
        res.json({ online_status: onlineStatus });
    } catch (err) {
        console.error('Online status error:', err);
        res.json({ online_status: {} });
    }
});

// ============================================
// GET LAST SEEN FOR A USER
// ============================================
app.post('/api/user/last-seen', verifyTelegramData, async (req, res) => {
    try {
        const telegramId = req.telegramUser.id;
        const { targetUserId } = req.body;
        
        // Use targetUserId if provided, otherwise use the requesting user's ID
        const userId = targetUserId || telegramId;
        
        const result = await pool.query(
            'SELECT id, last_seen FROM users WHERE telegram_id = $1',
            [userId]
        );
        
        if (result.rows.length === 0) {
            return res.json({ last_seen: null });
        }
        
        res.json({ 
            last_seen: result.rows[0].last_seen,
            user_id: result.rows[0].id
        });
    } catch (err) {
        console.error('Last seen error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// UPDATE LAST SEEN (call this on every page load)
// ============================================
app.post('/api/user/update-last-seen', verifyTelegramData, async (req, res) => {
    try {
        const telegramId = req.telegramUser.id;
        
        await pool.query(
            'UPDATE users SET last_seen = NOW() WHERE telegram_id = $1',
            [telegramId]
        );
        
        res.json({ success: true });
    } catch (err) {
        console.error('Update last seen error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get last messages for friends (for sorting)
app.post('/api/private/messages/last-messages', verifyTelegramData, async (req, res) => {
    try {
        const telegramId = req.telegramUser.id;
        const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        if (userResult.rows.length === 0) return res.json({});
        const userId = userResult.rows[0].id;
        
        const result = await pool.query(`
            SELECT DISTINCT ON (other_user) 
                other_user as friend_id,
                message,
                created_at as last_message_time,
                CASE 
                    WHEN sender_id = $1 THEN 'sent'
                    ELSE 'received'
                END as direction
            FROM (
                SELECT 
                    sender_id,
                    receiver_id,
                    message,
                    created_at,
                    CASE 
                        WHEN sender_id = $1 THEN receiver_id
                        ELSE sender_id
                    END as other_user
                FROM private_messages
                WHERE sender_id = $1 OR receiver_id = $1
            ) messages
            ORDER BY other_user, created_at DESC
        `, [userId]);
        
        const lastMessages = {};
        result.rows.forEach(row => {
            lastMessages[row.friend_id] = {
                last_message: row.message,
                last_message_time: row.last_message_time,
                direction: row.direction
            };
        });
        
        res.json(lastMessages);
    } catch (err) {
        console.error('Last messages error:', err);
        res.json({});
    }
});

// ============================================
// MARK TEAM MESSAGES AS READ
// ============================================
app.post('/api/team/mark-read', verifyTelegramData, async (req, res) => {
    try {
        const { teamId } = req.body;
        const telegramId = req.telegramUser.id;
        
        const userResult = await pool.query(
            'SELECT id FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userId = userResult.rows[0].id;
        const membership = await pool.query(
            'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2 LIMIT 1',
            [teamId, userId]
        );
        if (membership.rows.length === 0) {
            return res.status(403).json({ error: 'You are not a member of this team' });
        }

        // Mark every existing message from another member as read for this user.
        await pool.query(`
            INSERT INTO team_message_reads (message_id, user_id, read_at)
            SELECT tm.id, $2, NOW()
            FROM team_messages tm
            WHERE tm.team_id = $1 AND tm.user_id <> $2 AND tm.is_deleted = FALSE
            ON CONFLICT (message_id, user_id)
            DO UPDATE SET read_at = EXCLUDED.read_at
        `, [teamId, userId]);

        res.json({ success: true });
    } catch (err) {
        console.error('Mark read error:', err);
        res.status(500).json({ error: 'Failed to mark as read' });
    }
});

// Get unread team messages count for badge
app.post('/api/team/unread-count', verifyTelegramData, async (req, res) => {
    const { teamId } = req.body;
    try {
        const telegramId = req.telegramUser.id;
        const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        if (userResult.rows.length === 0) return res.json({ unread_count: 0 });
        const userId = userResult.rows[0].id;
        const membership = await pool.query(
            'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2 LIMIT 1',
            [teamId, userId]
        );
        if (membership.rows.length === 0) {
            return res.json({ unread_count: 0 });
        }

        // Only messages from other members without a read receipt are unread.
        const countResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM team_messages tm
            WHERE tm.team_id = $1
              AND tm.user_id <> $2 AND tm.is_deleted = FALSE
              AND NOT EXISTS (
                SELECT 1 FROM team_message_reads tmr
                WHERE tmr.message_id = tm.id AND tmr.user_id = $2
              )
        `, [teamId, userId]);

        res.json({ unread_count: parseInt(countResult.rows[0].count, 10) || 0 });
    } catch (err) {
        console.error('Team unread count error:', err);
        res.json({ unread_count: 0 });
    }
});

app.get('/api/admin/test-failed-users', async (req, res) => {    const BOT_TOKEN = process.env.BOT_TOKEN;
    
    // ✅ Use IDs from URL, or fallback to default list
    const idsParam = req.query.ids;
    const failedIds = idsParam 
        ? idsParam.split(',').map(id => parseInt(id.trim())) 
        : [7906788428, 6862957369];
    
    const results = [];
    
    for (const id of failedIds) {
        try {
            const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: id,
                    text: 'Test message from YzemanBot - please ignore'
                })
            });
            
            const result = await response.json();
            
            results.push({
                telegram_id: id,
                ok: result.ok,
                error: result.description || 'Sent successfully',
                error_code: result.error_code || null
            });
        } catch (err) {
            results.push({
                telegram_id: id,
                ok: false,
                error: err.message,
                error_code: null
            });
        }
    }
    
    res.json(results);
});
// TEMPORARY: Test tournament prize query
app.get('/api/admin/test-tournament-prizes', async (req, res) => {  try {
    const today = new Date();
    const currentDay = today.getDay();
    const lastSunday = new Date(today);
    lastSunday.setDate(today.getDate() - currentDay);
    lastSunday.setHours(23, 59, 59, 999);
    const lastSundayStr = lastSunday.toISOString().split('T')[0];
    
    const lastMonday = new Date(lastSunday);
    lastMonday.setDate(lastSunday.getDate() - 6);
    lastMonday.setHours(0, 0, 0, 0);
    const lastMondayStr = lastMonday.toISOString().split('T')[0];
    
    const topParticipants = await pool.query(`
  SELECT u.first_name, COALESCE(SUM(ar.reward_amount), 0) as weekly_coins
  FROM tournament_participants tp
  JOIN users u ON tp.user_id = u.id
  LEFT JOIN ad_rewards ar ON u.id = ar.user_id 
    AND ar.created_at >= $1::date
    AND ar.created_at < ($2::date + INTERVAL '1 day')::timestamp
    AND ar.ad_type IN ('ad', 'daily', 'wheel', 'task')
  WHERE tp.tournament_id = (SELECT id FROM weekly_tournaments WHERE week_start = $1)
  GROUP BY u.id, u.first_name
  ORDER BY weekly_coins DESC
  LIMIT 5
`, [lastMondayStr, lastSundayStr]);
    
    res.json({ week: `${lastMondayStr} to ${lastSundayStr}`, top_participants: topParticipants.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// TEMPORARY: Test leaderboard prize query
app.get('/api/admin/test-leaderboard-prizes', async (req, res) => {  try {
    const lastMonth = await pool.query(`SELECT date_trunc('month', NOW())::date - INTERVAL '1 month' as month_start`);
    const monthStart = lastMonth.rows[0].month_start;
    
    const topEarners = await pool.query(`
      SELECT u.first_name, ume.coins_earned as monthly_coins
      FROM user_monthly_earnings ume
      JOIN users u ON ume.user_id = u.id
      WHERE ume.month_year = $1 AND ume.coins_earned > 0
      ORDER BY ume.coins_earned DESC
      LIMIT 5
    `, [monthStart]);
    
    res.json({ month: monthStart.toISOString().split('T')[0], top_earners: topEarners.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// TEMPORARY: Test team prize query
app.get('/api/admin/test-team-prizes', async (req, res) => {  try {
    const lastMonth = await pool.query(`SELECT date_trunc('month', NOW())::date - INTERVAL '1 month' as month_start`);
    const monthStart = lastMonth.rows[0].month_start;
    
    const topTeams = await pool.query(`
      SELECT t.name as team_name, COUNT(tm.id) as members,
        COALESCE(SUM(ume.coins_earned), 0) as monthly_coins
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id
      LEFT JOIN users u ON tm.user_id = u.id
      LEFT JOIN user_monthly_earnings ume ON u.id = ume.user_id AND ume.month_year = $1
      GROUP BY t.id, t.name
      HAVING COUNT(tm.id) > 0
      ORDER BY monthly_coins DESC
      LIMIT 3
    `, [monthStart]);
    
    res.json({ month: monthStart.toISOString().split('T')[0], top_teams: topTeams.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Download user IDs as text file
app.get('/api/admin/download-user-ids', async (req, res) => {  try {
    const result = await pool.query(
      'SELECT telegram_id FROM users WHERE telegram_id IS NOT NULL ORDER BY telegram_id'
    );
    
    const ids = result.rows.map(row => row.telegram_id).join('\n');
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename=bot_users.txt');
    res.send(ids);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// COMPLETE ADMIN ANALYSIS ENDPOINTS
// ============================================================

// 1. Growth
app.get('/api/admin/analysis/growth', async (req, res) => {
  try {
    // ✅ This generates a list of the last 30 days and LEFT JOINS the users
    const result = await pool.query(`
      WITH date_series AS (
        SELECT generate_series(
          (CURRENT_DATE - INTERVAL '30 days')::date,
          CURRENT_DATE,
          '1 day'::interval
        )::date AS date
      )
      SELECT 
        TO_CHAR(ds.date, 'YYYY-MM-DD') as date,
        COUNT(u.id) as new_users
      FROM date_series ds
      LEFT JOIN users u ON DATE(u.created_at AT TIME ZONE 'Africa/Lagos') = ds.date
      GROUP BY ds.date
      ORDER BY ds.date ASC
    `);
    res.json({ daily: result.rows });
  } catch (err) { 
    console.error('Growth error:', err);
    res.status(500).json({ error: err.message }); 
  }
});

// 2. Retention
app.get('/api/admin/analysis/retention', async (req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*) FROM users');
    const totalUsers = parseInt(total.rows[0].count) || 1;
    
    // ✅ Day 1 Return: Users who were seen more than 1 day after they joined
    const day1 = await pool.query(`
      SELECT COUNT(*) FROM users 
      WHERE created_at <= NOW() - INTERVAL '1 day' 
      AND last_seen >= created_at + INTERVAL '1 day'
    `);
    
    // ✅ Day 7 Return: Users who were seen 7 days after they joined
    const day7 = await pool.query(`
      SELECT COUNT(*) FROM users 
      WHERE created_at <= NOW() - INTERVAL '7 days' 
      AND last_seen >= created_at + INTERVAL '7 days'
    `);
    
    // ✅ Day 30 Return: Users who were seen 30 days after they joined
    const day30 = await pool.query(`
      SELECT COUNT(*) FROM users 
      WHERE created_at <= NOW() - INTERVAL '30 days' 
      AND last_seen >= created_at + INTERVAL '30 days'
    `);

    res.json({
      total: totalUsers,
      day1: parseInt(day1.rows[0].count) || 0,
      day7: parseInt(day7.rows[0].count) || 0,
      day30: parseInt(day30.rows[0].count) || 0
    });
  } catch (err) { 
    console.error('Retention error:', err);
    res.status(500).json({ error: err.message }); 
  }
});

// 3. Withdrawal Pipeline
app.get('/api/admin/analysis/withdrawal-pipeline', async (req, res) => {
  try {
    const ready = await pool.query(`SELECT COUNT(*) FROM users WHERE coins >= 100000`);
    const close = await pool.query(`SELECT COUNT(*) FROM users WHERE coins >= 50000 AND coins < 100000`);
    const pending = await pool.query(`SELECT COUNT(*) FROM withdrawals WHERE status = 'pending'`);
    res.json({
      ready: parseInt(ready.rows[0].count),
      close: parseInt(close.rows[0].count),
      pending: parseInt(pending.rows[0].count)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. Economy Health
app.get('/api/admin/analysis/economy-health', async (req, res) => {
  try {
    const generated = await pool.query(`SELECT SUM(total_coins_earned) as total FROM users`);
    const withdrawn = await pool.query(`SELECT SUM(amount) as total FROM withdrawals WHERE status = 'completed' OR status = 'approved'`);
    const supply = await pool.query(`SELECT SUM(coins) as total FROM users`);
    res.json({
      generated: parseFloat(generated.rows[0].total) || 0,
      withdrawn: parseFloat(withdrawn.rows[0].total) || 0,
      supply: parseFloat(supply.rows[0].total) || 0
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. Tier Distribution
app.get('/api/admin/analysis/tier-distribution', async (req, res) => {
  try {
    const result = await pool.query(`SELECT tier, COUNT(*) as count FROM users GROUP BY tier`);
    const d = { fresher: 0, brute: 0, silver: 0, gold: 0, platinum: 0 };
    result.rows.forEach(r => {
      const tier = (r.tier || 'Fresher').toLowerCase();
      if (d[tier] !== undefined) d[tier] = parseInt(r.count);
    });
    res.json(d);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. Funnel
app.get('/api/admin/analysis/funnel', async (req, res) => {
  try {
    const joined = await pool.query(`SELECT COUNT(*) FROM users`);
    const watchedFirstAd = await pool.query(`SELECT COUNT(DISTINCT user_id) FROM ad_rewards`);
    const watched50 = await pool.query(`SELECT COUNT(*) FROM (SELECT user_id FROM ad_rewards GROUP BY user_id HAVING COUNT(*) >= 50) as x`);
    const watched500 = await pool.query(`SELECT COUNT(*) FROM (SELECT user_id FROM ad_rewards GROUP BY user_id HAVING COUNT(*) >= 500) as x`);
    const reached100k = await pool.query(`SELECT COUNT(*) FROM users WHERE total_coins_earned >= 100000`);
    const reached1m = await pool.query(`SELECT COUNT(*) FROM users WHERE total_coins_earned >= 1000000`);

    res.json({
      joined: parseInt(joined.rows[0].count),
      watched_first_ad: parseInt(watchedFirstAd.rows[0].count),
      watched_50_ads: parseInt(watched50.rows[0].count),
      watched_500_ads: parseInt(watched500.rows[0].count),
      reached_100k: parseInt(reached100k.rows[0].count),
      reached_1m: parseInt(reached1m.rows[0].count)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. Segments
app.get('/api/admin/analysis/segments', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        CASE 
          WHEN total_coins_earned >= 1000000 THEN 'Whale (1M+)'
          WHEN total_coins_earned >= 100000 THEN 'Dolphin (100K-1M)'
          WHEN total_coins_earned >= 10000 THEN 'Minnow (10K-100K)'
          WHEN total_coins_earned >= 1000 THEN 'Plankton (1K-10K)'
          ELSE 'New / Inactive'
        END as segment,
        COUNT(*) as users
      FROM users GROUP BY segment ORDER BY users DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 8. Heatmap
app.get('/api/admin/analysis/heatmap', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as activity 
      FROM ad_rewards GROUP BY hour ORDER BY hour ASC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 9. Earnings Distribution
app.get('/api/admin/analysis/earnings-distribution', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE total_coins_earned < 10000) as under_10k,
        COUNT(*) FILTER (WHERE total_coins_earned >= 10000 AND total_coins_earned < 50000) as from_10k_50k,
        COUNT(*) FILTER (WHERE total_coins_earned >= 50000 AND total_coins_earned < 100000) as from_50k_100k,
        COUNT(*) FILTER (WHERE total_coins_earned >= 100000 AND total_coins_earned < 500000) as from_100k_500k,
        COUNT(*) FILTER (WHERE total_coins_earned >= 500000 AND total_coins_earned < 1000000) as from_500k_1m,
        COUNT(*) FILTER (WHERE total_coins_earned >= 1000000) as reached_1m
      FROM users
    `);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 10. Referral Quality
app.get('/api/admin/analysis/referrals', async (req, res) => {
  try {
    const totalReferred = await pool.query(`SELECT COUNT(*) FROM referrals`);
    const activeReferred = await pool.query(`
      SELECT COUNT(DISTINCT r.referred_id) FROM referrals r
      JOIN users u ON u.id = r.referred_id WHERE u.total_coins_earned > 0
    `);
    const t = parseInt(totalReferred.rows[0].count) || 1;
    const a = parseInt(activeReferred.rows[0].count);
    
    res.json({
      quality: {
        total_referred: t,
        active_referred: a,
        retention_percent: Math.round((a / t) * 100)
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 11. Top Referrers
app.get('/api/admin/analysis/top-referrers', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.first_name, u.referrals, 
        COALESCE(SUM(rc.commission_coins), 0) as commission
      FROM users u
      LEFT JOIN referral_commissions rc ON rc.referrer_id = u.id
      GROUP BY u.id, u.first_name, u.referrals
      HAVING u.referrals > 0
      ORDER BY u.referrals DESC LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 12. Cohort
app.get('/api/admin/analysis/cohort', async (req, res) => {
  try {
    const result = await pool.query(`
      WITH cohorts AS (
        SELECT id, DATE_TRUNC('week', created_at) as cohort_week FROM users
      ),
      activity AS (
        SELECT user_id, DATE_TRUNC('week', created_at) as activity_week FROM ad_rewards
      )
      SELECT 
        c.cohort_week,
        COUNT(DISTINCT c.id) as cohort_size,
        COUNT(DISTINCT CASE WHEN a.activity_week = c.cohort_week THEN c.id END) as week_0,
        COUNT(DISTINCT CASE WHEN a.activity_week = c.cohort_week + INTERVAL '1 week' THEN c.id END) as week_1,
        COUNT(DISTINCT CASE WHEN a.activity_week = c.cohort_week + INTERVAL '2 weeks' THEN c.id END) as week_2,
        COUNT(DISTINCT CASE WHEN a.activity_week = c.cohort_week + INTERVAL '3 weeks' THEN c.id END) as week_3
      FROM cohorts c
      LEFT JOIN activity a ON a.user_id = c.id
      WHERE c.cohort_week >= NOW() - INTERVAL '8 weeks'
      GROUP BY c.cohort_week ORDER BY c.cohort_week DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 13. Churn (UPDATED for clickable lists)
app.get('/api/admin/analysis/churn', async (req, res) => {
  try {
    const active = await pool.query(`SELECT COUNT(*) FROM users WHERE last_seen >= NOW() - INTERVAL '1 day'`);
    const atRisk = await pool.query(`SELECT COUNT(*) FROM users WHERE last_seen < NOW() - INTERVAL '7 days' AND last_seen >= NOW() - INTERVAL '30 days'`);
    const churned = await pool.query(`SELECT COUNT(*) FROM users WHERE last_seen < NOW() - INTERVAL '30 days' OR last_seen IS NULL`);

    const activeList = await pool.query(`
      SELECT first_name, coins, EXTRACT(DAY FROM (NOW() - last_seen)) as days_inactive 
      FROM users WHERE last_seen >= NOW() - INTERVAL '1 day' 
      ORDER BY last_seen DESC LIMIT 100
    `);
    const atRiskList = await pool.query(`
      SELECT first_name, coins, EXTRACT(DAY FROM (NOW() - last_seen)) as days_inactive 
      FROM users WHERE last_seen < NOW() - INTERVAL '7 days' AND last_seen >= NOW() - INTERVAL '30 days'
      ORDER BY coins DESC LIMIT 100
    `);
    const churnedList = await pool.query(`
      SELECT first_name, coins, EXTRACT(DAY FROM (NOW() - last_seen)) as days_inactive 
      FROM users WHERE last_seen < NOW() - INTERVAL '30 days' OR last_seen IS NULL
      ORDER BY coins DESC LIMIT 100
    `);

    res.json({
      summary: {
        active_24h: parseInt(active.rows[0].count),
        at_risk: parseInt(atRisk.rows[0].count),
        churned: parseInt(churned.rows[0].count)
      },
      active_users: activeList.rows,
      at_risk_users: atRiskList.rows,
      churned_users: churnedList.rows
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 14. Revenue
app.get('/api/admin/analysis/revenue', async (req, res) => {
  try {
    const totalAds = await pool.query(`SELECT COUNT(*) FROM ad_rewards`);
    const users = await pool.query(`SELECT COUNT(*) FROM users`);
    const tAds = parseInt(totalAds.rows[0].count) || 0;
    const tUsers = parseInt(users.rows[0].count) || 1;
    const revenue = tAds * 0.002; // Estimated $0.002 per ad

    const daily = await pool.query(`
      SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, COUNT(*) as ad_views 
      FROM ad_rewards WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY date ORDER BY date ASC
    `);

    res.json({
      totals: {
        estimated_revenue: revenue.toFixed(2),
        arpu: (revenue / tUsers).toFixed(4),
        total_ad_views: tAds
      },
      daily: daily.rows
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 15. Fake Referrals
app.get('/api/admin/analysis/fake-referrals', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.first_name as referrer_name, u.username as referrer_username,
        u.referrals as total_referred,
        COUNT(CASE WHEN r2.total_coins_earned = 0 THEN 1 END) as dormant_refs
      FROM users u
      JOIN referrals r ON r.referrer_id = u.id
      JOIN users r2 ON r2.id = r.referred_id
      GROUP BY u.id, u.first_name, u.username, u.referrals
      HAVING COUNT(CASE WHEN r2.total_coins_earned = 0 THEN 1 END) >= 3
      ORDER BY dormant_refs DESC LIMIT 20
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 16. Whale Tracker (NEW)
app.get('/api/admin/analysis/whales', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT first_name, telegram_id, total_coins_earned 
      FROM users ORDER BY total_coins_earned DESC LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 17. Feature Adoption (NEW)
app.get('/api/admin/analysis/feature-adoption', async (req, res) => {
  try {
    const total = await pool.query(`SELECT COUNT(*) as count FROM users`);
    const totalUsers = parseInt(total.rows[0].count) || 1;
    
    const wheel = await pool.query(`SELECT COUNT(DISTINCT user_id) as count FROM wheel_spins`);
    const daily = await pool.query(`SELECT COUNT(DISTINCT user_id) as count FROM daily_rewards`);
    const bonus = await pool.query(`SELECT COUNT(DISTINCT user_id) as count FROM user_bonus_redemptions`);
    const team = await pool.query(`SELECT COUNT(DISTINCT user_id) as count FROM team_members`);
    
    res.json({
      wheel_pct: Math.round((parseInt(wheel.rows[0].count) / totalUsers) * 100),
      daily_pct: Math.round((parseInt(daily.rows[0].count) / totalUsers) * 100),
      bonus_pct: Math.round((parseInt(bonus.rows[0].count) / totalUsers) * 100),
      team_pct: Math.round((parseInt(team.rows[0].count) / totalUsers) * 100)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 18. Security (NEW)
app.get('/api/admin/analysis/security', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        ip_address, 
        COUNT(*) as account_count,
        STRING_AGG(first_name || ' (ID: ' || telegram_id || ')', ', ') as users
      FROM users 
      WHERE ip_address IS NOT NULL AND ip_address != ''
      GROUP BY ip_address 
      HAVING COUNT(*) >= 2
      ORDER BY account_count DESC LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 19. Ad Health (NEW)// 19. Ad Health
app.get('/api/admin/analysis/ad-health', async (req, res) => {
  try {
    // ✅ Count successful ads (Strictly 'ad' only)
    const successful = await pool.query(`SELECT COUNT(*) FROM ad_rewards WHERE ad_type = 'ad'`);
    
    // ✅ Count errors
    const errors = await pool.query(`SELECT COUNT(*) FROM ad_rewards WHERE ad_type = 'error'`); 
    
    // ✅ Count total users
    const users = await pool.query(`SELECT COUNT(*) FROM users`);
    
    const successCount = parseInt(successful.rows[0].count) || 0;
    const errorCount = parseInt(errors.rows[0].count) || 0;
    const totalUsers = parseInt(users.rows[0].count) || 1;
    
    const totalAttempts = successCount + errorCount;
    
    // ✅ If no errors, fill rate is 100%. If no ads at all, it's 0%.
    let fillRate = 0;
    if (totalAttempts > 0) {
        fillRate = Math.round((successCount / totalAttempts) * 100);
    } else if (successCount === 0 && errorCount === 0) {
        fillRate = 0;
    }

    res.json({
      fill_rate: fillRate,
      errors: errorCount,
      avg_per_user: (successCount / totalUsers).toFixed(1) 
    });
  } catch (err) { 
    console.error('Ad Health error:', err);
    res.status(500).json({ error: err.message }); 
  }
});

// 20. Tournament (NEW)
app.get('/api/admin/analysis/tournament', async (req, res) => {
  try {
    const activeTournament = await pool.query(`
      SELECT id FROM weekly_tournaments WHERE is_active = true ORDER BY id DESC LIMIT 1
    `);
    
    if (activeTournament.rows.length === 0) {
      return res.json({ participants: 0, total_coins_earned: 0 });
    }
    
    const tId = activeTournament.rows[0].id;
    const stats = await pool.query(`
      SELECT COUNT(*) as participants, SUM(coins_earned) as total_coins 
      FROM tournament_participants WHERE tournament_id = $1
    `, [tId]);
    
    res.json({
      participants: parseInt(stats.rows[0].participants) || 0,
      total_coins_earned: parseFloat(stats.rows[0].total_coins) || 0
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/analysis/blocked-users', verifyAdmin, async (req, res) => {
  try {
    const users = await pool.query('SELECT telegram_id, first_name, last_name, coins FROM users');
    const botToken = process.env.BOT_TOKEN;
    
    if (!botToken) return res.status(500).json({ error: 'BOT_TOKEN missing' });

    let blockedCount = 0;
    let deactivatedCount = 0;
    const blockedUsers = [];
    
    // ✅ Check one by one to be 100% accurate
    for (const user of users.rows) {
        try {
            // We use sendChatAction because it checks permission WITHOUT sending a real message
            const response = await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: user.telegram_id,
                    action: 'typing'
                })
            });
            
            const data = await response.json();
            
            if (!data.ok) {
                const desc = (data.description || '').toLowerCase();
                
                // ✅ If Telegram says forbidden or blocked
                if (desc.includes('forbidden') || desc.includes('blocked') || desc.includes('kicked') || desc.includes('chat not found')) {
                    blockedCount++;
                    blockedUsers.push({
                        telegram_id: user.telegram_id,
                        name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unknown',
                        coins: user.coins
                    });
                } 
                else if (desc.includes('deactivated')) {
                    deactivatedCount++;
                }
            }
        } catch (e) {
            // Ignore network timeout errors
        }
        
        // 50ms delay to prevent Telegram rate limit ban
        await new Promise(r => setTimeout(r, 50));
    }

    res.json({
      summary: {
        blocked_count: blockedCount,
        deactivated_count: deactivatedCount,
        total_checked: users.rows.length
      },
      blocked: blockedUsers
    });
  } catch (err) { 
    console.error('Blocked scan error:', err);
    res.status(500).json({ error: err.message }); 
  }
});

// ============================================
// HEALTH CHECK & WEBHOOK
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
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`🟢 WebSocket server ready`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
