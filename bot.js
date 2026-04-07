const { Telegraf, session } = require('telegraf');
const express = require('express');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://yzemanbot-backend.onrender.com';

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN is required');
    process.exit(1);
}

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);

// Enable session to store referral codes temporarily
bot.use(session());

// Handle /start command with referral parameter
bot.command('start', (ctx) => {
    const args = ctx.message.text.split(' ');
    const referralCode = args[1]; // This captures the referral code
    
    // Store referral code in session
    if (referralCode) {
        ctx.session.referralCode = referralCode;
        console.log(`📝 Referral code stored: ${referralCode} for user ${ctx.from.id}`);
    }
    
    // Create keyboard with Mini App button that passes the referral code
    let webAppUrl = MINI_APP_URL;
    if (referralCode) {
        webAppUrl = `${MINI_APP_URL}?start=${referralCode}`;
    }
    
    const keyboard = {
        inline_keyboard: [
            [
                {
                    text: '🚀 Open Yzeman Bot App',
                    web_app: { url: webAppUrl }
                }
            ]
        ]
    };
    
    // Welcome message
    let message = `🎉 *Welcome to Yzeman Bot!*\n\n`;
    message += `Earn points by referring friends and watching ads.\n\n`;
    
    if (referralCode) {
        message += `✅ *You were referred!*\n`;
        message += `Open the app below to claim your bonus. 🎁\n\n`;
    } else {
        message += `Open the app below to get started! 🚀\n\n`;
    }
    
    message += `📊 *Features:*\n`;
    message += `• Refer friends to earn points\n`;
    message += `• Watch ads for rewards\n`;
    message += `• Climb tiers (Fresher → Platinum)`;
    
    ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
});

// Webhook setup for Render
const app = express();

app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
    bot.handleUpdate(req.body, res);
    res.sendStatus(200);
});

app.get('/bot-health', (req, res) => {
    res.status(200).json({ status: 'Bot is running' });
});

const PORT = process.env.BOT_PORT || 3002;

if (process.env.NODE_ENV === 'production') {
    const WEBHOOK_URL = `${process.env.RENDER_EXTERNAL_URL || 'https://yzemanbot-backend.onrender.com'}/webhook/${BOT_TOKEN}`;
    bot.telegram.setWebhook(WEBHOOK_URL);
    console.log(`✅ Webhook set to: ${WEBHOOK_URL}`);
    
    app.listen(PORT, () => {
        console.log(`🤖 Bot webhook server running on port ${PORT}`);
    });
} else {
    bot.launch();
    console.log('🤖 Bot started in polling mode');
}

console.log('🤖 Yzeman Bot is running...');
