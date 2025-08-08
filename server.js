require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Telegram Bot Configuration
const botToken = '6235048166:AAE7jQItOA3n5tqn_971ih6RQ8qvPY4V7X0';
const webAppUrl = 'https://yzemanbot-mini-app.onrender.com/';
const adminChatId = '1828689837';
const bot = new TelegramBot(botToken, { polling: true });

// Database Setup
const db = new sqlite3.Database('yzemanbot.db', (err) => {
    if (err) console.error('Database error:', err);
    else createTables();
});

// Tier System
const tiers = {
    'Fresher': { refsRequired: 0, multiplier: 1, referralReward: 1000 },
    'Brute': { refsRequired: 15, multiplier: 1.2, referralReward: 1500 },
    'Silver': { refsRequired: 35, multiplier: 1.5, referralReward: 2000 },
    'Gold': { refsRequired: 70, multiplier: 2, referralReward: 3000 },
    'Platinum': { refsRequired: 150, multiplier: 3, referralReward: 5000 }
};

// Database Functions
function createTables() {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id INTEGER UNIQUE,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        points INTEGER DEFAULT 0,
        tier TEXT DEFAULT 'Fresher',
        referrals INTEGER DEFAULT 0,
        wallet_address TEXT,
        referral_code TEXT UNIQUE,
        referred_by INTEGER,
        social_completions TEXT DEFAULT '{}',
        dollars_earned REAL DEFAULT 0,
        points_since_last_dollar INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        type TEXT,
        amount INTEGER,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount REAL,
        wallet_address TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
    
    // Add new columns if they don't exist
    db.run("PRAGMA table_info(users)", (err, columns) => {
        if (err) return;
        
        const hasDollarsEarned = columns.some(col => col.name === 'dollars_earned');
        if (!hasDollarsEarned) {
            db.run("ALTER TABLE users ADD COLUMN dollars_earned REAL DEFAULT 0");
        }
        
        const hasPointsSince = columns.some(col => col.name === 'points_since_last_dollar');
        if (!hasPointsSince) {
            db.run("ALTER TABLE users ADD COLUMN points_since_last_dollar INTEGER DEFAULT 0");
        }
    });
}

function generateReferralCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Telegram Bot Commands
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const refCode = msg.text.split(' ')[1] || null;
    
    db.get('SELECT * FROM users WHERE telegram_id = ?', [userId], (err, user) => {
        if (err) return bot.sendMessage(chatId, '❌ Database error');
        
        if (!user) {
            const referralCode = generateReferralCode();
            db.run(`INSERT INTO users (telegram_id, username, first_name, last_name, referral_code) 
                    VALUES (?, ?, ?, ?, ?)`,
                [userId, msg.from.username, msg.from.first_name, msg.from.last_name, referralCode],
                function(err) {
                    if (err) return bot.sendMessage(chatId, '❌ Account creation failed');
                    
                    const newUserId = this.lastID;
                    
                    if (refCode && refCode.startsWith('ref-')) {
                        const refUserId = refCode.substring(4);
                        db.get('SELECT id FROM users WHERE referral_code = ?', [refUserId], (err, referrer) => {
                            if (referrer) {
                                db.run('UPDATE users SET referrals = referrals + 1 WHERE id = ?', [referrer.id]);
                                const tier = tiers['Fresher'];
                                const reward = tier.referralReward;
                                db.run('UPDATE users SET points_since_last_dollar = points_since_last_dollar + ? WHERE id = ?', [reward, referrer.id]);
                                db.run('INSERT INTO transactions (user_id, type, amount, details) VALUES (?, ?, ?, ?)',
                                    [referrer.id, 'referral', reward, `Referred: ${userId}`]);
                                db.run('UPDATE users SET referred_by = ? WHERE id = ?', [referrer.id, newUserId]);
                            }
                        });
                    }
                    
                    const welcomeMsg = `👋 Welcome to YzemanBot!\n\n` +
                        `🚀 Start earning: ${webAppUrl}\n\n` +
                        `🔗 Your referral code: ${referralCode}\n` +
                        `📤 Share: https://t.me/YzemanBot?start=ref-${referralCode}`;
                    bot.sendMessage(chatId, welcomeMsg);
                }
            );
        } else {
            const welcomeMsg = `👋 Welcome back, ${user.first_name || ''}!\n\n` +
                `💎 Points: ${user.points_since_last_dollar}\n` +
                `💰 Dollars Earned: $${user.dollars_earned.toFixed(2)}\n` +
                `🔗 Referral code: ${user.referral_code}\n\n` +
                `🚀 Continue earning: ${webAppUrl}`;
            bot.sendMessage(chatId, welcomeMsg);
        }
    });
});

