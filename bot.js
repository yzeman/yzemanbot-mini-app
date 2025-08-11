const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const botApp = express();
const PORT = process.env.BOT_PORT || 3002;

// Replace with your bot token
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

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
  bot.sendMessage(chatId, 'Welcome to YzemanBot! Use /earn to start earning rewards');
});

bot.onText(/\/earn/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Open our mini-app to earn points:', {
    reply_markup: {
      inline_keyboard: [[{
        text: 'Open Earn Portal',
        web_app: { url: 'https://yzemanbot-mini-app.onrender.com' }
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
      bot.sendMessage(chatId, `Share your referral link: ${link}`);
    } else {
      bot.sendMessage(chatId, 'Please start the mini-app first to get your referral code');
    }
  } catch (err) {
    bot.sendMessage(chatId, 'Error getting referral information');
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
      bot.sendMessage(chatId, `Your balance: ${points} points ($${usd})`);
    } else {
      bot.sendMessage(chatId, 'Account not found. Please use the mini-app first.');
    }
  } catch (err) {
    bot.sendMessage(chatId, 'Error retrieving balance');
  }
});

// Start bot server
botApp.listen(PORT, () => {
  console.log(`Bot running on port ${PORT}`);
});