-- Core tables only (no new features)
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

ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referrals INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS tiers (
    name TEXT PRIMARY KEY,
    refs_required INTEGER NOT NULL,
    multiplier REAL NOT NULL,
    referral_reward INTEGER NOT NULL
);

INSERT INTO tiers (name, refs_required, multiplier, referral_reward) 
VALUES 
    ('Fresher', 0, 1.0, 5000),
    ('Brute', 50, 1.2, 10000),
    ('Silver', 150, 1.5, 15000),
    ('Gold', 300, 2.0, 20000),
    ('Platinum', 500, 3.0, 30000)
ON CONFLICT (name) DO NOTHING;

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
