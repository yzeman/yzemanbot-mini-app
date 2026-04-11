// ============================================================
// YZEMANBOT - COMPLETE APP WITH FUN AD SYSTEM
// POINT ECONOMY: 1,000,000 points = 1 coin
// WITHDRAWAL: 100,000 coins minimum
// ============================================================

const tg = window.Telegram?.WebApp;
if (tg) {
    tg.expand();
    tg.ready();
}

// ============================================================
// POINT ECONOMY CONFIGURATION
// ============================================================

const POINT_ECONOMY = {
    // Conversion
    POINTS_PER_COIN: 1000000,           // 1,000,000 points = 1 coin
    MIN_WITHDRAWAL_COINS: 100000,       // 100,000 coins to withdraw
    
    // Base Ad Rewards by Tier
    AD_REWARDS: {
        'Fresher': 5000,
        'Brute': 7500,
        'Silver': 10000,
        'Gold': 15000,
        'Platinum': 25000
    },
    
    // Tier Requirements (Referrals needed)
    TIER_REQUIREMENTS: {
        'Fresher': 0,
        'Brute': 150,
        'Silver': 350,
        'Gold': 700,
        'Platinum': 1500
    },
    
    // Referral Rewards (Points given to referrer)
    REFERRAL_REWARDS: {
        'Fresher': 500000,
        'Brute': 750000,
        'Silver': 1000000,
        'Gold': 1500000,
        'Platinum': 2500000
    },
    
    // Invitee Bonus
    INVITEE_BONUS: 250000,
    
    // Ad Streak Bonuses (watched consecutively without closing)
    AD_STREAK_BONUSES: {
        5: 10000,
        10: 25000,
        25: 100000,
        50: 500000,
        100: 2000000
    },
    
    // Lucky Ad Chances
    LUCKY_AD_CHANCE: 0.10,      // 10% for 2x
    GOLDEN_AD_CHANCE: 0.02,     // 2% for 5x
    MEGA_AD_CHANCE: 0.005,      // 0.5% for 10x
    
    // Daily/Weekly Goals
    DAILY_AD_GOAL: 20,
    DAILY_AD_GOAL_REWARD: 500000,
    WEEKLY_AD_GOAL: 100,
    WEEKLY_AD_GOAL_REWARD: 5000000,
    
    // Lifetime Ad Milestones
    AD_MILESTONES: {
        100: 1000000,
        500: 10000000,
        1000: 50000000,
        5000: 250000000,
        10000: 1000000000
    },
    
    // Daily Rewards
    DAILY_BASE_REWARD: 100000,
    DAILY_STREAK_BONUS: 50000,
    
    // Wheel Prizes
    WHEEL_PRIZES: [50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000],
    
    // Social Tasks
    SOCIAL_TASK_REWARDS: {
        'youtube1': 5000000,
        'youtube2': 2500000,
        'youtube3': 2500000,
        'facebook': 2500000,
        'instagram': 2500000,
        'telegram': 5000000
    },
    
    // YouTube/Website Tasks
    YOUTUBE_TASK_REWARD: 10000000,
    WEBSITE_TASK_REWARD: 5000000,
    
    // Achievements
    ACHIEVEMENT_REWARDS: {
        'Loyal User': 50000000,
        'Referral Master': 100000000,
        'Points Millionaire': 1000000000,
        'Social Butterfly': 25000000,
        'Tournament Winner': 50000000,
        'Team Player': 10000000,
        'Platinum Elite': 200000000,
        'Wheel Champion': 25000000,
        'Daily Streak 7': 5000000,
        'Super Referrer': 500000000,
        'Ad Master': 50000000
    },
    
    // Tournament Prizes
    TOURNAMENT_PRIZES: {
        1: 500000000,
        2: 250000000,
        3: 100000000,
        4: 50000000,
        5: 25000000
    },
    
    // Team Rewards
    TEAM_MONTHLY_WINNER: 2500000000,
    
    // Bonus Codes
    BONUS_CODES: {
        "WELCOME": 500000,
        "ADSMASTER": 5000000,
        "LUCKYDAY": 1000000,
        "BIGWIN": 10000000,
        "BASER": 2000000,
        "BOTYZEMAN": 100000000,
        "EARNSBOTT": 15000000,
        "BONUSBOTTER": 100000000,
        "YZEMASTER1": 150000000
    }
};

// ============================================================
// REFERRAL CODE DETECTION
// ============================================================

let referralCode = null;
const urlParams = new URLSearchParams(window.location.search);
let rawReferralCode = urlParams.get('start');

if (rawReferralCode) {
    if (rawReferralCode.startsWith('ref-')) {
        referralCode = rawReferralCode.substring(4);
    } else if (rawReferralCode.startsWith('YZEMAN-')) {
        referralCode = rawReferralCode.substring(7);
    } else {
        referralCode = rawReferralCode;
    }
    console.log('📝 Referral code detected:', referralCode);
}

// ============================================================
// GLOBAL VARIABLES
// ============================================================

let currentUser = null;
let completedSocial = JSON.parse(localStorage.getItem('completedSocial') || '{}');
let usedBonusCodes = JSON.parse(localStorage.getItem('usedBonusCodes') || '{}');

// Ad watching state
let isWatchingAd = false;
let adOverlay = null;
let adStreak = parseInt(localStorage.getItem('adStreak') || '0');
let totalAdsWatched = parseInt(localStorage.getItem('totalAdsWatched') || '0');
let adsWatchedToday = parseInt(localStorage.getItem('adsWatchedToday') || '0');
let adsWatchedWeek = parseInt(localStorage.getItem('adsWatchedWeek') || '0');
let lastAdDate = localStorage.getItem('lastAdDate') || '';
let dailyGoalClaimed = localStorage.getItem('dailyGoalClaimed') === 'true';
let weeklyGoalClaimed = localStorage.getItem('weeklyGoalClaimed') === 'true';

// Reset daily/weekly counters if new day/week
const today = new Date().toDateString();
const weekStart = new Date();
weekStart.setDate(weekStart.getDate() - weekStart.getDay());
const weekStartStr = weekStart.toDateString();

if (lastAdDate !== today) {
    adsWatchedToday = 0;
    dailyGoalClaimed = false;
    localStorage.setItem('adsWatchedToday', '0');
    localStorage.setItem('dailyGoalClaimed', 'false');
}

const lastWeekStart = localStorage.getItem('lastWeekStart') || '';
if (lastWeekStart !== weekStartStr) {
    adsWatchedWeek = 0;
    weeklyGoalClaimed = false;
    localStorage.setItem('adsWatchedWeek', '0');
    localStorage.setItem('weeklyGoalClaimed', 'false');
    localStorage.setItem('lastWeekStart', weekStartStr);
}

// ============================================================
// BONUS CODES LIST (Extended)
// ============================================================

