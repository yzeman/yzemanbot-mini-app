const { Telegraf } = require('telegraf');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Your Mini App URL - Update this to your Render URL
const MINI_APP_URL = 'https://yzemanbot-mini-app.onrender.com';

// ============================================
// START COMMAND
// ============================================

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name;
    const username = ctx.from.username || '';
    
    // Check for referral code in start parameter
    const startPayload = ctx.startPayload || '';
    let referralCode = '';
    
    if (startPayload) {
        // Handle referral code (format: ref-XXXXXX)
        if (startPayload.startsWith('ref-')) {
            referralCode = startPayload;
        } else {
            referralCode = startPayload;
        }
    }
    
    console.log(`🚀 User ${userId} (${firstName}) started the bot. Referral: ${referralCode}`);
    
    // Build the Mini App URL with referral code
    let miniAppUrl = MINI_APP_URL;
    if (referralCode) {
        miniAppUrl += `?start=${referralCode}`;
    }
    
    // Welcome message with Mini App button
    await ctx.reply(
        `🎉 *Welcome to YzemanBot, ${firstName}!*\n\n` +
        `💰 *Earn COINS by:*\n` +
        `• Watching ads\n` +
        `• Inviting friends\n` +
        `• Daily rewards\n` +
        `• Spinning the wheel\n` +
        `• Competing in tournaments\n\n` +
        `👇 *Tap below to start earning!*`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '🚀 LAUNCH YZEMANBOT',
                            web_app: { url: miniAppUrl }
                        }
                    ],
                    [
                        { text: '📢 Join Channel', url: 'https://t.me/YzemanEarnBotChannel' }
                    ]
                ]
            }
        }
    );
});

// ============================================
// HELP COMMAND
// ============================================

bot.help(async (ctx) => {
    await ctx.reply(
        `📚 *YzemanBot Help*\n\n` +
        `*How to earn COINS:*\n` +
        `🎬 *Watch Ads* - Earn COINS for each ad you watch\n` +
        `👥 *Refer Friends* - Get bonus COINS when friends join\n` +
        `📅 *Daily Rewards* - Login daily to build your streak\n` +
        `🎡 *Wheel of Fortune* - Spin every 3 days to win big\n` +
        `🏆 *Tournaments* - Compete weekly for massive prizes\n` +
        `👑 *Teams* - Join or create a team to earn together\n\n` +
        `*Withdrawal:*\n` +
        `💳 Minimum 100,000 COINS to withdraw\n` +
        `💰 Paid in USDT (TRC-20)\n\n` +
        `❓ *Need support?* Contact @yzemanreal`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '🚀 LAUNCH APP',
                            web_app: { url: MINI_APP_URL }
                        }
                    ]
                ]
            }
        }
    );
});

// ============================================
// MENU COMMAND
// ============================================

