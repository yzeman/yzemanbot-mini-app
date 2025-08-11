require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { Pool } = require('pg');
const botApp = express();
const PORT = process.env.BOT_PORT || 3002;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Get bot token from environment variables
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('❌ BOT_TOKEN environment variable is not set!');
  process.exit(1);
}

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

// Command handlers
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '🚀 Welcome to YzemanBot! Use /earn to start earning rewards');
});

bot.onText(/\/earn/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '💎 Open our mini-app to earn points:', {
    reply_markup: {
      inline_keyboard: [[{
        text: '✨ Open Earn Portal',
        web_app: { url: process.env.MINI_APP_URL || 'https://yzemanbot-mini-app.onrender.com' }
      }]]
    }
  });
});

bot.onText(/\/refer/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  try {
    // Get user's referral code from database
    const user = await pool.query(
      'SELECT referral_code FROM users WHERE telegram_id = $1',
      [userId]
    );
    
    if (user.rows.length > 0) {
      const code = user.rows[0].referral_code;
      const link = `https://t.me/YzemanBot?start=ref-${code}`;
      bot.sendMessage(chatId, `📣 Share your referral link to earn rewards:\n\n${link}\n\nFor each friend who joins, you'll earn points!`);
    } else {
      bot.sendMessage(chatId, '❌ Please use the mini-app first to create your account and get a referral code');
    }
  } catch (err) {
    console.error('Referral error:', err);
    bot.sendMessage(chatId, '⚠️ Error getting referral information. Please try again later.');
  }
});

bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
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
      bot.sendMessage(chatId, '❌ Account not found. Please use the mini-app first to create your account.');
    }
  } catch (err) {
    console.error('Balance error:', err);
    bot.sendMessage(chatId, '⚠️ Error retrieving balance. Please try again later.');
  }
});

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

bot.on('webhook_error', (error) => {
  console.error('Webhook error:', error);
});

// Start bot server
botApp.listen(PORT, () => {
  console.log(`🤖 Telegram bot running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});