const bonusCodesList = {};
Object.entries(POINT_ECONOMY.BONUS_CODES).forEach(([code, points]) => {
    bonusCodesList[code] = { 
        points: points, 
        dollars: 0, 
        description: `${(points / 1000000).toFixed(2)} coins` 
    };
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function showNotification(msg, isError = false) {
    const notif = document.getElementById('notification');
    if (notif) {
        notif.textContent = msg;
        notif.style.background = isError ? '#ff5252' : '#00c853';
        notif.style.display = 'block';
        setTimeout(() => notif.style.display = 'none', 4000);
    }
}

function showCelebration(msg, points) {
    // Create celebration overlay
    const celebration = document.createElement('div');
    celebration.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.8); z-index: 10000;
        display: flex; flex-direction: column; justify-content: center; align-items: center;
        color: white; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto;
        animation: fadeIn 0.3s ease;
    `;
    
    const coins = (points / POINT_ECONOMY.POINTS_PER_COIN).toFixed(3);
    
    celebration.innerHTML = `
        <div style="font-size: 80px; margin-bottom: 20px; animation: bounce 0.5s;">🎉</div>
        <div style="font-size: 24px; margin-bottom: 10px;">${msg}</div>
        <div style="font-size: 48px; font-weight: bold; color: #FFD700; margin-bottom: 20px;">+${coins} COINS!</div>
        <div style="font-size: 14px; color: #aaa;">(${points.toLocaleString()} points)</div>
        <button id="closeCelebration" style="margin-top: 30px; background: #4CAF50; color: white; 
            border: none; padding: 12px 40px; border-radius: 30px; font-size: 16px; cursor: pointer;">
            AWESOME!
        </button>
    `;
    
    document.body.appendChild(celebration);
    
    document.getElementById('closeCelebration').onclick = () => {
        celebration.remove();
    };
    
    setTimeout(() => celebration.remove(), 5000);
}

async function apiCall(endpoint, data = null) {
    const options = {
        method: data ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' }
    };
    if (data) options.body = JSON.stringify(data);
    const response = await fetch(endpoint, options);
    if (!response.ok) throw new Error(await response.text());
    return response.json();
}

// ============================================================
// USER REGISTRATION & MANAGEMENT
// ============================================================

async function registerUser() {
    if (!tg?.initDataUnsafe?.user) {
        const nameEl = document.getElementById('userName');
        if (nameEl) nameEl.textContent = 'Open from Telegram';
        return null;
    }

    const user = tg.initDataUnsafe.user;
    const nameEl = document.getElementById('userName');
    const idEl = document.getElementById('userId');
    const avatarEl = document.getElementById('userAvatar');
    
    if (nameEl) nameEl.textContent = `${user.first_name} ${user.last_name || ''}`;
    if (idEl) idEl.textContent = `ID: ${user.id}`;
    if (avatarEl && user.photo_url) avatarEl.src = user.photo_url;

    try {
        const result = await apiCall('/api/user', {
            initData: tg.initData,
            referralCode: referralCode
        });
        if (referralCode) {
            showNotification('🎉 Referral bonus applied!');
            referralCode = null;
        }
        return result;
    } catch (err) {
        console.error(err);
        if (nameEl) nameEl.textContent = 'Connection Error';
        showNotification('Failed to connect to server', true);
        return null;
    }
}

async function refreshUser() {
    if (!tg?.initDataUnsafe?.user) return;
    try {
        const result = await apiCall('/api/user', {
            initData: tg.initData,
            referralCode: null
        });
        currentUser = result;
        updateUI();
        loadWithdrawalHistory();
        updateAdStreakDisplay();
    } catch (err) {
        console.error('Refresh error:', err);
    }
}

async function addPoints(amount, reason = 'reward') {
    try {
        const result = await apiCall('/api/ad-reward', {
            initData: tg.initData,
            rewardAmount: amount,
            adType: reason
        });
        await refreshUser();
        return true;
    } catch (err) {
        showNotification('Failed: ' + err.message, true);
        return false;
    }
}

// ============================================================
// UI UPDATE FUNCTION
// ============================================================

function updateUI() {
    if (!currentUser) return;
    
    const points = currentUser.points || 0;
    const coins = points / POINT_ECONOMY.POINTS_PER_COIN;
    const progress = Math.min((coins / POINT_ECONOMY.MIN_WITHDRAWAL_COINS) * 100, 100);
    
    const pointsEl = document.getElementById('points');
    const usdEl = document.getElementById('usd');
    const coinsEl = document.getElementById('coins');
    const tierEl = document.getElementById('tier');
    const progressAmount = document.getElementById('progressAmount');
    const progressBar = document.getElementById('progressBar');
    const referralCount = document.getElementById('referralCount');
    const referralReward = document.getElementById('referralReward');
    const adReward = document.getElementById('adReward');
    const referralLink = document.getElementById('referralLink');
    
    if (pointsEl) pointsEl.textContent = points.toLocaleString();
    if (usdEl) usdEl.textContent = `${coins.toFixed(2)} COINS`;
    if (coinsEl) coinsEl.textContent = coins.toFixed(2);
    if (tierEl) tierEl.textContent = currentUser.tier || 'Fresher';
    if (progressAmount) progressAmount.textContent = `${coins.toFixed(2)} / ${POINT_ECONOMY.MIN_WITHDRAWAL_COINS} COINS`;
    if (progressBar) progressBar.style.width = progress + '%';
    if (referralCount) referralCount.textContent = currentUser.referrals || 0;
    
    const tierRewards = POINT_ECONOMY.REFERRAL_REWARDS;
    if (referralReward) {
        const reward = tierRewards[currentUser.tier] || 500000;
        const rewardCoins = (reward / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2);
        referralReward.textContent = `${rewardCoins} COINS`;
    }
    
    const adRewards = POINT_ECONOMY.AD_REWARDS;
    if (adReward) {
        const reward = adRewards[currentUser.tier] || 5000;
        const rewardCoins = (reward / POINT_ECONOMY.POINTS_PER_COIN).toFixed(3);
        adReward.textContent = `${rewardCoins} COINS`;
    }
    
    if (referralLink && currentUser.referral_code) {
        referralLink.textContent = `https://t.me/YzemanBot?start=${currentUser.referral_code}`;
    }
    
    const withdrawBtn = document.getElementById('withdrawBtn');
    if (withdrawBtn) withdrawBtn.disabled = coins < POINT_ECONOMY.MIN_WITHDRAWAL_COINS;
    
    const walletInput = document.getElementById('walletAddress');
    if (walletInput && currentUser.wallet_address) {
        walletInput.value = currentUser.wallet_address;
    }
    
    const currentRefs = document.getElementById('currentRefs');
    const nextTierReq = document.getElementById('nextTierReq');
    const tierProgressBar = document.getElementById('tierProgressBar');
    
    if (currentRefs && currentUser.referrals !== undefined) {
        currentRefs.textContent = currentUser.referrals || 0;
        const tiers = ['Fresher', 'Brute', 'Silver', 'Gold', 'Platinum'];
        const tierRefs = Object.values(POINT_ECONOMY.TIER_REQUIREMENTS);
        const idx = tiers.indexOf(currentUser.tier);
        const nextRefs = tierRefs[idx + 1] || tierRefs[tierRefs.length - 1];
        if (nextTierReq) nextTierReq.textContent = nextRefs;
        const tierProgress = ((currentUser.referrals || 0) / nextRefs) * 100;
        if (tierProgressBar) tierProgressBar.style.width = Math.min(tierProgress, 100) + '%';
    }
    
    displayBonusList();
}

