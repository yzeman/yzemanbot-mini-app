require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { Pool } = require('pg');
const { nanoid } = require('nanoid'); // For referral codes
const botApp = express();
const PORT = process.env.BOT_PORT || 3002;

// Validate environment variables
const requiredEnv = ['BOT_TOKEN', 'DATABASE_URL'];
requiredEnv.forEach(env => {
  if (!process.env[env]) {
    console.error(`❌ ${env} environment variable is not set!`);
    process.exit(1);
  }
});

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database tables
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        referral_code TEXT UNIQUE NOT NULL,
        points BIGINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id BIGINT NOT NULL REFERENCES users(telegram_id),
        referee_id BIGINT NOT NULL UNIQUE REFERENCES users(telegram_id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    console.log('✅ Database tables initialized');
  } catch (err) {
    console.error('❌ Database initialization error:', err);
    process.exit(1);
  }
}

// Get bot token
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Health check endpoint
botApp.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    service: 'telegram-bot',
    timestamp: new Date().toISOString()
  });
});

// Set bot commands
bot.setMyCommands([
  { command: '/start', description: 'Start the bot' },
  { command: '/earn', description: 'Earn points' },
  { command: '/refer', description: 'Get referral link' },
  { command: '/balance', description: 'Check balance' }
]);

// Rate limiting (5 seconds cooldown)
const userCooldowns = new Map();

function checkCooldown(userId) {
  const now = Date.now();
  const lastCommandTime = userCooldowns.get(userId) || 0;
  if (now - lastCommandTime < 5000) {
    return false;
  }
  userCooldowns.set(userId, now);
  return true;
}

// Command: /start with referral support
bot.onText(/\/start(?: ref-(\w+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const referralCode = match?.[1]; // Extract referral code if exists

  // Log command usage
  console.log(`[CMD] /start from ${userId} at ${new Date().toISOString()}`);

  try {
    // Create user if not exists
    const newReferralCode = nanoid(6);
    await pool.query(`
      INSERT INTO users (telegram_id, referral_code)
      VALUES ($1, $2)
      ON CONFLICT (telegram_id) DO UPDATE SET telegram_id = $1
      RETURNING id
    `, [userId, newReferralCode]);

    // Process referral
    if (referralCode) {
      const referrer = await pool.query(
        'SELECT telegram_id FROM users WHERE referral_code = $1',
        [referralCode]
      );

      if (referrer.rows.length > 0 && referrer.rows[0].telegram_id !== userId) {
        const referrerId = referrer.rows[0].telegram_id;
        
        // Check if referral is new
        const existing = await pool.query(
          'SELECT id FROM referrals WHERE referee_id = $1',
          [userId]
        );

        if (existing.rows.length === 0) {
          // Update points and create referral record
          await Promise.all([
            pool.query(`
              UPDATE users SET points = points + 100 
              WHERE telegram_id = $1
            `, [referrerId]),
            
            pool.query(`
              INSERT INTO referrals (referrer_id, referee_id)
              VALUES ($1, $2)
            `, [referrerId, userId])
          ]);
          
          bot.sendMessage(chatId, '🎉 You joined via referral! 100 points added to your referrer');
        }
      }
    }

    bot.sendMessage(chatId, '🚀 Welcome to YzemanBot! Use /earn to start earning rewards');
  } catch (err) {
    console.error('Start error:', err);
    bot.sendMessage(chatId, '⚠️ Setup failed. Please try again.');
  }
});

// Command: /earn
bot.onText(/\/earn/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  console.log(`[CMD] /earn from ${userId} at ${new Date().toISOString()}`);
  
  if (!checkCooldown(userId)) {
    return bot.sendMessage(chatId, '❌ Please wait 5 seconds between commands');
  }

  bot.sendMessage(chatId, '💎 Open our mini-app to earn points:', {
    reply_markup: {
      inline_keyboard: [[{
        text: '✨ Open Earn Portal',
        web_app: { url: process.env.MINI_APP_URL || 'https://yzemanbot-mini-app.onrender.com' }
      }]]
    }
  });
});

// Command: /refer
bot.onText(/\/refer/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  console.log(`[CMD] /refer from ${userId} at ${new Date().toISOString()}`);
  
  if (!checkCooldown(userId)) {
    return bot.sendMessage(chatId, '❌ Please wait 5 seconds between commands');
  }

  try {
    const user = await pool.query(
      'SELECT referral_code FROM users WHERE telegram_id = $1',
      [userId]
    );
    
    if (user.rows.length > 0) {
      const code = user.rows[0].referral_code;
      const link = `https://t.me/YzemanBot?start=ref-${code}`;
      bot.sendMessage(chatId, `📣 Share your referral link:\n\n${link}\n\nFor each friend who joins, you'll earn 100 points!`);
    } else {
      bot.sendMessage(chatId, '❌ Account not found. Please use /start first');
    }
  } catch (err) {
    console.error('Referral error:', err);
    bot.sendMessage(chatId, '⚠️ Error getting referral information');
  }
});

// Command: /balance
bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  console.log(`[CMD] /balance from ${userId} at ${new Date().toISOString()}`);
  
  if (!checkCooldown(userId)) {
    return bot.sendMessage(chatId, '❌ Please wait 5 seconds between commands');
  }

  try {
    const user = await pool.query(
      'SELECT points FROM users WHERE telegram_id = $1',
      [userId]
    );
    
    if (user.rows.length > 0) {
      const points = user.rows[0].points;
      const usd = (points / 100000).toFixed(2);
      bot.sendMessage(chatId, `💰 Your balance: ${points.toLocaleString()} points ($${usd} USD)`);
    } else {
      bot.sendMessage(chatId, '❌ Account not found. Please use /start first');
    }
  } catch (err) {
    console.error('Balance error:', err);
    bot.sendMessage(chatId, '⚠️ Error retrieving balance');
  }
});

// Handle mini-app reward claims
bot.on('message', async (msg) => {
  if (msg.web_app_data) {
    const userId = msg.from.id;
    console.log(`[MINI-APP] Reward claim from ${userId}`);
    
    try {
      const data = JSON.parse(msg.web_app_data.data);
      
      // Validate reward amount
      if (typeof data.reward === 'number' && data.reward > 0 && data.reward <= 1000) {
        await pool.query(`
          UPDATE users SET points = points + $1 
          WHERE telegram_id = $2
        `, [data.reward, userId]);
        
        bot.sendMessage(msg.chat.id, `🎉 You earned ${data.reward} points!`);
      } else {
        throw new Error('Invalid reward amount');
      }
    } catch (err) {
      console.error('Web-app error:', err);
      bot.sendMessage(msg.chat.id, '⚠️ Failed to process reward');
    }
  }
});

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

bot.on('webhook_error', (error) => {
  console.error('Webhook error:', error);
});

// Start server after DB init
initDB().then(() => {
  botApp.listen(PORT, () => {
    console.log(`🤖 Bot server running on port ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  });
});