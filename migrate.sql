-- ============================================
-- COMPLETE DATABASE SCHEMA FOR YZEMANBOT
-- Run this on your PostgreSQL database
-- ============================================

-- Drop existing tables if you want fresh start (WARNING: deletes all data!)
-- DROP TABLE IF EXISTS user_achievements CASCADE;
-- DROP TABLE IF EXISTS achievements CASCADE;
-- DROP TABLE IF EXISTS wheel_spins CASCADE;
-- DROP TABLE IF EXISTS daily_rewards CASCADE;
-- DROP TABLE IF EXISTS tournament_participants CASCADE;
-- DROP TABLE IF EXISTS weekly_tournaments CASCADE;
-- DROP TABLE IF EXISTS team_members CASCADE;
-- DROP TABLE IF EXISTS monthly_competitions CASCADE;
-- DROP TABLE IF EXISTS teams CASCADE;
-- DROP TABLE IF EXISTS withdrawals CASCADE;
-- DROP TABLE IF EXISTS ad_rewards CASCADE;
-- DROP TABLE IF EXISTS referrals CASCADE;
-- DROP TABLE IF EXISTS tiers CASCADE;
-- DROP TABLE IF EXISTS users CASCADE;

-- ============================================
-- CORE TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    first_name TEXT,
    last_name TEXT,
    username TEXT,
    photo_url TEXT,
    referral_code TEXT UNIQUE,
    wallet_address TEXT,
    points BIGINT NOT NULL DEFAULT 0,
    total_points_earned BIGINT DEFAULT 0,
    referrals INTEGER DEFAULT 0,
    tier TEXT NOT NULL DEFAULT 'Fresher',
    team_id INTEGER,
    last_login_date DATE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tiers (
    name TEXT PRIMARY KEY,
    refs_required INTEGER NOT NULL,
    multiplier REAL NOT NULL,
    referral_reward INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS referrals (
    id SERIAL PRIMARY KEY,
    referrer_id INTEGER NOT NULL REFERENCES users(id),
    referred_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (referred_id)
);

CREATE TABLE IF NOT EXISTS ad_rewards (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    reward_amount INTEGER NOT NULL,
    ad_type TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS withdrawals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount DECIMAL(10,2) NOT NULL,
    wallet_address TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- NEW FEATURES TABLES
-- ============================================

-- 1. Daily rewards tracking
CREATE TABLE IF NOT EXISTS daily_rewards (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    reward_date DATE NOT NULL,
    streak_count INTEGER DEFAULT 1,
    reward_points INTEGER NOT NULL,
    claimed BOOLEAN DEFAULT TRUE,
    UNIQUE(user_id, reward_date)
);

-- 2. Wheel of Fortune spins (3-day cooldown)
CREATE TABLE IF NOT EXISTS wheel_spins (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    spin_date DATE NOT NULL,
    reward_points INTEGER NOT NULL,
    spin_type TEXT DEFAULT 'normal',
    UNIQUE(user_id, spin_date)
);

-- 3. Achievements system
CREATE TABLE IF NOT EXISTS achievements (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    badge_icon TEXT,
    required_value INTEGER,
    points_reward INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_achievements (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    achievement_id INTEGER NOT NULL REFERENCES achievements(id),
    achieved_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, achievement_id)
);

-- 4. Weekly tournaments
CREATE TABLE IF NOT EXISTS weekly_tournaments (
    id SERIAL PRIMARY KEY,
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tournament_participants (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES weekly_tournaments(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    points_earned INTEGER DEFAULT 0,
    referral_count INTEGER DEFAULT 0,
    rank INTEGER,
    prize_awarded BOOLEAN DEFAULT FALSE,
    UNIQUE(tournament_id, user_id)
);

-- 5. Team competitions
CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    joined_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(team_id, user_id)
);

CREATE TABLE IF NOT EXISTS monthly_competitions (
    id SERIAL PRIMARY KEY,
    month_year DATE NOT NULL,
    winning_team_id INTEGER REFERENCES teams(id),
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(month_year)
);

-- ============================================
-- INSERT DEFAULT TIERS
-- ============================================

INSERT INTO tiers (name, refs_required, multiplier, referral_reward) 
VALUES 
    ('Fresher', 0, 1.0, 5000),
    ('Brute', 50, 1.2, 10000),
    ('Silver', 150, 1.5, 15000),
    ('Gold', 300, 2.0, 20000),
    ('Platinum', 500, 3.0, 30000)
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- INSERT DEFAULT ACHIEVEMENTS
-- ============================================

INSERT INTO achievements (name, description, badge_icon, required_value, points_reward) VALUES
    ('Loyal User', '30 day login streak', '🔥', 30, 50000),
    ('Referral Master', 'Get 100 referrals', '👑', 100, 100000),
    ('Points Millionaire', 'Earn 1,000,000 points', '💰', 1000000, 200000),
    ('Social Butterfly', 'Complete all social tasks', '🦋', 5, 25000),
    ('Tournament Winner', 'Win a weekly tournament', '🏆', 1, 50000),
    ('Team Player', 'Join a team', '🤝', 1, 10000),
    ('Platinum Elite', 'Reach Platinum tier', '💎', 500, 150000),
    ('Wheel Champion', 'Win 10,000 points on wheel', '🎡', 10000, 25000),
    ('Daily Streak 7', '7 day login streak', '📅', 7, 10000),
    ('Super Referrer', 'Get 500 referrals', '⭐', 500, 500000)
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- CREATE INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_created_at ON referrals(created_at);
CREATE INDEX IF NOT EXISTS idx_ad_rewards_user_id ON ad_rewards(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_rewards_created_at ON ad_rewards(created_at);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_daily_rewards_user_date ON daily_rewards(user_id, reward_date);
CREATE INDEX IF NOT EXISTS idx_wheel_spins_user_date ON wheel_spins(user_id, spin_date);
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_tournament_participants_tournament ON tournament_participants(tournament_id);

-- ============================================
-- CREATE MATERIALIZED VIEW FOR LEADERBOARDS
-- ============================================

DROP MATERIALIZED VIEW IF EXISTS weekly_leaderboard;
CREATE MATERIALIZED VIEW weekly_leaderboard AS
SELECT 
    u.id,
    u.username,
    u.first_name,
    u.photo_url,
    u.points,
    u.tier,
    u.referrals,
    COALESCE(SUM(ar.reward_amount), 0) as weekly_earnings,
    RANK() OVER (ORDER BY COALESCE(SUM(ar.reward_amount), 0) DESC) as rank
FROM users u
LEFT JOIN ad_rewards ar ON u.id = ar.user_id 
    AND ar.created_at > NOW() - INTERVAL '7 days'
GROUP BY u.id;

-- ============================================
-- DONE!
-- ============================================