function updateAdStreakDisplay() {
    const streakEl = document.getElementById('adStreak');
    const totalAdsEl = document.getElementById('totalAdsWatched');
    const todayAdsEl = document.getElementById('adsWatchedToday');
    const dailyProgressEl = document.getElementById('dailyAdProgress');
    const weeklyProgressEl = document.getElementById('weeklyAdProgress');
    
    if (streakEl) streakEl.textContent = adStreak;
    if (totalAdsEl) totalAdsEl.textContent = totalAdsWatched;
    if (todayAdsEl) todayAdsEl.textContent = adsWatchedToday;
    
    if (dailyProgressEl) {
        const dailyProgress = (adsWatchedToday / POINT_ECONOMY.DAILY_AD_GOAL) * 100;
        dailyProgressEl.style.width = Math.min(dailyProgress, 100) + '%';
    }
    
    if (weeklyProgressEl) {
        const weeklyProgress = (adsWatchedWeek / POINT_ECONOMY.WEEKLY_AD_GOAL) * 100;
        weeklyProgressEl.style.width = Math.min(weeklyProgress, 100) + '%';
    }
}

// ============================================================
// AD REWARD CALCULATION WITH LUCKY ADS
// ============================================================

function calculateAdReward() {
    const baseReward = POINT_ECONOMY.AD_REWARDS[currentUser?.tier] || 5000;
    
    // Check for lucky multipliers
    const rand = Math.random();
    let multiplier = 1;
    let luckyType = 'normal';
    
    if (rand < POINT_ECONOMY.MEGA_AD_CHANCE) {
        multiplier = 10;
        luckyType = 'mega';
    } else if (rand < POINT_ECONOMY.MEGA_AD_CHANCE + POINT_ECONOMY.GOLDEN_AD_CHANCE) {
        multiplier = 5;
        luckyType = 'golden';
    } else if (rand < POINT_ECONOMY.MEGA_AD_CHANCE + POINT_ECONOMY.GOLDEN_AD_CHANCE + POINT_ECONOMY.LUCKY_AD_CHANCE) {
        multiplier = 2;
        luckyType = 'lucky';
    }
    
    const finalReward = Math.floor(baseReward * multiplier);
    
    return { baseReward, multiplier, finalReward, luckyType };
}

function checkAndAwardStreakBonus() {
    const bonuses = POINT_ECONOMY.AD_STREAK_BONUSES;
    let bonusEarned = 0;
    
    for (const [streakRequired, bonus] of Object.entries(bonuses)) {
        if (adStreak === parseInt(streakRequired)) {
            bonusEarned = bonus;
            break;
        }
    }
    
    return bonusEarned;
}

function checkAndAwardMilestones() {
    const milestones = POINT_ECONOMY.AD_MILESTONES;
    const earnedMilestones = JSON.parse(localStorage.getItem('earnedMilestones') || '[]');
    let milestoneBonus = 0;
    
    for (const [required, bonus] of Object.entries(milestones)) {
        if (totalAdsWatched >= parseInt(required) && !earnedMilestones.includes(required)) {
            milestoneBonus += bonus;
            earnedMilestones.push(required);
        }
    }
    
    localStorage.setItem('earnedMilestones', JSON.stringify(earnedMilestones));
    return milestoneBonus;
}

function updateAdStats() {
    // Update streak
    adStreak++;
    
    // Update total
    totalAdsWatched++;
    
    // Update daily
    adsWatchedToday++;
    lastAdDate = today;
    
    // Update weekly
    adsWatchedWeek++;
    
    // Save to localStorage
    localStorage.setItem('adStreak', adStreak);
    localStorage.setItem('totalAdsWatched', totalAdsWatched);
    localStorage.setItem('adsWatchedToday', adsWatchedToday);
    localStorage.setItem('adsWatchedWeek', adsWatchedWeek);
    localStorage.setItem('lastAdDate', lastAdDate);
    
    updateAdStreakDisplay();
}
// ============================================================
// AD WATCHING - IFRAME OVERLAY WITH FUN FEATURES
// ============================================================

function getRewardAmount() {
    return POINT_ECONOMY.AD_REWARDS[currentUser?.tier] || 5000;
}

function getBaseUrl() {
    return window.location.origin;
}

function setupAdMessageListener() {
    window.addEventListener('message', async (event) => {
        if (event.origin !== window.location.origin) return;
        
        const data = event.data;
        console.log('📨 Ad message:', data);
        
        if (data && data.event === 'reward-earned') {
            if (adOverlay) {
                adOverlay.remove();
                adOverlay = null;
            }
            
            // Calculate reward with lucky bonuses
            const { finalReward, luckyType } = calculateAdReward();
            
            // Update ad stats
            updateAdStats();
            
            // Check streak bonus
            const streakBonus = checkAndAwardStreakBonus();
            
            // Check milestone bonus
            const milestoneBonus = checkAndAwardMilestones();
            
            // Total points to award
            let totalPoints = finalReward + streakBonus + milestoneBonus;
            
            // Check daily goal
            let dailyGoalBonus = 0;
            if (adsWatchedToday >= POINT_ECONOMY.DAILY_AD_GOAL && !dailyGoalClaimed) {
                dailyGoalBonus = POINT_ECONOMY.DAILY_AD_GOAL_REWARD;
                dailyGoalClaimed = true;
                localStorage.setItem('dailyGoalClaimed', 'true');
            }
            
            // Check weekly goal
            let weeklyGoalBonus = 0;
            if (adsWatchedWeek >= POINT_ECONOMY.WEEKLY_AD_GOAL && !weeklyGoalClaimed) {
                weeklyGoalBonus = POINT_ECONOMY.WEEKLY_AD_GOAL_REWARD;
                weeklyGoalClaimed = true;
                localStorage.setItem('weeklyGoalClaimed', 'true');
            }
            
            totalPoints += dailyGoalBonus + weeklyGoalBonus;
            
            // Build celebration message
            let celebrationMsg = 'Ad Completed!';
            if (luckyType === 'mega') celebrationMsg = '🌟 MEGA AD! 10x REWARD! 🌟';
            else if (luckyType === 'golden') celebrationMsg = '⭐ GOLDEN AD! 5x REWARD! ⭐';
            else if (luckyType === 'lucky') celebrationMsg = '✨ LUCKY AD! 2x REWARD! ✨';
            
            // Show celebration
            showCelebration(celebrationMsg, totalPoints);
            
            // Add points to database
            await addPoints(totalPoints, 'ad');
            
            // Show streak notification
            if (streakBonus > 0) {
                const streakCoins = (streakBonus / POINT_ECONOMY.POINTS_PER_COIN).toFixed(3);
                showNotification(`🔥 ${adStreak} Ad Streak! +${streakCoins} COINS bonus!`);
            }
            
            // Show goal notifications
            if (dailyGoalBonus > 0) {
                const goalCoins = (dailyGoalBonus / POINT_ECONOMY.POINTS_PER_COIN).toFixed(1);
                showNotification(`🎯 Daily Goal Complete! +${goalCoins} COINS!`);
            }
            
            if (weeklyGoalBonus > 0) {
                const goalCoins = (weeklyGoalBonus / POINT_ECONOMY.POINTS_PER_COIN).toFixed(1);
                showNotification(`🏆 Weekly Goal Complete! +${goalCoins} COINS!`);
            }
            
            if (milestoneBonus > 0) {
                const milestoneCoins = (milestoneBonus / POINT_ECONOMY.POINTS_PER_COIN).toFixed(1);
                showNotification(`🎖️ Ad Milestone Reached! +${milestoneCoins} COINS!`);
            }
            
            isWatchingAd = false;
            
        } else if (data && data.event === 'ad-failed') {
            // Reset streak on ad failure
            adStreak = 0;
            localStorage.setItem('adStreak', '0');
            updateAdStreakDisplay();
            
            if (adOverlay) {
                adOverlay.remove();
                adOverlay = null;
            }
            showNotification(data.error || 'Ad failed - streak reset', true);
            isWatchingAd = false;
            
        } else if (data && data.event === 'close-ad') {
            // Reset streak if user closes ad early
            adStreak = 0;
            localStorage.setItem('adStreak', '0');
            updateAdStreakDisplay();
            
            if (adOverlay) {
                adOverlay.remove();
                adOverlay = null;
            }
            showNotification('Ad skipped - streak reset', true);
            isWatchingAd = false;
        }
    });
}

