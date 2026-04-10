const { Telegraf } = require('telegraf');
const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://yzemanbot-backend.onrender.com';

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN is required');
    process.exit(1);
}

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
});

// Create express app for health check
const app = express();
const PORT = process.env.PORT || 3002;

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', bot: 'running', time: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.send('🤖 Yzeman Bot is running!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Health server running on port ${PORT}`);
});

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);

// Helper: Get user info from database
async function getUserByTelegramId(telegramId) {
    const result = await pool.query(
        'SELECT id, username, first_name, points, referrals, referral_code, tier FROM users WHERE telegram_id = $1',
        [telegramId]
    );
    return result.rows[0] || null;
}

// Helper: Get referrer by referral code
async function getReferrerByCode(referralCode) {
    // Clean the code
    let cleanCode = referralCode;
    if (cleanCode.startsWith('ref-')) cleanCode = cleanCode.substring(4);
    if (cleanCode.startsWith('YZEMAN-')) cleanCode = cleanCode.substring(7);
    
    // Try multiple formats
    let result = await pool.query(
        'SELECT id, username, first_name, points, referrals FROM users WHERE referral_code = $1',
        [cleanCode]
    );
    
    if (result.rows.length === 0) {
        result = await pool.query(
            'SELECT id, username, first_name, points, referrals FROM users WHERE referral_code = $1',
            [`ref-${cleanCode}`]
        );
    }
    
    if (result.rows.length === 0) {
        result = await pool.query(
            'SELECT id, username, first_name, points, referrals FROM users WHERE referral_code = $1',
            [`YZEMAN-${cleanCode}`]
        );
    }
    
    return result.rows[0] || null;
}

// Handle /start command
bot.command('start', async (ctx) => {
    console.log('📨 /start command received from user:', ctx.from.id);
    
    const args = ctx.message.text.split(' ');
    let rawReferralCode = args[1];
    let referralInfo = null;
    
    // Clean referral code
    if (rawReferralCode) {
        let cleanCode = rawReferralCode;
        if (cleanCode.startsWith('ref-')) cleanCode = cleanCode.substring(4);
        if (cleanCode.startsWith('YZEMAN-')) cleanCode = cleanCode.substring(7);
        
        // Check if referrer exists in database
        referralInfo = await getReferrerByCode(cleanCode);
        
        if (referralInfo) {
            console.log(`✅ Valid referral code: ${rawReferralCode} from user ${referralInfo.id} (${referralInfo.username || referralInfo.first_name})`);
        } else {
            console.log(`⚠️ Invalid referral code: ${rawReferralCode}`);
        }
    }
    
    // Create keyboard with Mini App button
    let webAppUrl = MINI_APP_URL;
    if (rawReferralCode) {
        webAppUrl = `${MINI_APP_URL}?start=${rawReferralCode}`;
    }
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '🚀 Open Yzeman Bot App', web_app: { url: webAppUrl } }],
            [{ text: '❓ How it works', callback_data: 'help' }],
            [{ text: '📊 My Stats', callback_data: 'stats' }],
            [{ text: '👥 My Referrals', callback_data: 'referrals' }]
        ]
    };
    
    // Get user's own stats if they exist
    const userStats = await getUserByTelegramId(ctx.from.id);
    
    let message = `🎉 <b>Welcome to Yzeman Bot!</b>\n\n`;
    message += `Earn points by referring friends and watching ads.\n\n`;
    
    if (rawReferralCode && referralInfo) {
        message += `✅ <b>You were referred by ${referralInfo.first_name || referralInfo.username || 'a friend'}!</b>\n`;
        message += `Open the app below to claim your bonus. 🎁\n\n`;
    } else if (rawReferralCode && !referralInfo) {
        message += `⚠️ <b>Invalid referral code!</b>\n`;
        message += `The code "${rawReferralCode}" is not valid.\n\n`;
    }
    
    if (userStats) {
        message += `<b>📊 Your Stats:</b>\n`;
        message += `💰 Points: ${userStats.points?.toLocaleString() || 0}\n`;
        message += `👥 Referrals: ${userStats.referrals || 0}\n`;
        message += `🏆 Tier: ${userStats.tier || 'Fresher'}\n\n`;
    }
    
    message += `<b>📊 Features:</b>\n`;
    message += `• Refer friends to earn points\n`;
    message += `• Watch ads for rewards\n`;
    message += `• Climb tiers (Fresher → Platinum)\n`;
    message += `• Higher tiers = more rewards!`;
    
    ctx.reply(message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
    }).catch(err => console.error('Failed to send reply:', err.message));
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

// Handle stats button
bot.action('stats', async (ctx) => {
    ctx.answerCbQuery();
    
    const userStats = await getUserByTelegramId(ctx.from.id);
    
    if (!userStats) {
        ctx.reply("You haven't registered yet. Open the Mini App to get started!");
        return;
    }
    
    let statsMessage = `<b>📊 Your YzemanBot Stats</b>\n\n`;
    statsMessage += `💰 <b>Points:</b> ${userStats.points?.toLocaleString() || 0}\n`;
    statsMessage += `💵 <b>USD Value:</b> $${((userStats.points || 0) / 100000).toFixed(2)}\n`;
    statsMessage += `👥 <b>Referrals:</b> ${userStats.referrals || 0}\n`;
    statsMessage += `🏆 <b>Tier:</b> ${userStats.tier || 'Fresher'}\n`;
    statsMessage += `🔗 <b>Your Referral Link:</b>\n`;
    statsMessage += `t.me/YzemanBot?start=${userStats.referral_code}\n\n`;
    statsMessage += `Share your link and earn points when friends join! 🚀`;
    
    ctx.reply(statsMessage, { parse_mode: 'HTML' });
});

// Handle referrals button - show list of people who joined using user's code
bot.action('referrals', async (ctx) => {
    ctx.answerCbQuery();
    
    const userStats = await getUserByTelegramId(ctx.from.id);
    
    if (!userStats) {
        ctx.reply("You haven't registered yet. Open the Mini App to get started!");
        return;
    }
    
    // Get detailed referral list
    const referralsList = await pool.query(
        `SELECT u.first_name, u.username, u.created_at 
         FROM referrals r 
         JOIN users u ON r.referred_id = u.id 
         WHERE r.referrer_id = $1 
         ORDER BY r.created_at DESC 
         LIMIT 20`,
        [userStats.id]
    );
    
    let message = `<b>👥 Your Referrals</b>\n\n`;
    message += `📊 <b>Total:</b> ${userStats.referrals || 0} people joined using your link\n\n`;
    
    if (referralsList.rows.length > 0) {
        message += `<b>📜 Recent Referrals:</b>\n`;
        referralsList.rows.slice(0, 10).forEach((ref, index) => {
            const name = ref.first_name || ref.username || 'Someone';
            const date = new Date(ref.created_at).toLocaleDateString();
            message += `${index + 1}. ${name} (${date})\n`;
        });
    } else {
        message += `No referrals yet.\n`;
    }
    
    message += `\n🔗 <b>Your Referral Link:</b>\n`;
    message += `t.me/YzemanBot?start=${userStats.referral_code}\n\n`;
    message += `Share your link and earn points when friends join! 🚀`;
    
    ctx.reply(message, { parse_mode: 'HTML' });
});

// Command to check referrals (alternative to button)
bot.command('referrals', async (ctx) => {
    const userStats = await getUserByTelegramId(ctx.from.id);
    
    if (!userStats) {
        ctx.reply("You haven't registered yet. Open the Mini App to get started!");
        return;
    }
    
    const referralsList = await pool.query(
        `SELECT u.first_name, u.username, u.created_at 
         FROM referrals r 
         JOIN users u ON r.referred_id = u.id 
         WHERE r.referrer_id = $1 
         ORDER BY r.created_at DESC 
         LIMIT 20`,
        [userStats.id]
    );
    
    let message = `<b>👥 Your Referrals</b>\n\n`;
    message += `📊 <b>Total:</b> ${userStats.referrals || 0} people joined using your link\n\n`;
    
    if (referralsList.rows.length > 0) {
        message += `<b>📜 Recent Referrals:</b>\n`;
        referralsList.rows.slice(0, 10).forEach((ref, index) => {
            const name = ref.first_name || ref.username || 'Someone';
            const date = new Date(ref.created_at).toLocaleDateString();
            message += `${index + 1}. ${name} (${date})\n`;
        });
    } else {
        message += `No referrals yet.\n`;
    }
    
    message += `\n🔗 <b>Your Referral Link:</b>\n`;
    message += `t.me/YzemanBot?start=${userStats.referral_code}\n\n`;
    message += `Share your link and earn points when friends join! 🚀`;
    
    ctx.reply(message, { parse_mode: 'HTML' });
});

// Command to check stats (alternative to button)
bot.command('stats', async (ctx) => {
    const userStats = await getUserByTelegramId(ctx.from.id);
    
    if (!userStats) {
        ctx.reply("You haven't registered yet. Open the Mini App to get started!");
        return;
    }
    
    let statsMessage = `<b>📊 Your YzemanBot Stats</b>\n\n`;
    statsMessage += `💰 <b>Points:</b> ${userStats.points?.toLocaleString() || 0}\n`;
    statsMessage += `💵 <b>USD Value:</b> $${((userStats.points || 0) / 100000).toFixed(2)}\n`;
    statsMessage += `👥 <b>Referrals:</b> ${userStats.referrals || 0}\n`;
    statsMessage += `🏆 <b>Tier:</b> ${userStats.tier || 'Fresher'}\n`;
    statsMessage += `🔗 <b>Your Referral Link:</b>\n`;
    statsMessage += `t.me/YzemanBot?start=${userStats.referral_code}\n\n`;
    statsMessage += `Share your link and earn points when friends join! 🚀`;
    
    ctx.reply(statsMessage, { parse_mode: 'HTML' });
});

// Error handling
bot.catch((err, ctx) => {
    console.error(`❌ Bot error:`, err.message);
    ctx.reply('Sorry, something went wrong. Please try again later.');
});

// Start the bot
console.log('🤖 Starting bot...');
bot.launch().then(() => {
    console.log('✅ Bot is running and listening for commands!');
    console.log('📱 Bot username: @YzemanBot');
}).catch(err => {
    console.error('❌ Failed to launch bot:', err);
    process.exit(1);
});

// Graceful stop
process.once('SIGINT', () => {
    console.log('🛑 SIGINT received, stopping bot...');
    bot.stop('SIGINT');
    pool.end();
    process.exit(0);
});
process.once('SIGTERM', () => {
    console.log('🛑 SIGTERM received, stopping bot...');
    bot.stop('SIGTERM');
    pool.end();
    process.exit(0);
});
