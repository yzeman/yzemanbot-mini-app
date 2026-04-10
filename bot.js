const { Telegraf, session } = require('telegraf');
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
    console.log('📨 /start command received from user:', ctx.from.id);
    
    const args = ctx.message.text.split(' ');
    let referralCode = args[1];
    
    console.log('Raw referral code from URL:', referralCode);
    
    // Remove any 'ref-' prefix if present to clean it
    if (referralCode && referralCode.startsWith('ref-')) {
        referralCode = referralCode.substring(4);
        console.log('Cleaned referral code (removed ref-):', referralCode);
    }
    if (referralCode && referralCode.startsWith('YZEMAN-')) {
        referralCode = referralCode.substring(7);
        console.log('Cleaned referral code (removed YZEMAN-):', referralCode);
    }
    
    // Store referral code in session
    if (referralCode) {
        ctx.session.referralCode = referralCode;
        console.log(`📝 Referral code stored: ${referralCode} for user ${ctx.from.id}`);
    }
    
    // Create keyboard with Mini App button that passes the referral code
    let webAppUrl = MINI_APP_URL;
    if (referralCode) {
        webAppUrl = `${MINI_APP_URL}?start=ref-${referralCode}`;
    }
    
    console.log('Opening Mini App URL:', webAppUrl);
    
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
    
    // Welcome message - using HTML instead of Markdown to avoid parsing errors
    let message = `🎉 <b>Welcome to Yzeman Bot!</b>\n\n`;
    message += `Earn points by referring friends and watching ads.\n\n`;
    
    if (referralCode) {
        message += `✅ <b>You were referred!</b>\n`;
        message += `Open the app below to claim your bonus. 🎁\n\n`;
    } else {
        message += `Open the app below to get started! 🚀\n\n`;
    }
    
    message += `<b>📊 Features:</b>\n`;
    message += `• Refer friends to earn points\n`;
    message += `• Watch ads for rewards\n`;
    message += `• Climb tiers (Fresher → Platinum)\n`;
    message += `• Higher tiers = more rewards!`;
    
    ctx.reply(message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
    }).then(() => {
        console.log('✅ Reply sent to user:', ctx.from.id);
    }).catch(err => {
        console.error('❌ Failed to send reply:', err.message);
    });
});

// Handle help button
bot.action('help', async (ctx) => {
    ctx.answerCbQuery();
    
    let helpMessage = `<b>📖 How to use Yzeman Bot:</b>\n\n`;
    helpMessage += `<b>1. Earn Points:</b>\n`;
    helpMessage += `   • Share your referral link with friends\n`;
    helpMessage += `   • Watch ads in the Mini App\n`;
    helpMessage += `   • Each referral gives you points\n\n`;
    helpMessage += `<b>2. Referral System:</b>\n`;
    helpMessage += `   • Get your unique code in the app\n`;
    helpMessage += `   • Share link: t.me/YzemanBot?start=YOUR_CODE\n`;
    helpMessage += `   • Earn rewards when friends join\n\n`;
    helpMessage += `<b>3. Tiers & Multipliers:</b>\n`;
    helpMessage += `   • Fresher (0 refs) - 1.0x multiplier\n`;
    helpMessage += `   • Brute (50 refs) - 1.2x multiplier\n`;
    helpMessage += `   • Silver (150 refs) - 1.5x multiplier\n`;
    helpMessage += `   • Gold (300 refs) - 2.0x multiplier\n`;
    helpMessage += `   • Platinum (500 refs) - 3.0x multiplier\n\n`;
    helpMessage += `Open the app below to start earning! 🚀`;
    
    ctx.reply(helpMessage, { parse_mode: 'HTML' });
});

// Error handling
bot.catch((err, ctx) => {
    console.error(`❌ Bot error for user ${ctx.from?.id}:`, err);
    ctx.reply('Sorry, something went wrong. Please try again later.');
});

// Start the bot using polling
console.log('🤖 Starting bot in polling mode...');
bot.launch().then(() => {
    console.log('✅ Bot is running and listening for commands!');
    console.log('📱 Bot username: @YzemanBot');
}).catch(err => {
    console.error('❌ Failed to launch bot:', err);
    process.exit(1);
});

// Enable graceful stop
process.once('SIGINT', () => {
    console.log('🛑 SIGINT received, stopping bot...');
    bot.stop('SIGINT');
    process.exit(0);
});
process.once('SIGTERM', () => {
    console.log('🛑 SIGTERM received, stopping bot...');
    bot.stop('SIGTERM');
    process.exit(0);
});

console.log('🤖 Yzeman Bot is running in polling mode...');