function createAdOverlay() {
    if (adOverlay) adOverlay.remove();
    
    adOverlay = document.createElement('div');
    adOverlay.id = 'adOverlay';
    adOverlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: #0f0f1a; z-index: 9999;
    `;
    
    // Add streak indicator to overlay
    const streakIndicator = document.createElement('div');
    streakIndicator.style.cssText = `
        position: absolute; top: 50px; left: 50%; transform: translateX(-50%);
        background: rgba(0,0,0,0.7); color: #FFD700; padding: 8px 20px;
        border-radius: 30px; font-size: 16px; font-weight: bold; z-index: 10000;
        display: flex; align-items: center; gap: 8px;
    `;
    streakIndicator.innerHTML = `🔥 Streak: ${adStreak} | 📺 Total: ${totalAdsWatched}`;
    adOverlay.appendChild(streakIndicator);
    
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width: 100%; height: 100%; border: none;';
    iframe.allow = 'autoplay; fullscreen';
    iframe.sandbox = 'allow-scripts allow-same-origin allow-popups allow-forms allow-modals';
    
    adOverlay.appendChild(iframe);
    document.body.appendChild(adOverlay);
    
    return iframe;
}

window.watchAd = async function() {
    if (isWatchingAd) {
        showNotification('Ad already playing! Keep watching! 🔥', true);
        return;
    }
    
    if (!currentUser) {
        showNotification('Please log in first', true);
        return;
    }
    
    isWatchingAd = true;
    
    const reward = getRewardAmount();
    const userId = currentUser?.telegram_id || currentUser?.id || 'guest';
    const adUrl = `${getBaseUrl()}/ad.html?userId=${userId}&reward=${reward}`;
    
    console.log('🎬 Loading ad in iframe:', adUrl);
    
    const iframe = createAdOverlay();
    iframe.src = adUrl;
    
    // Safety timeout
    setTimeout(() => {
        if (isWatchingAd && adOverlay) {
            adStreak = 0;
            localStorage.setItem('adStreak', '0');
            updateAdStreakDisplay();
            
            adOverlay.remove();
            adOverlay = null;
            isWatchingAd = false;
            showNotification('Ad timeout - streak reset', true);
        }
    }, 90000);
};

// Reset streak function (can be called from UI)
window.resetAdStreak = function() {
    adStreak = 0;
    localStorage.setItem('adStreak', '0');
    updateAdStreakDisplay();
    showNotification('Ad streak reset', false);
};

// ============================================================
// YOUTUBE & WEBSITE TASKS
// ============================================================

function startYoutubeTask() {
    window.open('https://youtube.com/watch?v=dQw4w9WgXcQ', '_blank');
    showNotification('Watch the video for 5 minutes to earn COINS');
    setTimeout(async () => {
        await addPoints(POINT_ECONOMY.YOUTUBE_TASK_REWARD, 'youtube');
        const coins = (POINT_ECONOMY.YOUTUBE_TASK_REWARD / POINT_ECONOMY.POINTS_PER_COIN).toFixed(1);
        showNotification(`YouTube task completed! +${coins} COINS`);
    }, 300000);
}

function startWebsiteTask() {
    window.open('https://yzeupdates.lat/articles.html', '_blank');
    showNotification('Stay on the website for 2 minutes');
    setTimeout(async () => {
        await addPoints(POINT_ECONOMY.WEBSITE_TASK_REWARD, 'website');
        const coins = (POINT_ECONOMY.WEBSITE_TASK_REWARD / POINT_ECONOMY.POINTS_PER_COIN).toFixed(1);
        showNotification(`Website task completed! +${coins} COINS`);
    }, 120000);
}

// ============================================================
// SOCIAL TASKS
// ============================================================

async function completeSocialTask(taskName, reward) {
    if (completedSocial[taskName]) {
        showNotification('You already completed this task!', true);
        return;
    }
    completedSocial[taskName] = true;
    localStorage.setItem('completedSocial', JSON.stringify(completedSocial));
    
    const taskReward = reward || POINT_ECONOMY.SOCIAL_TASK_REWARDS[taskName] || 2500000;
    await addPoints(taskReward, 'social');
    
    const coins = (taskReward / POINT_ECONOMY.POINTS_PER_COIN).toFixed(1);
    showNotification(`+${coins} COINS earned! 🎉`);
}

// ============================================================
// BONUS CODES
// ============================================================

async function redeemBonus() {
    const codeInput = document.getElementById('bonusCodeInput');
    if (!codeInput) return;
    
    const code = codeInput.value.trim().toUpperCase();
    if (!code) {
        showNotification('Enter a bonus code', true);
        return;
    }
    
    const bonus = bonusCodesList[code];
    if (!bonus) {
        showNotification(`Invalid bonus code "${code}"`, true);
        return;
    }
    
    const today = new Date().toDateString();
    if (usedBonusCodes[code] === today) {
        showNotification('Code already used today', true);
        return;
    }
    
    let totalPoints = bonus.points || 0;
    if (bonus.dollars > 0) {
        totalPoints += bonus.dollars * POINT_ECONOMY.POINTS_PER_COIN;
    }
    
    usedBonusCodes[code] = today;
    localStorage.setItem('usedBonusCodes', JSON.stringify(usedBonusCodes));
    
    await addPoints(totalPoints, 'bonus');
    
    const coins = (totalPoints / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2);
    showNotification(`Bonus code redeemed! +${coins} COINS`);
    codeInput.value = '';
    displayBonusList();
}

function displayBonusList() {
    const today = new Date().toDateString();
    const list = document.getElementById('bonusList');
    if (!list) return;
    
    list.innerHTML = '';
    for (const [code, bonus] of Object.entries(bonusCodesList)) {
        const rewardCoins = (bonus.points / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2);
        const isUsed = usedBonusCodes[code] === today;
        
        const item = document.createElement('div');
        item.className = 'bonus-item';
        item.innerHTML = `
            <span class="bonus-code">${code}</span>
            <span class="bonus-reward">${rewardCoins} COINS</span>
            ${isUsed ? '<span class="redeemed-badge">Used Today</span>' : '<span style="color:#888;">Available</span>'}
        `;
        list.appendChild(item);
    }
}

// ============================================================
// WITHDRAWAL FUNCTIONS
// ============================================================

async function saveWallet() {
    const address = document.getElementById('walletAddress')?.value.trim();
    if (!address) {
        showNotification('Enter wallet address', true);
        return;
    }
    if (!address.startsWith('T') || address.length < 34) {
        showNotification('Please enter a valid USDT (TRC-20) wallet address (starts with T)', true);
        return;
    }
    try {
        await apiCall('/api/user', {
            initData: tg.initData,
            walletAddress: address
        });
        showNotification('Wallet saved!');
        await refreshUser();
    } catch (err) {
        showNotification('Failed to save wallet', true);
    }
}

function copyReferralLink() {
    const link = document.getElementById('referralLink')?.textContent;
    if (link) {
        navigator.clipboard.writeText(link);
        showNotification('Referral link copied!');
    }
}

async function requestWithdrawal() {
    if (!currentUser) return;
    
    const coins = (currentUser.points || 0) / POINT_ECONOMY.POINTS_PER_COIN;
    if (coins < POINT_ECONOMY.MIN_WITHDRAWAL_COINS) {
        showNotification(`Need ${POINT_ECONOMY.MIN_WITHDRAWAL_COINS} COINS to withdraw. You have ${coins.toFixed(2)} COINS`, true);
        return;
    }
    
    const wallet = document.getElementById('walletAddress')?.value.trim();
    if (!wallet) {
        showNotification('Please save your wallet address first', true);
        return;
    }
    
    try {
        const response = await fetch('/api/withdraw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                initData: tg.initData,
                amount: POINT_ECONOMY.MIN_WITHDRAWAL_COINS,
                walletAddress: wallet
            })
        });
        
        if (response.ok) {
            showNotification(`Withdrawal request submitted for ${POINT_ECONOMY.MIN_WITHDRAWAL_COINS} COINS!`);
            await refreshUser();
            loadWithdrawalHistory();
        } else {
            const error = await response.text();
            showNotification('Withdrawal failed: ' + error, true);
        }
    } catch (err) {
        showNotification('Error: ' + err.message, true);
    }
}

async function loadWithdrawalHistory() {
    try {
        const response = await fetch('/api/admin/withdrawals', {
            headers: { 'Authorization': 'Bearer admin123' }
        });
        
        if (response.ok) {
            const allWithdrawals = await response.json();
            const userWithdrawals = allWithdrawals.filter(w => 
                w.user_id === currentUser?.id || w.telegram_id === currentUser?.telegram_id
            );
            displayWithdrawalHistory(userWithdrawals);
        } else {
            displayWithdrawalHistory([]);
        }
    } catch (err) {
        console.error('Failed to load withdrawals:', err);
        displayWithdrawalHistory([]);
    }
}

function displayWithdrawalHistory(history) {
    const container = document.getElementById('withdrawalHistoryList');
    if (!container) return;
    
    if (!history || history.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px;">No withdrawal requests yet</div>';
        return;
    }
    
    container.innerHTML = history.map(w => {
        let statusClass = 'status-pending';
        let statusText = w.status || 'pending';
        if (w.status === 'completed' || w.status === 'approved') {
            statusClass = 'status-completed';
            statusText = '✅ Approved';
        } else if (w.status === 'rejected' || w.status === 'failed') {
            statusClass = 'status-failed';
            statusText = '❌ Rejected';
        } else if (w.status === 'processing') {
            statusClass = 'status-processing';
            statusText = '⏳ Processing';
        } else {
            statusText = '⏳ Pending';
        }
        return `
            <div class="history-item">
                <div class="history-amount">${w.amount || 0} COINS</div>
                <div class="history-date">${new Date(w.created_at).toLocaleDateString()}</div>
                <div><span class="${statusClass}">${statusText}</span></div>
            </div>
        `;
    }).join('');
}

// ============================================================
// DAILY REWARDS FUNCTIONS
// ============================================================

async function claimDailyReward() {
    try {
        const result = await apiCall('/api/daily-reward', { initData: tg.initData });
        
        // Override reward with new economy
        const streak = result.streak || 1;
        const baseReward = POINT_ECONOMY.DAILY_BASE_REWARD;
        const streakBonus = streak * POINT_ECONOMY.DAILY_STREAK_BONUS;
        const totalReward = baseReward + streakBonus;
        
        await addPoints(totalReward, 'daily');
        
        const coins = (totalReward / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2);
        showNotification(`🎁 Daily reward: +${coins} COINS! Streak: ${streak} days 🔥`);
        await refreshUser();
        if (document.getElementById('streakCount')) {
            loadDailyStats();
        }
    } catch (err) {
        showNotification(err.message, true);
    }
}

async function loadDailyStats() {
    try {
        const data = await apiCall('/api/daily-stats', { initData: tg.initData });
        
        const streakCount = document.getElementById('streakCount');
        const totalDays = document.getElementById('totalDays');
        const maxStreak = document.getElementById('maxStreak');
        const todayReward = document.getElementById('todayReward');
        const claimBtn = document.getElementById('claimBtn');
        
        if (streakCount) streakCount.textContent = data.current_streak || 0;
        if (totalDays) totalDays.textContent = data.last_7_days?.length || 0;
        if (maxStreak) maxStreak.textContent = data.max_streak || 0;
        
        const streak = data.current_streak || 0;
        const totalReward = POINT_ECONOMY.DAILY_BASE_REWARD + (streak * POINT_ECONOMY.DAILY_STREAK_BONUS);
        const coins = (totalReward / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2);
        
        if (todayReward) todayReward.textContent = `${coins} COINS`;
        
        if (claimBtn) {
            if (data.claimed_today) {
                claimBtn.disabled = true;
                claimBtn.textContent = '✅ Already Claimed Today';
            } else {
                claimBtn.disabled = false;
                claimBtn.textContent = '🎁 Claim Daily Reward';
            }
        }
        
        renderCalendar(data);
    } catch (err) {
        console.error('Daily stats error:', err);
    }
}

function renderCalendar(data) {
    const calendar = document.getElementById('calendar');
    if (!calendar) return;
    
    const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const claimedDays = data?.last_7_days || [];
    const claimedDates = new Set(claimedDays.map(d => d.reward_date));
    
    const today = new Date().toISOString().split('T')[0];
    
    calendar.innerHTML = days.map((day, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i));
        const dateStr = date.toISOString().split('T')[0];
        const isClaimed = claimedDates.has(dateStr);
        const isToday = dateStr === today;
        
        return `
            <div class="calendar-day ${isClaimed ? 'claimed' : ''} ${isToday ? 'today' : ''}">
                <div>${day}</div>
                <div style="font-size: 10px; margin-top: 5px;">${date.getDate()}</div>
                ${isClaimed ? '<i class="fas fa-check" style="font-size: 10px; margin-top: 3px;"></i>' : ''}
            </div>
        `;
    }).join('');
}
// ============================================================
// WHEEL OF FORTUNE FUNCTIONS
// ============================================================

let wheelSpinning = false;
let wheelAnimationFrame = null;
let wheelCurrentAngle = 0;

function drawWheel(segments, currentAngle) {
    const canvas = document.getElementById('wheelCanvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const center = size / 2;
    const radius = size / 2 - 10;
    const anglePerSegment = (Math.PI * 2) / segments.length;
    
    for (let i = 0; i < segments.length; i++) {
        const startAngle = currentAngle + i * anglePerSegment;
        const endAngle = startAngle + anglePerSegment;
        
        ctx.beginPath();
        ctx.fillStyle = segments[i].color;
        ctx.moveTo(center, center);
        ctx.arc(center, center, radius, startAngle, endAngle);
        ctx.fill();
        
        ctx.save();
        ctx.translate(center, center);
        ctx.rotate(startAngle + anglePerSegment / 2);
        ctx.fillStyle = "#1a1a2e";
        ctx.font = "bold 14px 'Segoe UI'";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        
        const prize = segments[i].value;
        const coins = (prize / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2);
        ctx.fillText(coins, radius * 0.65, 0);
        ctx.restore();
    }
    
    ctx.beginPath();
    ctx.fillStyle = "#FFD700";
    ctx.arc(center, center, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a1a2e";
    ctx.font = "bold 20px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🎡", center, center);
}

async function spinWheel() {
    if (wheelSpinning) return;
    
    const prizes = POINT_ECONOMY.WHEEL_PRIZES;
    const segments = prizes.map((prize, i) => ({
        label: (prize / POINT_ECONOMY.POINTS_PER_COIN).toFixed(1),
        value: prize,
        color: ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7B05E"][i]
    }));
    
    const spinAngle = Math.random() * (Math.PI * 2 * 5) + (Math.PI * 2 * 3);
    const startTime = performance.now();
    const duration = 3000;
    
    wheelSpinning = true;
    const spinBtn = document.getElementById('spinBtn');
    if (spinBtn) spinBtn.disabled = true;
    
    function animateSpin(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(1, elapsed / duration);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const angle = spinAngle * easeOut;
        wheelCurrentAngle = (wheelCurrentAngle + angle) % (Math.PI * 2);
        drawWheel(segments, wheelCurrentAngle);
        
        if (progress < 1) {
            wheelAnimationFrame = requestAnimationFrame(animateSpin);
        } else {
            wheelAnimationFrame = null;
            const finalAngle = wheelCurrentAngle % (Math.PI * 2);
            const segmentIndex = Math.floor(((Math.PI * 2) - finalAngle) / ((Math.PI * 2) / segments.length)) % segments.length;
            const prize = segments[segmentIndex].value;
            wheelSpinning = false;
            submitSpin(prize);
        }
    }
    
    if (wheelAnimationFrame) cancelAnimationFrame(wheelAnimationFrame);
    wheelAnimationFrame = requestAnimationFrame(animateSpin);
}

async function submitSpin(prize) {
    try {
        const result = await apiCall('/api/wheel-spin', { initData: tg.initData });
        
        // Override with new prize
        await addPoints(prize, 'wheel');
        
        const coins = (prize / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2);
        showNotification(`🎡 You won ${coins} COINS!`);
        await loadWheelStatus();
        await refreshUser();
    } catch (err) {
        showNotification(err.message, true);
        const spinBtn = document.getElementById('spinBtn');
        if (spinBtn) spinBtn.disabled = false;
    }
}

async function loadWheelStatus() {
    try {
        const data = await apiCall('/api/wheel-status', { initData: tg.initData });
        
        const statusDiv = document.getElementById('statusText');
        const timerDiv = document.getElementById('timerText');
        const lastRewardDiv = document.getElementById('lastRewardText');
        const spinBtn = document.getElementById('spinBtn');
        
        if (statusDiv) {
            if (data.can_spin) {
                statusDiv.innerHTML = '<span style="color: var(--success);">✅ Ready to spin!</span>';
            } else {
                statusDiv.innerHTML = '<span style="color: var(--warning);">⏳ Next spin available in:</span>';
            }
        }
        
        if (timerDiv && !data.can_spin) {
            timerDiv.innerHTML = `${data.days_left} day${data.days_left !== 1 ? 's' : ''}`;
        } else if (timerDiv) {
            timerDiv.innerHTML = '';
        }
        
        if (lastRewardDiv && data.last_reward > 0) {
            const coins = (data.last_reward / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2);
            lastRewardDiv.innerHTML = `Last spin: ${coins} COINS!`;
        } else if (lastRewardDiv) {
            lastRewardDiv.innerHTML = 'No spins yet!';
        }
        
        if (spinBtn) {
            spinBtn.disabled = !data.can_spin;
        }
        
        const canvas = document.getElementById('wheelCanvas');
        if (canvas) {
            const prizes = POINT_ECONOMY.WHEEL_PRIZES;
            const segments = prizes.map((prize, i) => ({
                label: (prize / POINT_ECONOMY.POINTS_PER_COIN).toFixed(1),
                value: prize,
                color: ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7B05E"][i]
            }));
            drawWheel(segments, wheelCurrentAngle);
        }
    } catch (err) {
        console.error('Wheel status error:', err);
    }
}

// ============================================================
// LEADERBOARD FUNCTIONS
// ============================================================

async function loadTopEarners() {
    try {
        const data = await apiCall('/api/leaderboard/top-earners', { initData: tg.initData });
        const container = document.getElementById('topEarnersList');
        if (!container) return;
        
        if (!data.length) {
            container.innerHTML = '<div class="loading">No users yet</div>';
            return;
        }
        
        container.innerHTML = data.map((user, idx) => {
            const coins = (user.points / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2);
            return `
            <div class="leaderboard-item">
                <div class="rank ${idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : ''}">#${idx + 1}</div>
                <div class="avatar"><i class="fas fa-user"></i></div>
                <div class="info">
                    <div class="name">${user.first_name || user.username || 'User'}</div>
                    <div class="username">${user.username ? '@' + user.username : ''}</div>
                    <div class="tier-badge">${user.tier || 'Fresher'}</div>
                </div>
                <div class="score">${coins} COINS</div>
            </div>
        `}).join('');
    } catch (err) {
        console.error('Top earners error:', err);
    }
}

async function loadTopReferrers() {
    try {
        const data = await apiCall('/api/leaderboard/weekly-referrers', { initData: tg.initData });
        const container = document.getElementById('topReferrersList');
        if (!container) return;
        
        if (!data.length) {
            container.innerHTML = '<div class="loading">No referrals yet</div>';
            return;
        }
        
        container.innerHTML = data.map((user, idx) => `
            <div class="leaderboard-item">
                <div class="rank ${idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : ''}">#${idx + 1}</div>
                <div class="avatar"><i class="fas fa-user"></i></div>
                <div class="info">
                    <div class="name">${user.first_name || user.username || 'User'}</div>
                    <div class="username">${user.username ? '@' + user.username : ''}</div>
                    <div class="tier-badge">${user.tier || 'Fresher'}</div>
                </div>
                <div class="score">${user.referral_count || 0} referrals</div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Top referrers error:', err);
    }
}

