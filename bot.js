const { Telegraf, session } = require('telegraf');
const express = require('express');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://yzemanbot-backend.onrender.com';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

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
    
    // Create keyboard with Mini App button
    const keyboard = {
        inline_keyboard: [
            [
                {
                    text: '🚀 Open Yzeman Bot App',
                    web_app: { url: MINI_APP_URL }
                }
            ],
            [
                {
                    text: '❓ Help',
                    callback_data: 'help'
                }
            ]
        ]
    };
    
    // Welcome message
    let message = `Welcome to Yzeman Bot! 🎉\n\n`;
    message += `Earn points by referring friends and watching ads.\n\n`;
    
    if (referralCode) {
        message += `✅ You were referred by someone!\n`;
        message += `Open the app below to claim your bonus. 🎁\n\n`;
    } else {
        message += `Open the app below to get started! 🚀\n\n`;
    }
    
    message += `📊 **Features:**\n`;
    message += `• Refer friends to earn points\n`;
    message += `• Watch ads for rewards\n`;
    message += `• Climb tiers (Fresher → Platinum)\n`;
    message += `• Higher tiers = more rewards!`;
    
    ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
});

// Handle help callback
bot.action('help', (ctx) => {
    ctx.answerCbQuery();
    
    const helpMessage = `📖 **How to use Yzeman Bot:**\n\n`;
    helpMessage += `1️⃣ **Earn Points:**\n`;
    helpMessage += `   • Refer friends using your unique code\n`;
    helpMessage += `   • Watch ads in the Mini App\n\n`;
    helpMessage += `2️⃣ **Referral System:**\n`;
    helpMessage += `   • Share your referral link: ${await getReferralLink(ctx.from.id)}\n`;
    helpMessage += `   • Get points when friends join\n\n`;
    helpMessage += `3️⃣ **Tiers:**\n`;
    helpMessage += `   • Fresher (0 refs) - 1.0x multiplier\n`;
    helpMessage += `   • Brute (50 refs) - 1.2x multiplier\n`;
    helpMessage += `   • Silver (150 refs) - 1.5x multiplier\n`;
    helpMessage += `   • Gold (300 refs) - 2.0x multiplier\n`;
    helpMessage += `   • Platinum (500 refs) - 3.0x multiplier\n\n`;
    helpMessage += `Open the app to start earning! 🚀`;
    
    ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

// Helper function to get user's referral link
async function getReferralLink(telegramId) {
    // You can query your database here to get the user's referral code
    // For now, return a placeholder
    return `https://t.me/${ctx.bot.info.username}?start=REF_CODE`;
}

// Webhook or polling setup for Render
const app = express();

// Webhook endpoint (for production on Render)
app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
    bot.handleUpdate(req.body, res);
    res.sendStatus(200);
});

// Health check
app.get('/bot-health', (req, res) => {
    res.status(200).json({ status: 'Bot is running' });
});

// Start the bot
const PORT = process.env.BOT_PORT || 3002;

if (process.env.NODE_ENV === 'production') {
    // Use webhook in production
    const WEBHOOK_URL = `${process.env.RENDER_EXTERNAL_URL}/webhook/${BOT_TOKEN}`;
    bot.telegram.setWebhook(WEBHOOK_URL);
    console.log(`✅ Webhook set to: ${WEBHOOK_URL}`);
    
    app.listen(PORT, () => {
        console.log(`🤖 Bot webhook server running on port ${PORT}`);
    });
} else {
    // Use polling in development
    bot.launch();
    console.log('🤖 Bot started in polling mode');
}

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('🤖 Yzeman Bot is running...');
