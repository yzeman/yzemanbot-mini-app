-- ============================================
-- UPDATED DATABASE SCHEMA WITH NEW FEATURES
-- This ADDS new tables without breaking existing ones
-- ============================================

-- ============================================
-- EXISTING TABLES (Keep as is)
-- ============================================

-- Users table
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
);

-- Add missing columns to users (safe - only adds if not exists)
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referrals INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_points_earned BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id INTEGER;

-- Tiers table
CREATE TABLE IF NOT EXISTS tiers (
    name TEXT PRIMARY KEY,
    refs_required INTEGER NOT NULL,
    multiplier REAL NOT NULL,
    referral_reward INTEGER NOT NULL
);

-- Insert tier data
INSERT INTO tiers (name, refs_required, multiplier, referral_reward) 
VALUES 
    ('Fresher', 0, 1.0, 5000),
    ('Brute', 50, 1.2, 10000),
    ('Silver', 150, 1.5, 15000),
    ('Gold', 300, 2.0, 20000),
    ('Platinum', 500, 3.0, 30000)
ON CONFLICT (name) DO NOTHING;

-- Referrals table
CREATE TABLE IF NOT EXISTS referrals (
    id SERIAL PRIMARY KEY,
    referrer_id INTEGER NOT NULL REFERENCES users(id),
    referred_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (referred_id)
);

-- Ad rewards table
CREATE TABLE IF NOT EXISTS ad_rewards (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    reward_amount INTEGER NOT NULL,
    ad_type TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Withdrawals table
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
-- NEW FEATURE TABLES (Added safely)
-- ============================================

-- 1. Daily Rewards & Streak System
CREATE TABLE IF NOT EXISTS daily_rewards (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    reward_date DATE NOT NULL,
    streak_count INTEGER DEFAULT 1,
    reward_points INTEGER NOT NULL,
    claimed BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, reward_date)
);

-- 2. Wheel of Fortune (3-day cooldown)
CREATE TABLE IF NOT EXISTS wheel_spins (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    spin_date DATE NOT NULL,
    reward_points INTEGER NOT NULL,
    spin_type TEXT DEFAULT 'normal',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, spin_date)
);

-- 3. Achievements System
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

-- 4. Weekly Tournaments
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

-- 5. Teams & Monthly Competition
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

-- Existing indexes
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_created_at ON referrals(created_at);
CREATE INDEX IF NOT EXISTS idx_ad_rewards_user_id ON ad_rewards(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

-- New indexes for features
CREATE INDEX IF NOT EXISTS idx_daily_rewards_user_date ON daily_rewards(user_id, reward_date);
CREATE INDEX IF NOT EXISTS idx_daily_rewards_user_id ON daily_rewards(user_id);
CREATE INDEX IF NOT EXISTS idx_wheel_spins_user_date ON wheel_spins(user_id, spin_date);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_tournament_participants_tournament ON tournament_participants(tournament_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_users_team_id ON users(team_id);

-- ============================================
-- VERIFY ALL TABLES WERE CREATED
-- ============================================

-- Check if all new tables exist (for debugging)
DO $$
DECLARE
    missing_tables TEXT[] := ARRAY[]::TEXT[];
    expected_tables TEXT[] := ARRAY['daily_rewards', 'wheel_spins', 'achievements', 'user_achievements', 'weekly_tournaments', 'tournament_participants', 'teams', 'team_members', 'monthly_competitions'];
    t TEXT;
BEGIN
    FOREACH t IN ARRAY expected_tables
    LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
            missing_tables := array_append(missing_tables, t);
        END IF;
    END LOOP;
    
    IF array_length(missing_tables, 1) > 0 THEN
        RAISE NOTICE 'Warning: Missing tables: %', missing_tables;
    ELSE
        RAISE NOTICE '✅ All new tables created successfully!';
    END IF;
END $$;

-- ============================================
-- END OF MIGRATION
-- ============================================