async function loadWeeklyEarnings() {
    try {
        const data = await apiCall('/api/leaderboard/weekly-earnings', { initData: tg.initData });
        const container = document.getElementById('weeklyEarningsList');
        if (!container) return;
        
        if (!data.length) {
            container.innerHTML = '<div class="loading">No earnings this week</div>';
            return;
        }
        
        container.innerHTML = data.map((user, idx) => {
            const coins = (user.weekly_earnings / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2);
            return `
            <div class="leaderboard-item">
                <div class="rank ${idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : ''}">#${idx + 1}</div>
                <div class="avatar"><i class="fas fa-user"></i></div>
                <div class="info">
                    <div class="name">${user.first_name || user.username || 'User'}</div>
                    <div class="username">${user.username ? '@' + user.username : ''}</div>
                    <div class="tier-badge">${user.tier || 'Fresher'}</div>
                </div>
                <div class="score">${coins} COINS</div>
            </div>
        `}).join('');
    } catch (err) {
        console.error('Weekly earnings error:', err);
    }
}

// ============================================================
// ACHIEVEMENTS FUNCTIONS
// ============================================================

async function loadAchievements() {
    try {
        const data = await apiCall('/api/achievements', { initData: tg.initData });
        
        const achievementsCount = document.getElementById('achievementsCount');
        const totalPointsEarned = document.getElementById('totalPointsEarned');
        const grid = document.getElementById('achievementsGrid');
        
        if (achievementsCount) achievementsCount.textContent = data.userStats.achievements_count || 0;
        if (totalPointsEarned) {
            const coins = (data.userStats.total_points_earned / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2);
            totalPointsEarned.textContent = `${coins} COINS`;
        }
        
        if (!grid) return;
        
        const iconMap = {
            'Loyal User': '🔥', 'Referral Master': '👑', 'Points Millionaire': '💰',
            'Social Butterfly': '🦋', 'Tournament Winner': '🏆', 'Team Player': '🤝',
            'Platinum Elite': '💎', 'Wheel Champion': '🎡', 'Daily Streak 7': '📅', 
            'Super Referrer': '⭐', 'Ad Master': '📺'
        };
        
        grid.innerHTML = data.achievements.map(ach => {
            const rewardCoins = (ach.points_reward / POINT_ECONOMY.POINTS_PER_COIN).toFixed(1);
            return `
            <div class="achievement-card ${ach.achieved ? 'unlocked' : 'locked'}">
                <div class="achievement-icon">${iconMap[ach.name] || '🏅'}</div>
                <div class="achievement-name">${ach.name}</div>
                <div class="achievement-desc">${ach.description}</div>
                <div class="achievement-reward">+${rewardCoins} COINS</div>
                ${ach.achieved ? '<div class="unlocked-badge"><i class="fas fa-check"></i> Unlocked</div>' : '<div class="locked-badge"><i class="fas fa-lock"></i> Locked</div>'}
            </div>
        `}).join('');
    } catch (err) {
        console.error('Achievements error:', err);
        const grid = document.getElementById('achievementsGrid');
        if (grid) grid.innerHTML = '<div class="loading">Failed to load achievements</div>';
    }
}