bot.onText(/\/withdraw/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    db.get('SELECT dollars_earned, wallet_address FROM users WHERE telegram_id = ?', [userId], (err, user) => {
        if (err || !user) return bot.sendMessage(chatId, '❌ User not found');
        
        if (user.dollars_earned < 1000) {
            bot.sendMessage(chatId, `❌ Need $1000 to withdraw\n💰 Your balance: $${user.dollars_earned.toFixed(2)}`);
            return;
        }
        
        if (!user.wallet_address) {
            bot.sendMessage(chatId, '❌ Set wallet address in web app first');
            return;
        }
        
        bot.sendMessage(chatId, "📬 Message @yzemanreal on Telegram to complete withdrawal");
    });
});

bot.onText(/\/balance/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    db.get('SELECT points_since_last_dollar, dollars_earned, tier, referrals FROM users WHERE telegram_id = ?', [userId], (err, user) => {
        if (err || !user) return bot.sendMessage(chatId, '❌ User not found');
        
        const tierInfo = tiers[user.tier] || tiers['Fresher'];
        const balanceMsg = `💰 *Your Balance*\n\n` +
            `💎 Points: ${user.points_since_last_dollar.toLocaleString()}\n` +
            `💵 Dollars Earned: $${user.dollars_earned.toFixed(2)}\n` +
            `🏆 Tier: ${user.tier} (${tierInfo.multiplier}x)\n` +
            `👥 Referrals: ${user.referrals}\n\n` +
            `🚀 Earn more: ${webAppUrl}`;
        
        bot.sendMessage(chatId, balanceMsg, { parse_mode: 'Markdown' });
    });
});

bot.onText(/\/referral/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    db.get('SELECT referral_code FROM users WHERE telegram_id = ?', [userId], (err, user) => {
        if (err || !user) return bot.sendMessage(chatId, '❌ User not found');
        
        const refLink = `${webAppUrl}?start=ref-${user.referral_code}`;
        const refMsg = `📤 *Your Referral Link*\n\n🔗 ${refLink}\n\n` +
            `👥 Share to earn ${tiers['Fresher'].referralReward} points per referral!`;
        bot.sendMessage(chatId, refMsg, { parse_mode: 'Markdown' });
    });
});

// API Endpoints
app.get('/api/user/:telegramId', (req, res) => {
    const telegramId = req.params.telegramId;
    
    db.get(`SELECT u.*, 
            (SELECT COUNT(*) FROM users WHERE referred_by = u.id) AS referrals
            FROM users u WHERE telegram_id = ?`, [telegramId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'User not found' });
        
        const tierInfo = tiers[user.tier] || tiers['Fresher'];
        
        // Parse social completions
        let socialCompletions = {};
        try {
            socialCompletions = JSON.parse(user.social_completions || '{}');
        } catch (e) {
            socialCompletions = {};
        }
        
        res.json({
            pointsSinceLastDollar: user.points_since_last_dollar,
            dollarsEarned: user.dollars_earned,
            tier: user.tier,
            referrals: user.referrals,
            multiplier: tierInfo.multiplier,
            nextTierRefs: tierInfo.refsRequired - user.referrals,
            referralCode: user.referral_code,
            walletAddress: user.wallet_address,
            referralReward: tierInfo.referralReward,
            socialCompletions: socialCompletions
        });
    });
});

app.post('/api/update-points', (req, res) => {
    const { telegramId, points, type, details } = req.body;
    if (!telegramId || !points) return res.status(400).json({ error: 'Missing parameters' });
    
    db.get('SELECT id, tier FROM users WHERE telegram_id = ?', [telegramId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'User not found' });
        
        const tierInfo = tiers[user.tier] || tiers['Fresher'];
        const actualPoints = Math.floor(points * tierInfo.multiplier);
        
        // Update points and check for dollar conversion
        db.run('UPDATE users SET points_since_last_dollar = points_since_last_dollar + ? WHERE id = ?', 
            [actualPoints, user.id], 
            (err) => {
                if (err) return res.status(500).json({ error: 'Database error' });
                
                // Check if we can convert points to dollars
                db.get('SELECT points_since_last_dollar, dollars_earned FROM users WHERE id = ?', 
                    [user.id], 
                    (err, updatedUser) => {
                        if (err) return res.status(500).json({ error: 'Database error' });
                        
                        let pointsRemaining = updatedUser.points_since_last_dollar;
                        let dollarsEarned = updatedUser.dollars_earned;
                        
                        // Convert points to dollars (100,000 points = $1)
                        while (pointsRemaining >= 100000) {
                            dollarsEarned += 1;
                            pointsRemaining -= 100000;
                        }
                        
                        // Update dollars and remaining points
                        db.run('UPDATE users SET dollars_earned = ?, points_since_last_dollar = ? WHERE id = ?', 
                            [dollarsEarned, pointsRemaining, user.id],
                            (err) => {
                                if (err) return res.status(500).json({ error: 'Database error' });
                                
                                // Record transaction
                                db.run('INSERT INTO transactions (user_id, type, amount, details) VALUES (?, ?, ?, ?)',
                                    [user.id, type, actualPoints, details || '']);
                                
                                res.json({ 
                                    success: true, 
                                    points: actualPoints,
                                    dollarsEarned: dollarsEarned,
                                    pointsSinceLastDollar: pointsRemaining
                                });
                            }
                        );
                    }
                );
            }
        );
    });
});