bot.command('menu', async (ctx) => {
    await ctx.reply(
        `📋 *Main Menu*\n\nChoose an option:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '🚀 OPEN YZEMANBOT',
                            web_app: { url: MINI_APP_URL }
                        }
                    ],
                    [
                        { text: '📊 Leaderboard', callback_data: 'leaderboard' },
                        { text: '🏆 Tournament', callback_data: 'tournament' }
                    ],
                    [
                        { text: '💰 Withdrawal Info', callback_data: 'withdraw_info' },
                        { text: '❓ Help', callback_data: 'help' }
                    ]
                ]
            }
        }
    );
});

// ============================================
// CALLBACK QUERIES
// ============================================

bot.action('leaderboard', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
        `🏆 *Leaderboard*\n\nView the top earners and referrers in the app!`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '📊 VIEW LEADERBOARD',
                            web_app: { url: `${MINI_APP_URL}/leaderboard.html` }
                        }
                    ],
                    [
                        { text: '« Back to Menu', callback_data: 'back_to_menu' }
                    ]
                ]
            }
        }
    );
});

bot.action('tournament', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
        `🏆 *Weekly Tournament*\n\n` +
        `Compete for massive COINS prizes!\n\n` +
        `🥇 1st Place: 500 COINS\n` +
        `🥈 2nd Place: 250 COINS\n` +
        `🥉 3rd Place: 100 COINS\n\n` +
        `New tournament every Monday!`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '🏆 JOIN TOURNAMENT',
                            web_app: { url: `${MINI_APP_URL}/tournament.html` }
                        }
                    ],
                    [
                        { text: '« Back to Menu', callback_data: 'back_to_menu' }
                    ]
                ]
            }
        }
    );
});

bot.action('withdraw_info', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
        `💰 *Withdrawal Information*\n\n` +
        `*Minimum Withdrawal:* 100,000 COINS\n` +
        `*Currency:* USDT (TRC-20)\n` +
        `*Processing Time:* 24-48 hours\n\n` +
        `*How to withdraw:*\n` +
        `1. Open the app\n` +
        `2. Go to Wallet tab\n` +
        `3. Enter your USDT (TRC-20) address\n` +
        `4. Request withdrawal\n\n` +
        `Your request will be reviewed by admin.`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '💳 GO TO WALLET',
                            web_app: { url: MINI_APP_URL }
                        }
                    ],
                    [
                        { text: '« Back to Menu', callback_data: 'back_to_menu' }
                    ]
                ]
            }
        }
    );
});

bot.action('help', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
        `📚 *YzemanBot Help*\n\n` +
        `*How to earn COINS:*\n` +
        `🎬 Watch Ads\n` +
        `👥 Refer Friends\n` +
        `📅 Daily Rewards\n` +
        `🎡 Wheel Spins\n` +
        `🏆 Tournaments\n` +
        `👑 Team Battles\n\n` +
        `*Need support?* Contact @yzemanreal`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '🚀 LAUNCH APP',
                            web_app: { url: MINI_APP_URL }
                        }
                    ],
                    [
                        { text: '« Back to Menu', callback_data: 'back_to_menu' }
                    ]
                ]
            }
        }
    );
});

bot.action('back_to_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
        `📋 *Main Menu*\n\nChoose an option:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '🚀 OPEN YZEMANBOT',
                            web_app: { url: MINI_APP_URL }
                        }
                    ],
                    [
                        { text: '📊 Leaderboard', callback_data: 'leaderboard' },
                        { text: '🏆 Tournament', callback_data: 'tournament' }
                    ],
                    [
                        { text: '💰 Withdrawal Info', callback_data: 'withdraw_info' },
                        { text: '❓ Help', callback_data: 'help' }
                    ]
                ]
            }
        }
    );
});

// ============================================
// REFERRAL TRACKING (Deep Linking)
// ============================================

bot.on('message', async (ctx) => {
    // Only handle text messages that aren't commands
    if (ctx.message.text && !ctx.message.text.startsWith('/')) {
        const text = ctx.message.text;
        
        // Check if it's a referral code (format: ref-XXXXXX or YZEMAN-XXXXXX)
        if (text.match(/^(ref-|YZEMAN-)[A-Z0-9]+$/i)) {
            const miniAppUrl = `${MINI_APP_URL}?start=${text}`;
            
            await ctx.reply(
                `🎉 *You found a referral code!*\n\n` +
                `Use this link to join and earn bonus COINS!`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '🎁 CLAIM REFERRAL BONUS',
                                    web_app: { url: miniAppUrl }
                                }
                            ]
                        ]
                    }
                }
            );
        }
    }
});

// ============================================
// ERROR HANDLING
// ============================================

bot.catch((err, ctx) => {
    console.error(`❌ Bot error for ${ctx.updateType}:`, err);
});

// ============================================
// START BOT
// ============================================

// Use webhook in production, polling in development
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
    // For Render deployment - use webhook
    const WEBHOOK_URL = `${process.env.RENDER_EXTERNAL_URL}/bot${process.env.BOT_TOKEN}`;
    
    bot.telegram.setWebhook(WEBHOOK_URL)
        .then(() => {
            console.log(`✅ Webhook set to: ${WEBHOOK_URL}`);
        })
        .catch((err) => {
            console.error('❌ Failed to set webhook:', err);
        });
    
    // Export for serverless environment
    module.exports = bot.webhookCallback(`/bot${process.env.BOT_TOKEN}`);
    
} else {
    // For local development - use polling
    bot.launch()
        .then(() => {
            console.log('🚀 Bot started in polling mode');
            console.log(`🌐 Mini App URL: ${MINI_APP_URL}`);
        })
        .catch((err) => {
            console.error('❌ Failed to start bot:', err);
        });
}

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('🤖 YzemanBot is running...');
console.log(`🌐 Mini App URL: ${MINI_APP_URL}`);