// ============================================================
// TOURNAMENT FUNCTIONS
// ============================================================

async function joinTournament() {
    try {
        await apiCall('/api/tournament/join', { initData: tg.initData });
        showNotification('You joined the tournament! Start earning COINS!');
        loadTournamentStandings();
        const joinBtn = document.getElementById('joinBtn');
        if (joinBtn) {
            joinBtn.textContent = '✅ Joined!';
            joinBtn.disabled = true;
        }
    } catch (err) {
        showNotification(err.message, true);
    }
}

async function loadTournamentStandings() {
    try {
        const data = await apiCall('/api/tournament/standings', { initData: tg.initData });
        
        const myRankCard = document.getElementById('myRankCard');
        const myRank = document.getElementById('myRank');
        const myPoints = document.getElementById('myPoints');
        const standingsList = document.getElementById('standingsList');
        const prizesList = document.getElementById('prizesList');
        
        if (myRankCard && data.my_rank) {
            myRankCard.style.display = 'block';
            if (myRank) myRank.textContent = `#${data.my_rank}`;
            if (myPoints) {
                const coins = (data.my_points / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2);
                myPoints.textContent = `${coins} COINS this week`;
            }
        }
        
        // Display prizes
        if (prizesList) {
            const prizes = POINT_ECONOMY.TOURNAMENT_PRIZES;
            prizesList.innerHTML = `
                <div class="prize-item">🥇 1st Place: ${(prizes[1] / POINT_ECONOMY.POINTS_PER_COIN).toFixed(0)} COINS</div>
                <div class="prize-item">🥈 2nd Place: ${(prizes[2] / POINT_ECONOMY.POINTS_PER_COIN).toFixed(0)} COINS</div>
                <div class="prize-item">🥉 3rd Place: ${(prizes[3] / POINT_ECONOMY.POINTS_PER_COIN).toFixed(0)} COINS</div>
                <div class="prize-item">🏅 4th-10th: ${(prizes[4] / POINT_ECONOMY.POINTS_PER_COIN).toFixed(0)} COINS</div>
                <div class="prize-item">🎖️ 11th-50th: ${(prizes[5] / POINT_ECONOMY.POINTS_PER_COIN).toFixed(0)} COINS</div>
            `;
        }
        
        if (!standingsList) return;
        
        if (!data.standings.length) {
            standingsList.innerHTML = '<div class="loading">No participants yet. Be the first!</div>';
            return;
        }
        
        standingsList.innerHTML = data.standings.map((user, idx) => {
            const coins = (user.weekly_points / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2);
            return `
            <div class="leaderboard-item">
                <div class="rank ${idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : ''}">#${idx + 1}</div>
                <div class="avatar"><i class="fas fa-user"></i></div>
                <div class="info">
                    <div class="name">${user.first_name || user.username || 'User'}</div>
                    <div class="username">${user.username ? '@' + user.username : ''}</div>
                </div>
                <div class="score">${coins} COINS</div>
            </div>
        `}).join('');
    } catch (err) {
        console.error('Tournament standings error:', err);
    }
}

