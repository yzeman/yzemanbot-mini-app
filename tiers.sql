CREATE TABLE IF NOT EXISTS tiers (
  name VARCHAR(50) PRIMARY KEY,
  refs_required INTEGER NOT NULL,
  multiplier FLOAT NOT NULL,
  ad_reward INTEGER NOT NULL,
  referral_reward INTEGER NOT NULL
);

INSERT INTO tiers (name, refs_required, multiplier, ad_reward, referral_reward) 
VALUES 
  ('Fresher', 0, 1.0, 51, 1000),
  ('Brute', 15, 1.2, 74, 1500),
  ('Silver', 35, 1.5, 105, 2000),
  ('Gold', 70, 2.0, 140, 3000),
  ('Platinum', 150, 3.0, 210, 5000)
ON CONFLICT (name) DO NOTHING;