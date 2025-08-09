require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Initialize bot
const bot = new TelegramBot(process.env.BOT_TOKEN, {polling: true});

// Backend configuration
const BACKEND_URL = process.env.BACKEND_URL || 'https://yzemanbot-app-server.onrender.com';

// Helper function to get user ID from referral code
async function getUserIdFromCode(referralCode) {
  try {
    // In a real implementation, you would query your database here
    // For now, we'll assume the code is in format USERID-CODE
    const userId = referralCode.split('-')[0];
    return parseInt(userId);
  } catch (error) {
    console.error('Error parsing referral code:', error);
    return null;
  }
}

// Handle /start with referral
bot.onText(/\/start ref-(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  
  try {
    const referralCode = match[1];
    const referrerId = await getUserIdFromCode(referralCode);
    
    if (!referrerId) {
      return bot.sendMessage(chatId, '⚠️ Invalid referral code. Please use a valid link.');
    }

    const response = await axios.post(`${BACKEND_URL}/api/referral`, {
      referrerId: referrerId,
      referredId: msg.from.id
    }, {
      headers: {'Content-Type': 'application/json'}
    });

    if (response.data.success) {
      await bot.sendMessage(chatId, '✅ Referral registered successfully! You earned 1000 points!');
      
      // Get referrer's info to notify them
      try {
        const userResponse = await axios.get(`${BACKEND_URL}/api/user/${referrerId}`);
        const referrerChatId = userResponse.data.telegram_id;
        
        if (referrerChatId) {
          await bot.sendMessage(
            referrerChatId,
            `🎉 New referral! ${msg.from.first_name} joined using your link. You earned ${response.data.reward || 1000} points!`
          );
        }
      } catch (error) {
        console.error('Error notifying referrer:', error);
      }
    } else {
      throw new Error('Failed to register referral');
    }
  } catch (error) {
    console.error('Referral error:', error);
    await bot.sendMessage(chatId, '⚠️ Failed to register referral. You may have already used a referral link.');
  }
});

// Set webhook (for production)
if (process.env.NODE_ENV === 'production') {
  const WEBAPP_URL = process.env.WEBAPP_URL || 'https://yzemanbot-app-server.onrender.com';
  
  bot.setWebHook(`${WEBAPP_URL}/bot${process.env.BOT_TOKEN}`)
    .then(() => console.log('Webhook set successfully'))
    .catch(err => console.error('Error setting webhook:', err));
}

// Handle basic commands
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name;
  
  bot.sendMessage(
    chatId,
    `👋 Welcome ${firstName} to YzemanBot!\n\n` +
    `💰 Earn points by completing tasks and referring friends\n` +
    `📊 Check your progress at ${BACKEND_URL}\n\n` +
    `🔗 Share your referral link to earn more: /referral`
  );
});

bot.onText(/\/referral/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    // Get user's referral code from backend
    const response = await axios.get(`${BACKEND_URL}/api/user/${msg.from.id}`);
    const user = response.data;
    
    if (user && user.referral_code) {
      const referralLink = `https://t.me/YzemanBot?start=ref-${user.referral_code}`;
      
      await bot.sendMessage(
        chatId,
        `📢 Share your referral link to earn points:\n\n` +
        `${referralLink}\n\n` +
        `You'll earn ${user.tier?.referral_reward || 1000} points for each friend who joins!`
      );
    } else {
      throw new Error('No referral code found');
    }
  } catch (error) {
    console.error('Referral error:', error);
    await bot.sendMessage(
      chatId,
      '⚠️ Could not generate your referral link. Please try again later.'
    );
  }
});

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

console.log('YzemanBot is running...');