// ============================================================
// TEAM FUNCTIONS
// ============================================================

async function loadMyTeam() {
    try {
        const data = await apiCall('/api/team/info', { initData: tg.initData });
        const container = document.getElementById('myTeamInfo');
        if (!container) return;
        
        if (!data.has_team) {
            container.innerHTML = '<div class="team-card"><p style="text-align:center;">You are not in a team yet! Join or create one below.</p></div>';
            return;
        }
        
        const totalCoins = (data.team.total_points / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2);
        
        container.innerHTML = `
            <div class="team-card">
                <div class="team-name">${data.team.name}</div>
                <div class="team-code">Team Code: <strong>${data.team.code}</strong> <button class="copy-btn" onclick="window.copyTeamCode('${data.team.code}')" style="background:none;border:none;color:var(--secondary);cursor:pointer;">📋 Copy</button></div>
                <div>👑 Leader: ${data.team.leader_name || 'You'}</div>
                <div>👥 Members: ${data.team.member_count}</div>
                <div>💰 Total COINS: ${totalCoins}</div>
                <div>📊 Total Referrals: ${data.team.total_referrals || 0}</div>
                <div class="member-list"><strong>Members:</strong> ${data.members.map(m => {
                    const memberCoins = (m.points / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2);
                    return `<div class="member-item"><span>${m.first_name || m.username || 'User'} ${m.is_leader ? '<span class="leader-badge">👑 Leader</span>' : ''}</span><span>${memberCoins} COINS</span></div>`;
                }).join('')}</div>
            </div>
        `;
    } catch (err) {
        console.error('Team info error:', err);
    }
}

async function loadTeamLeaderboard() {
    try {
        const data = await apiCall('/api/team/leaderboard', { initData: tg.initData });
        const container = document.getElementById('teamLeaderboardList');
        if (!container) return;
        
        if (!data.length) {
            container.innerHTML = '<div class="loading">No teams yet</div>';
            return;
        }
        
        container.innerHTML = data.map((team, idx) => {
            const totalCoins = (team.total_points / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2);
            return `
            <div class="leaderboard-item">
                <div class="rank ${idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : ''}">#${idx + 1}</div>
                <div class="info" style="flex:1;">
                    <div class="name">${team.name}</div>
                    <div class="username">Leader: ${team.leader_name || 'Unknown'} | ${team.member_count} members</div>
                </div>
                <div class="score">${totalCoins} COINS</div>
            </div>
        `}).join('');
    } catch (err) {
        console.error('Team leaderboard error:', err);
    }
}