app.post('/api/complete-social', (req, res) => {
    const { telegramId, taskId } = req.body;
    if (!telegramId || !taskId) return res.status(400).json({ error: 'Missing parameters' });
    
    db.get('SELECT id, social_completions, points_since_last_dollar, dollars_earned FROM users WHERE telegram_id = ?', [telegramId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'User not found' });
        
        let socialCompletions = {};
        try {
            socialCompletions = JSON.parse(user.social_completions || '{}');
        } catch (e) {
            socialCompletions = {};
        }
        
        if (socialCompletions[taskId]) {
            return res.status(400).json({ error: 'Task already completed' });
        }
        
        // Add $50 (5,000,000 points)
        socialCompletions[taskId] = true;
        const pointsToAdd = 5000000;
        
        // First update points
        db.run('UPDATE users SET points_since_last_dollar = points_since_last_dollar + ? WHERE id = ?', 
            [pointsToAdd, user.id], 
            (err) => {
                if (err) return res.status(500).json({ error: 'Database error' });
                
                // Now check for dollar conversion
                db.get('SELECT points_since_last_dollar, dollars_earned FROM users WHERE id = ?', 
                    [user.id], 
                    (err, updatedUser) => {
                        if (err) return res.status(500).json({ error: 'Database error' });
                        
                        let pointsRemaining = updatedUser.points_since_last_dollar;
                        let dollarsEarned = updatedUser.dollars_earned;
                        
                        // Convert points to dollars (100,000 points = $1)
                        while (pointsRemaining >= 100000) {
                            dollarsEarned += 1;
                            pointsRemaining -= 100000;
                        }
                        
                        // Update dollars, remaining points, and social completions
                        db.run('UPDATE users SET dollars_earned = ?, points_since_last_dollar = ?, social_completions = ? WHERE id = ?', 
                            [dollarsEarned, pointsRemaining, JSON.stringify(socialCompletions), user.id],
                            (err) => {
                                if (err) return res.status(500).json({ error: 'Database error' });
                                
                                res.json({ 
                                    success: true, 
                                    points: pointsToAdd,
                                    dollarsEarned: dollarsEarned,
                                    pointsSinceLastDollar: pointsRemaining
                                });
                            }
                        );
                    }
                );
            }
        );
    });
});

app.post('/api/set-wallet', (req, res) => {
    const { telegramId, walletAddress } = req.body;
    if (!telegramId || !walletAddress) return res.status(400).json({ error: 'Missing parameters' });
    
    db.run('UPDATE users SET wallet_address = ? WHERE telegram_id = ?', [walletAddress, telegramId], (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ success: true });
    });
});

app.post('/api/request-withdrawal', (req, res) => {
    const { telegramId } = req.body;
    
    db.get('SELECT id, dollars_earned, wallet_address FROM users WHERE telegram_id = ?', [telegramId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'User not found' });
        
        if (user.dollars_earned < 1000) return res.status(400).json({ error: 'Insufficient balance' });
        if (!user.wallet_address) return res.status(400).json({ error: 'Wallet not set' });
        
        db.run('INSERT INTO withdrawals (user_id, amount, wallet_address) VALUES (?, ?, ?)',
            [user.id, user.dollars_earned, user.wallet_address],
            function(err) {
                if (err) return res.status(500).json({ error: 'Database error' });
                
                const adminMsg = `⚠️ *New Withdrawal Request*\n\n` +
                    `👤 User: #user${user.id}\n` +
                    `💵 Amount: $${user.dollars_earned.toFixed(2)}\n` +
                    `🔑 Wallet: ${user.wallet_address}\n` +
                    `🆔 Request ID: ${this.lastID}`;
                
                bot.sendMessage(adminChatId, adminMsg, { parse_mode: 'Markdown' });
                
                // Reset user's balance after withdrawal
                db.run('UPDATE users SET dollars_earned = 0, points_since_last_dollar = 0 WHERE id = ?', [user.id]);
                res.json({ success: true });
            }
        );
    });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`WebApp URL: ${webAppUrl}`);
    console.log(`Bot: https://t.me/YzemanBot`);
});