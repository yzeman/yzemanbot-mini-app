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
    const referralCode = args[1]; // This captures the referral code like ?start=CODE
    
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
            ],
            [
                {
                    text: '❓ How it works',
                    callback_data: 'help'
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
    message += `• Climb tiers (Fresher → Platinum)\n`;
    message += `• Higher tiers = more rewards!`;
    
    ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
});

// Handle help button
bot.action('help', async (ctx) => {
    ctx.answerCbQuery();
    
    let helpMessage = `📖 *How to use Yzeman Bot:*\n\n`;
    helpMessage += `*1. Earn Points:*\n`;
    helpMessage += `   • Share your referral link with friends\n`;
    helpMessage += `   • Watch ads in the Mini App\n`;
    helpMessage += `   • Each referral gives you points\n\n`;
    helpMessage += `*2. Referral System:*\n`;
    helpMessage += `   • Get your unique code in the app\n`;
    helpMessage += `   • Share link: t.me/YzemanBot?start=YOUR_CODE\n`;
    helpMessage += `   • Earn rewards when friends join\n\n`;
    helpMessage += `*3. Tiers & Multipliers:*\n`;
    helpMessage += `   • Fresher (0 refs) - 1.0x multiplier\n`;
    helpMessage += `   • Brute (50 refs) - 1.2x multiplier\n`;
    helpMessage += `   • Silver (150 refs) - 1.5x multiplier\n`;
    helpMessage += `   • Gold (300 refs) - 2.0x multiplier\n`;
    helpMessage += `   • Platinum (500 refs) - 3.0x multiplier\n\n`;
    helpMessage += `Open the app below to start earning! 🚀`;
    
    ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

// Webhook setup for Render
const app = express();

app.use(express.json());

app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
    bot.handleUpdate(req.body, res);
    res.sendStatus(200);
});

app.get('/bot-health', (req, res) => {
    res.status(200).json({ status: 'Bot is running', time: new Date().toISOString() });
});

const PORT = process.env.BOT_PORT || 3002;

// Start the bot
if (process.env.NODE_ENV === 'production') {
    // Use webhook in production on Render
    const WEBHOOK_URL = `${process.env.RENDER_EXTERNAL_URL || 'https://yzemanbot-backend.onrender.com'}/webhook/${BOT_TOKEN}`;
    
    bot.telegram.setWebhook(WEBHOOK_URL).then(() => {
        console.log(`✅ Webhook set to: ${WEBHOOK_URL}`);
    }).catch(err => {
        console.error('❌ Webhook setup failed:', err.message);
    });
    
    app.listen(PORT, () => {
        console.log(`🤖 Bot webhook server running on port ${PORT}`);
    });
} else {
    // Use polling in development
    bot.launch();
    console.log('🤖 Bot started in polling mode');
}

// Enable graceful stop
process.once('SIGINT', () => {
    bot.stop('SIGINT');
    process.exit(0);
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    process.exit(0);
});

console.log('🤖 Yzeman Bot is running...');