async function loadMonthlyCompetition() {
    try {
        const data = await apiCall('/api/team/monthly-competition', { initData: tg.initData });
        const container = document.getElementById('monthlyInfo');
        if (!container) return;
        
        const winnerCoins = (POINT_ECONOMY.TEAM_MONTHLY_WINNER / POINT_ECONOMY.POINTS_PER_COIN).toFixed(0);
        
        if (!data.standings.length) {
            container.innerHTML = `<div class="team-card"><p style="text-align:center;">No teams competing this month</p><p style="text-align:center; margin-top:10px;">🏆 Prize: ${winnerCoins} COINS for winning team!</p></div>`;
            return;
        }
        
        container.innerHTML = `
            <div class="team-card">
                <h3>${data.month} Competition</h3>
                <p style="text-align:center; margin-bottom:15px;">🏆 Grand Prize: ${winnerCoins} COINS</p>
                ${data.standings.map((team, idx) => {
                    const teamCoins = (team.team_points / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2);
                    return `
                    <div class="member-item">
                        <span><strong>#${idx + 1}</strong> ${team.name}</span>
                        <span>${teamCoins} COINS</span>
                    </div>
                `}).join('')}
            </div>
        `;
    } catch (err) {
        console.error('Monthly competition error:', err);
    }
}

async function createTeam() {
    const teamNameInput = document.getElementById('teamNameInput');
    if (!teamNameInput) return;
    
    const teamName = teamNameInput.value.trim();
    if (!teamName) {
        showNotification('Enter a team name', true);
        return;
    }
    try {
        const result = await apiCall('/api/team/create', { initData: tg.initData, teamName });
        showNotification(`Team "${teamName}" created! Code: ${result.team.code}`);
        teamNameInput.value = '';
        loadMyTeam();
    } catch (err) {
        showNotification(err.message, true);
    }
}

async function joinTeam() {
    const teamCodeInput = document.getElementById('teamCodeInput');
    if (!teamCodeInput) return;
    
    const teamCode = teamCodeInput.value.trim().toUpperCase();
    if (!teamCode) {
        showNotification('Enter a team code', true);
        return;
    }
    try {
        await apiCall('/api/team/join', { initData: tg.initData, teamCode });
        showNotification('Joined team successfully!');
        teamCodeInput.value = '';
        loadMyTeam();
    } catch (err) {
        showNotification(err.message, true);
    }
}

window.copyTeamCode = (code) => {
    navigator.clipboard.writeText(code);
    showNotification('Team code copied!');
};

// ============================================================
// TAB SWITCHING
// ============================================================

function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const tabId = tab.dataset.tab + 'Tab';
            const tabContent = document.getElementById(tabId);
            if (tabContent) tabContent.classList.add('active');
        });
    });
}

// ============================================================
// INITIALIZATION
// ============================================================

function checkPendingAdReward() {
    const pendingReward = localStorage.getItem('pendingAdReward');
    if (pendingReward) {
        localStorage.removeItem('pendingAdReward');
        localStorage.removeItem('adStartTime');
    }
}

async function initApp() {
    setupAdMessageListener();
    checkPendingAdReward();
    
    // Update ad streak display
    updateAdStreakDisplay();
    
    currentUser = await registerUser();
    if (currentUser) {
        updateUI();
        loadWithdrawalHistory();
        displayBonusList();
        
        const socialButtons = [
            { id: 'youtube1Btn', task: 'youtube1', url: 'https://youtube.com/@yzeupdates', reward: POINT_ECONOMY.SOCIAL_TASK_REWARDS.youtube1 },
            { id: 'youtube2Btn', task: 'youtube2', url: 'https://youtube.com/@codingappwithhtml', reward: POINT_ECONOMY.SOCIAL_TASK_REWARDS.youtube2 },
            { id: 'youtube3Btn', task: 'youtube3', url: 'https://youtube.com/@yzemanhacker8831', reward: POINT_ECONOMY.SOCIAL_TASK_REWARDS.youtube3 },
            { id: 'facebookBtn', task: 'facebook', url: 'https://www.facebook.com/share/1ADZJ1DVyn/', reward: POINT_ECONOMY.SOCIAL_TASK_REWARDS.facebook },
            { id: 'instagramBtn', task: 'instagram', url: 'https://www.instagram.com/yzeupdates', reward: POINT_ECONOMY.SOCIAL_TASK_REWARDS.instagram },
            { id: 'joinChannelBtn', task: 'telegram', url: 'https://t.me/YzemanEarnBotChannel', reward: POINT_ECONOMY.SOCIAL_TASK_REWARDS.telegram }
        ];
        
        socialButtons.forEach(btn => {
            const element = document.getElementById(btn.id);
            if (element) {
                element.addEventListener('click', () => {
                    window.open(btn.url, '_blank');
                    completeSocialTask(btn.task, btn.reward);
                });
            }
        });
        
        const redeemBtn = document.getElementById('redeemBonusBtn');
        if (redeemBtn) redeemBtn.addEventListener('click', redeemBonus);
        
        const copyBtn = document.getElementById('copyBtn');
        if (copyBtn) copyBtn.addEventListener('click', copyReferralLink);
        
        const saveWalletBtn = document.getElementById('saveWalletBtn');
        if (saveWalletBtn) saveWalletBtn.addEventListener('click', saveWallet);
        
        const withdrawBtn = document.getElementById('withdrawBtn');
        if (withdrawBtn) withdrawBtn.addEventListener('click', requestWithdrawal);
        
        const watchAdBtn = document.getElementById('watchAdBtn');
        if (watchAdBtn) {
            watchAdBtn.addEventListener('click', window.watchAd);
            console.log('✅ Watch ad button connected');
        }
        
        const youtubeTaskBtn = document.getElementById('youtubeTaskBtn');
        if (youtubeTaskBtn) youtubeTaskBtn.addEventListener('click', startYoutubeTask);
        
        const websiteTaskBtn = document.getElementById('websiteTaskBtn');
        if (websiteTaskBtn) websiteTaskBtn.addEventListener('click', startWebsiteTask);
        
        initTabs();
    }
    
    if (document.getElementById('claimBtn')) {
        loadDailyStats();
        document.getElementById('claimBtn')?.addEventListener('click', claimDailyReward);
    }
    
    if (document.getElementById('spinBtn')) {
        loadWheelStatus();
        document.getElementById('spinBtn')?.addEventListener('click', spinWheel);
    }
    
    if (document.getElementById('topEarnersList')) {
        loadTopEarners();
        loadTopReferrers();
        loadWeeklyEarnings();
        
        document.querySelectorAll('.leaderboard-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.leaderboard-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.leaderboard-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const tabId = tab.dataset.tab + 'Tab';
                document.getElementById(tabId)?.classList.add('active');
            });
        });
    }
    
    if (document.getElementById('achievementsGrid')) {
        loadAchievements();
    }
    
    if (document.getElementById('standingsList')) {
        loadTournamentStandings();
        document.getElementById('joinBtn')?.addEventListener('click', joinTournament);
    }
    
    if (document.getElementById('myTeamInfo')) {
        loadMyTeam();
        loadTeamLeaderboard();
        loadMonthlyCompetition();
        document.getElementById('joinTeamBtn')?.addEventListener('click', joinTeam);
        document.getElementById('createTeamBtn')?.addEventListener('click', createTeam);
        
        document.querySelectorAll('.team-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.team-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.team-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const tabId = tab.dataset.tab + 'Tab';
                document.getElementById(tabId)?.classList.add('active');
                if (tab.dataset.tab === 'leaderboard') loadTeamLeaderboard();
                if (tab.dataset.tab === 'monthly') loadMonthlyCompetition();
            });
        });
    }
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        console.log('📱 App resumed');
    }
});

setInterval(() => { if (currentUser) refreshUser(); }, 30000);

document.addEventListener('DOMContentLoaded', initApp);
