// ============================================================
// YZEMANBOT - COMPLETE APP WITH MONETAG REWARDED INTERSTITIAL
// COIN ECONOMY: 1 COIN = 1 UNIT (NO POINTS)
// WITHDRAWAL: 100,000 COINS minimum
// MONETAG ZONE ID: 9683863
// SOUND EFFECTS ONLY (NO BACKGROUND MUSIC)
// WITH ROBUST RETRY AND OFFLINE CACHE
// ============================================================

const tg = window.Telegram?.WebApp;
if (tg) {
    tg.expand();
    tg.ready();
}

// ============================================================
// COIN ECONOMY CONFIGURATION (BALANCED FOR GROWING APP)
// ============================================================

const COIN_ECONOMY = {
    MIN_WITHDRAWAL_COINS: 100000,      // 100,000 COINS to withdraw
    
    // ============================================================
    // BALANCED AD REWARDS - FUN BUT NOT TOO FAST
    // Fresher: 0.2 | Brute: 0.35 | Silver: 0.5 | Gold: 0.75 | Platinum: 1.0
    // ============================================================
    
    AD_REWARDS: {
        'Fresher': 0.2,
        'Brute': 0.35,
        'Silver': 0.5,
        'Gold': 0.75,
        'Platinum': 1.0
    },
    
    // Tier requirements (referral count)
    TIER_REQUIREMENTS: {
        'Fresher': 0,
        'Brute': 150,
        'Silver': 350,
        'Gold': 700,
        'Platinum': 1500
    },
    
    // Referral rewards (tier-based, in COINS per invite)
    REFERRAL_REWARDS_COINS: {
        'Fresher': 5,
        'Brute': 10,
        'Silver': 15,
        'Gold': 20,
        'Platinum': 25
    },
    
    // Invitee bonus (2,000 COINS)
    INVITEE_BONUS_COINS: 2000,
    
    // Lifetime commission rate (2%)
    COMMISSION_RATE: 0.02,
    
    // ============================================================
    // EXCITING AD BONUSES & SURPRISES
    // ============================================================
    
    // Streak bonuses - Rewards consistency
    AD_STREAK_BONUSES: { 
        5: 1,
        10: 3,
        25: 10,
        50: 25,
        100: 100
    },
    
    // Random bonus chances (exciting surprises!)
    LUCKY_AD_CHANCE: 0.15,
    GOLDEN_AD_CHANCE: 0.05,
    MEGA_AD_CHANCE: 0.01,
    EPIC_AD_CHANCE: 0.002,
    
    // Daily & Weekly Goals
    DAILY_AD_GOAL: 20,
    DAILY_AD_GOAL_REWARD: 2,
    WEEKLY_AD_GOAL: 100,
    WEEKLY_AD_GOAL_REWARD: 15,
    
    // Milestone rewards for total ads watched
    AD_MILESTONES: { 
        100: 10,
        250: 30,
        500: 75,
        1000: 200,
        2500: 500,
        5000: 1000,
        10000: 2500
    },
    
    // Daily base reward
    DAILY_BASE_REWARD: 0.2,
    DAILY_STREAK_BONUS: 0.1,
    
    // Wheel prizes
    WHEEL_PRIZES: [50, 50, 50, 50, 100, 100, 100, 200, 200, 500, 1000, 2000],
    
    // Social task rewards
    SOCIAL_TASK_REWARDS: {
        'youtube1': 100,
        'youtube2': 100,
        'youtube3': 100,
        'facebook': 100,
        'instagram': 100,
        'telegram': 100
    },
    
    PLAY_EARN_REWARD: 200,
    WEBSITE_TASK_REWARD: 5,
    
    // Achievement rewards
    ACHIEVEMENT_REWARDS: {
        'Loyal User': 500,
        'Referral Master': 3000,
        'Points Millionaire': 2000,
        'Social Butterfly': 15000,
        'Tournament Winner': 1500,
        'Team Player': 200,
        'Platinum Elite': 10000,
        'Wheel Champion': 1000,
        'Daily Streak 7': 1000,
        'Super Referrer': 7000,
        'Ad Master': 2500,
        'Team Winner': 5000,
        'Leaderboard Winner': 3000,
        'Ad Master Platinum': 10000,
        'Referral King': 15000,
        'Monthly Top Earner': 5000
    },
    
    TOURNAMENT_PRIZES: {
        1: 1000,
        2: 500,
        3: 200,
        4: 100,
        5: 50
    }
};

const POINT_ECONOMY = COIN_ECONOMY;

// ============================================================
// REFERRAL CODE DETECTION
// ============================================================

const urlParams = new URLSearchParams(window.location.search);
let referralCode = urlParams.get('start');

console.log('🔍 Current URL:', window.location.href);
console.log('🔍 Raw referral code from URL:', referralCode);

if (sessionStorage.getItem('referralProcessed') === 'true') {
    referralCode = null;
    console.log('ℹ️ Referral already processed this session, ignoring');
}

if (!referralCode) {
    referralCode = localStorage.getItem('pendingReferralCode');
    if (referralCode) console.log('📝 Using referral code from localStorage:', referralCode);
}

if (referralCode) {
    localStorage.setItem('pendingReferralCode', referralCode);
    console.log('✅ Referral code stored:', referralCode);
}

// ============================================================
// GLOBAL VARIABLES
// ============================================================

let currentUser = null;
let completedSocial = JSON.parse(localStorage.getItem('completedSocial') || '{}');

let isWatchingAd = false;
let adStreak = parseInt(localStorage.getItem('adStreak') || '0');
let totalAdsWatched = parseInt(localStorage.getItem('totalAdsWatched') || '0');
let adsWatchedToday = parseInt(localStorage.getItem('adsWatchedToday') || '0');
let adsWatchedWeek = parseInt(localStorage.getItem('adsWatchedWeek') || '0');
let lastAdDate = localStorage.getItem('lastAdDate') || '';
let dailyGoalClaimed = localStorage.getItem('dailyGoalClaimed') === 'true';
let weeklyGoalClaimed = localStorage.getItem('weeklyGoalClaimed') === 'true';

let monetagReady = false;
let adPreloaded = false;

let activeTask = null;
let taskWindow = null;
let timerInterval = null;
let taskCheckInterval = null;
let taskStartTime = null;

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
window.showNotification = showNotification;

function showCelebration(msg, coins) {
    const celebration = document.createElement('div');
    celebration.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 10000; display: flex; flex-direction: column; justify-content: center; align-items: center; color: white; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto; animation: fadeIn 0.3s ease;`;
    celebration.innerHTML = `<div style="font-size: 80px; margin-bottom: 20px; animation: bounce 0.5s;">🎉</div><div style="font-size: 24px; margin-bottom: 10px;">${msg}</div><div style="font-size: 48px; font-weight: bold; color: #FFD700; margin-bottom: 20px;">+${coins.toFixed(3)} COINS!</div><button id="closeCelebration" style="margin-top: 30px; background: #4CAF50; color: white; border: none; padding: 12px 40px; border-radius: 30px; font-size: 16px; cursor: pointer;">AWESOME!</button>`;
    document.body.appendChild(celebration);
    document.getElementById('closeCelebration').onclick = () => celebration.remove();
    setTimeout(() => celebration.remove(), 5000);
}

async function apiCall(endpoint, data = null) {
    const options = { method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' } };
    if (data) options.body = JSON.stringify(data);
    const response = await fetch(endpoint, options);
    if (!response.ok) throw new Error(await response.text());
    return response.json();
}

// ============================================================
// AUDIO MANAGER
// ============================================================

const AudioManager = {
    sounds: {},
    initialized: false,
    sfxEnabled: localStorage.getItem('sfxEnabled') !== 'false',
    sfxVolume: parseFloat(localStorage.getItem('sfxVolume')) ?? 0.5,
    
    init() {
        if (this.initialized) return;
        const soundFiles = {
            click: '/sounds/click.mp3',
            notification: '/sounds/notification.mp3',
            reward: '/sounds/reward.mp3',
            error: '/sounds/error.mp3',
            success: '/sounds/success.mp3'
        };
        for (const [name, path] of Object.entries(soundFiles)) {
            try {
                const audio = new Audio(path);
                audio.preload = 'auto';
                audio.volume = this.sfxEnabled ? this.sfxVolume : 0;
                this.sounds[name] = audio;
            } catch (e) {
                console.warn(`Sound ${name} failed:`, e);
            }
        }
        this.initialized = true;
        console.log('🔊 Sound effects initialized');
    },
    
    playSound(soundName) {
        if (!this.sfxEnabled) return;
        const sound = this.sounds[soundName];
        if (sound) {
            sound.currentTime = 0;
            sound.play().catch(e => {});
        }
    },
    
    updateVolumeUI() {
        const sfxSlider = document.getElementById('sfxVolumeSlider');
        const sfxToggle = document.getElementById('sfxToggleBtn');
        if (sfxSlider) sfxSlider.value = this.sfxVolume;
        if (sfxToggle) sfxToggle.innerHTML = this.sfxEnabled ? '<i class="fas fa-volume-up"></i>' : '<i class="fas fa-volume-mute"></i>';
    }
};

try { AudioManager.init(); } catch (e) {}

const originalShowNotification = showNotification;
showNotification = function(msg, isError = false) {
    originalShowNotification(msg, isError);
    try { AudioManager.playSound(isError ? 'error' : 'notification'); } catch (e) {}
};

const originalShowCelebration = showCelebration;
showCelebration = function(msg, coins) {
    originalShowCelebration(msg, coins);
    try { AudioManager.playSound('reward'); } catch (e) {}
};

document.addEventListener('click', function(e) {
    const target = e.target.closest('button, .feature-card, .tab, .task-card, .ad-card, .nav-item, .copy-btn, [onclick]');
    if (target) {
        try { AudioManager.playSound('click'); } catch (e) {}
    }
}, true);

window.AudioManager = AudioManager;

// ============================================================
// USER REGISTRATION & MANAGEMENT
// ============================================================

const cachedUser = localStorage.getItem('cachedUser');
if (cachedUser) {
    try {
        currentUser = JSON.parse(cachedUser);
        updateUI();
        console.log('📦 Loaded cached user data');
    } catch(e) {}
}

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
    if (avatarEl) {
        if (user.photo_url) {
            avatarEl.innerHTML = '';
            const img = document.createElement('img');
            img.src = user.photo_url;
            img.alt = user.first_name;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            avatarEl.appendChild(img);
        } else {
            avatarEl.innerHTML = '<i class="fas fa-user"></i>';
        }
    }

    let codeToSend = referralCode;
    if (!codeToSend) codeToSend = localStorage.getItem('pendingReferralCode');
    
    console.log('📤 SENDING TO /api/user - Telegram ID:', user.id, 'Referral Code:', codeToSend || 'none');

    const maxRetries = 5;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await apiCall('/api/user', {
                initData: tg.initData,
                referralCode: codeToSend || null
            });
            
            if (codeToSend) {
                showNotification('🎉 Referral bonus applied!');
                localStorage.removeItem('pendingReferralCode');
                sessionStorage.setItem('referralProcessed', 'true');
                referralCode = null;
                console.log('✅ Referral code used and cleared');
            }
            
            localStorage.setItem('cachedUser', JSON.stringify(result));
            return result;
        } catch (err) {
            lastError = err;
            console.error(`Registration attempt ${attempt} failed:`, err.message);
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }
    
    console.error('Registration error after retries:', lastError);
    if (nameEl) nameEl.textContent = 'Connection Error';
    showRetryButton();
    return null;
}

function showRetryButton() {
    const header = document.querySelector('.header');
    if (!header) return;
    
    const existing = document.getElementById('retryRegistrationBtn');
    if (existing) existing.remove();
    
    const retryBtn = document.createElement('button');
    retryBtn.id = 'retryRegistrationBtn';
    retryBtn.innerHTML = '<i class="fas fa-sync"></i> Tap to Retry';
    retryBtn.style.cssText = `
        display: block;
        margin: 15px auto 0;
        padding: 12px 20px;
        background: var(--warning);
        color: var(--dark);
        border: none;
        border-radius: 25px;
        font-weight: bold;
        cursor: pointer;
        width: fit-content;
    `;
    retryBtn.onclick = async () => {
        retryBtn.disabled = true;
        retryBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Retrying...';
        const user = await registerUser();
        if (user) {
            currentUser = user;
            updateUI();
            updateAdStreakDisplay();
            loadWithdrawalHistory();
            loadBonusHistory();
            retryBtn.remove();
        } else {
            retryBtn.disabled = false;
            retryBtn.innerHTML = '<i class="fas fa-sync"></i> Tap to Retry';
        }
    };
    
    const balanceCard = document.querySelector('.balance-card');
    if (balanceCard) {
        balanceCard.appendChild(retryBtn);
    } else {
        header.appendChild(retryBtn);
    }
}

async function refreshUser() {
    if (!tg?.initDataUnsafe?.user) return;
    
    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const result = await apiCall('/api/user', { initData: tg.initData, referralCode: null });
            currentUser = result;
            localStorage.setItem('cachedUser', JSON.stringify(result));
            updateUI();
            loadWithdrawalHistory();
            updateAdStreakDisplay();
            loadBonusHistory();
            success = true;
            break;
        } catch (err) {
            console.error(`Refresh attempt ${attempt} failed:`, err.message);
            if (attempt < 3) await new Promise(r => setTimeout(r, 1000));
        }
    }
    
    if (!success) {
        console.error('Refresh user failed completely');
        if (currentUser) {
            updateUI();
        } else {
            showRetryButton();
        }
    }
}
window.refreshUser = refreshUser;

async function addCoins(amount, reason = 'reward') {
    try {
        await apiCall('/api/ad-reward', { initData: tg.initData, rewardAmount: amount, adType: reason });
        await refreshUser();
        return true;
    } catch (err) { showNotification('Failed: ' + err.message, true); return false; }
}
window.addCoins = addCoins;

// ============================================================
// UI UPDATE FUNCTIONS
// ============================================================

function updateUI() {
    if (!currentUser) {
        const cached = localStorage.getItem('cachedUser');
        if (cached) {
            try { currentUser = JSON.parse(cached); } catch(e) {}
        }
        if (!currentUser) return;
    }
    
    const coins = parseFloat(currentUser.coins) || 0;
    const progress = Math.min((coins / COIN_ECONOMY.MIN_WITHDRAWAL_COINS) * 100, 100);
    
    const coinsEl = document.getElementById('coins');
    const tierEl = document.getElementById('tier');
    const progressAmount = document.getElementById('progressAmount');
    const progressBar = document.getElementById('progressBar');
    const referralCount = document.getElementById('referralCount');
    const referralReward = document.getElementById('referralReward');
    const adReward = document.getElementById('adReward');
    const referralLink = document.getElementById('referralLink');
    
    if (coinsEl) coinsEl.textContent = coins.toFixed(2);
    if (tierEl) tierEl.textContent = currentUser.tier || 'Fresher';
    if (progressAmount) progressAmount.textContent = `${coins.toFixed(2)} / ${COIN_ECONOMY.MIN_WITHDRAWAL_COINS} COINS`;
    if (progressBar) progressBar.style.width = progress + '%';
    if (referralCount) referralCount.textContent = currentUser.referrals || 0;
    
    if (referralReward) {
        const reward = COIN_ECONOMY.REFERRAL_REWARDS_COINS[currentUser.tier] || 5;
        referralReward.textContent = `${reward.toFixed(2)} COINS`;
    }
    if (adReward) {
        const reward = COIN_ECONOMY.AD_REWARDS[currentUser.tier] || 0.2;
        adReward.textContent = `${reward.toFixed(2)} COINS`;
    }
    if (referralLink && currentUser.referral_code) {
        referralLink.textContent = `https://t.me/YzemanBot?start=${currentUser.referral_code}`;
    }
    
    const withdrawBtn = document.getElementById('withdrawBtn');
    if (withdrawBtn) withdrawBtn.disabled = coins < COIN_ECONOMY.MIN_WITHDRAWAL_COINS;
    
    const walletInput = document.getElementById('walletAddress');
    if (walletInput && currentUser.wallet_address) walletInput.value = currentUser.wallet_address;
    
    const currentRefs = document.getElementById('currentRefs');
    const nextTierReq = document.getElementById('nextTierReq');
    const tierProgressBar = document.getElementById('tierProgressBar');
    if (currentRefs && currentUser.referrals !== undefined) {
        currentRefs.textContent = currentUser.referrals || 0;
        const tiers = ['Fresher', 'Brute', 'Silver', 'Gold', 'Platinum'];
        const tierRefs = Object.values(COIN_ECONOMY.TIER_REQUIREMENTS);
        const idx = tiers.indexOf(currentUser.tier);
        const nextRefs = tierRefs[idx + 1] || tierRefs[tierRefs.length - 1];
        if (nextTierReq) nextTierReq.textContent = nextRefs;
        const tierProgress = ((currentUser.referrals || 0) / nextRefs) * 100;
        if (tierProgressBar) tierProgressBar.style.width = Math.min(tierProgress, 100) + '%';
    }
    const currentTierEl = document.getElementById('currentTier');
    if (currentTierEl) currentTierEl.textContent = currentUser.tier || 'Fresher';
}

function updateAdStreakDisplay() {
    const streakEl = document.getElementById('adStreak');
    const totalAdsEl = document.getElementById('totalAdsWatched');
    const todayAdsEl = document.getElementById('adsWatchedToday');
    const dailyProgressEl = document.getElementById('dailyAdProgress');
    const weeklyProgressEl = document.getElementById('weeklyAdProgress');
    const streakDisplayEl = document.getElementById('adStreakDisplay');
    const weekDisplayEl = document.getElementById('adsWatchedWeekDisplay');
    if (streakEl) streakEl.textContent = adStreak;
    if (totalAdsEl) totalAdsEl.textContent = totalAdsWatched;
    if (todayAdsEl) todayAdsEl.textContent = adsWatchedToday;
    if (streakDisplayEl) streakDisplayEl.textContent = adStreak;
    if (weekDisplayEl) weekDisplayEl.textContent = adsWatchedWeek;
    if (dailyProgressEl) dailyProgressEl.style.width = Math.min((adsWatchedToday / COIN_ECONOMY.DAILY_AD_GOAL) * 100, 100) + '%';
    if (weeklyProgressEl) weeklyProgressEl.style.width = Math.min((adsWatchedWeek / COIN_ECONOMY.WEEKLY_AD_GOAL) * 100, 100) + '%';
}

// ============================================================
// AD HELPER FUNCTIONS - WITH WORKING BONUSES!
// ============================================================

function calculateAdReward() {
    const baseReward = COIN_ECONOMY.AD_REWARDS[currentUser?.tier] || 0.2;
    const rand = Math.random();
    let multiplier = 1;
    let luckyType = 'normal';
    
    // Check EPIC first (0.2% chance)
    if (rand < COIN_ECONOMY.EPIC_AD_CHANCE) { 
        multiplier = 25; 
        luckyType = 'epic'; 
    }
    else if (rand < COIN_ECONOMY.EPIC_AD_CHANCE + COIN_ECONOMY.MEGA_AD_CHANCE) { 
        multiplier = 10; 
        luckyType = 'mega'; 
    }
    else if (rand < COIN_ECONOMY.EPIC_AD_CHANCE + COIN_ECONOMY.MEGA_AD_CHANCE + COIN_ECONOMY.GOLDEN_AD_CHANCE) { 
        multiplier = 5; 
        luckyType = 'golden'; 
    }
    else if (rand < COIN_ECONOMY.EPIC_AD_CHANCE + COIN_ECONOMY.MEGA_AD_CHANCE + COIN_ECONOMY.GOLDEN_AD_CHANCE + COIN_ECONOMY.LUCKY_AD_CHANCE) { 
        multiplier = 2; 
        luckyType = 'lucky'; 
    }
    
    const finalReward = baseReward * multiplier;
    console.log(`🎲 Ad reward: base=${baseReward}, multiplier=${multiplier}x, type=${luckyType}, final=${finalReward}`);
    
    return { baseReward, multiplier, finalReward, luckyType };
}

function checkAndAwardStreakBonus() {
    const bonuses = COIN_ECONOMY.AD_STREAK_BONUSES;
    for (const [streakRequired, bonus] of Object.entries(bonuses)) {
        if (adStreak === parseInt(streakRequired)) {
            console.log(`🔥 Streak bonus earned: ${bonus} COINS for ${adStreak} ads streak!`);
            return bonus;
        }
    }
    return 0;
}

function checkAndAwardMilestones() {
    const milestones = COIN_ECONOMY.AD_MILESTONES;
    const earnedMilestones = JSON.parse(localStorage.getItem('earnedMilestones') || '[]');
    let milestoneBonus = 0;
    for (const [required, bonus] of Object.entries(milestones)) {
        if (totalAdsWatched >= parseInt(required) && !earnedMilestones.includes(required)) {
            milestoneBonus += bonus;
            earnedMilestones.push(required);
            console.log(`🏆 Milestone reached: ${required} ads! +${bonus} COINS`);
        }
    }
    localStorage.setItem('earnedMilestones', JSON.stringify(earnedMilestones));
    return milestoneBonus;
}

function updateAdStats() {
    adStreak++;
    totalAdsWatched++;
    adsWatchedToday++;
    lastAdDate = today;
    adsWatchedWeek++;
    localStorage.setItem('adStreak', adStreak);
    localStorage.setItem('totalAdsWatched', totalAdsWatched);
    localStorage.setItem('adsWatchedToday', adsWatchedToday);
    localStorage.setItem('adsWatchedWeek', adsWatchedWeek);
    localStorage.setItem('lastAdDate', lastAdDate);
    updateAdStreakDisplay();
    console.log(`📊 Ad stats updated: streak=${adStreak}, total=${totalAdsWatched}, today=${adsWatchedToday}, week=${adsWatchedWeek}`);
}

// ============================================================
// MONETAG REWARDED INTERSTITIAL INTEGRATION
// ============================================================

function initMonetag() {
    if (typeof window.show_9683863 === 'undefined') {
        console.warn('Monetag SDK not loaded yet');
        return false;
    }
    monetagReady = true;
    console.log('✅ Monetag ready');
    return true;
}

async function preloadMonetagAd() {
    if (!monetagReady) {
        if (!initMonetag()) return;
    }
    
    const userId = currentUser?.telegram_id || currentUser?.id || 'guest';
    
    try {
        console.log('🔄 Preloading Monetag ad...');
        await window.show_9683863({ 
            type: 'preload',
            ymid: String(userId)
        });
        adPreloaded = true;
        console.log('✅ Monetag ad preloaded successfully');
    } catch (err) {
        console.warn('⚠️ Preload failed, ad will load on demand:', err.message);
        adPreloaded = false;
    }
}

async function awardAdReward() {
    const { finalReward, luckyType, multiplier } = calculateAdReward();
    updateAdStats();
    const streakBonus = checkAndAwardStreakBonus();
    const milestoneBonus = checkAndAwardMilestones();
    let totalCoins = finalReward + streakBonus + milestoneBonus;
    
    let dailyGoalBonus = 0, weeklyGoalBonus = 0;
    if (adsWatchedToday >= COIN_ECONOMY.DAILY_AD_GOAL && !dailyGoalClaimed) {
        dailyGoalBonus = COIN_ECONOMY.DAILY_AD_GOAL_REWARD;
        dailyGoalClaimed = true;
        localStorage.setItem('dailyGoalClaimed', 'true');
        console.log(`📅 Daily goal reached! +${dailyGoalBonus} COINS`);
    }
    if (adsWatchedWeek >= COIN_ECONOMY.WEEKLY_AD_GOAL && !weeklyGoalClaimed) {
        weeklyGoalBonus = COIN_ECONOMY.WEEKLY_AD_GOAL_REWARD;
        weeklyGoalClaimed = true;
        localStorage.setItem('weeklyGoalClaimed', 'true');
        console.log(`📆 Weekly goal reached! +${weeklyGoalBonus} COINS`);
    }
    totalCoins += dailyGoalBonus + weeklyGoalBonus;
    
    let celebrationMsg = 'Ad Completed!';
    if (luckyType === 'epic') celebrationMsg = '🔥 EPIC AD! 25x REWARD! 🔥';
    else if (luckyType === 'mega') celebrationMsg = '🌟 MEGA AD! 10x REWARD! 🌟';
    else if (luckyType === 'golden') celebrationMsg = '⭐ GOLDEN AD! 5x REWARD! ⭐';
    else if (luckyType === 'lucky') celebrationMsg = '✨ LUCKY AD! 2x REWARD! ✨';
    
    console.log(`💰 Total reward: ${totalCoins} COINS (base: ${finalReward}, streak: ${streakBonus}, milestone: ${milestoneBonus}, daily: ${dailyGoalBonus}, weekly: ${weeklyGoalBonus})`);
    
    showCelebration(celebrationMsg, totalCoins);
    await addCoins(totalCoins, 'monetag');
    
    if (streakBonus > 0) showNotification(`🔥 Streak bonus! +${streakBonus} COINS!`);
    if (dailyGoalBonus > 0) showNotification(`🎯 Daily goal reached! +${dailyGoalBonus} COINS`);
    if (weeklyGoalBonus > 0) showNotification(`🏆 Weekly goal reached! +${weeklyGoalBonus} COINS`);
    if (milestoneBonus > 0) showNotification(`🎖️ Ad milestone! +${milestoneBonus} COINS`);
    
    adPreloaded = false;
    setTimeout(() => preloadMonetagAd(), 2000);
}

window.watchAd = async function() {
    if (!window.Telegram?.WebApp) {
        showNotification('Must open inside Telegram app', true);
        return;
    }
    
    if (!currentUser) {
        showNotification('Loading user data...', false);
        return;
    }
    
    if (isWatchingAd) {
        showNotification('Ad already in progress', true);
        return;
    }
    
    if (!monetagReady) {
        if (!initMonetag()) {
            showNotification('Ad network loading... Try again in a moment.', true);
            return;
        }
    }
    
    isWatchingAd = true;
    
    try {
        console.log('📺 Showing Monetag Rewarded Interstitial...');
        
        const userId = currentUser.telegram_id || currentUser.id || 'guest';
        
        await window.show_9683863({ 
            ymid: String(userId)
        });
        
        await awardAdReward();
        
    } catch (error) {
        console.error('Monetag ad error or skipped:', error);
        adStreak = 0;
        localStorage.setItem('adStreak', '0');
        updateAdStreakDisplay();
        
        let errorMsg = 'Ad not completed - streak reset';
        if (error.message) {
            if (error.message.includes('no ad') || error.message.includes('no fill')) {
                errorMsg = 'No ads available. Try again later.';
            }
        }
        showNotification(errorMsg, true);
        
        adPreloaded = false;
        setTimeout(() => preloadMonetagAd(), 3000);
    } finally {
        isWatchingAd = false;
    }
};

window.resetAdStreak = function() {
    adStreak = 0;
    localStorage.setItem('adStreak', '0');
    updateAdStreakDisplay();
    showNotification('Ad streak reset', false);
};

// ============================================================
// TASK FUNCTIONS
// ============================================================

async function checkTask(taskName) {
    try {
        const res = await apiCall('/api/check-task', { taskName });
        return res?.completed || false;
    } catch (e) { return false; }
}

async function completeTaskOnServer(taskName, coins) {
    try {
        const res = await apiCall('/api/complete-task', { taskName, coins });
        if (res?.success) {
            showNotification(res.message, false);
            const btn = document.getElementById(`task${taskName.charAt(0).toUpperCase() + taskName.slice(1)}`);
            if (btn) {
                btn.classList.add('completed');
                if (!btn.querySelector('.completed-badge')) {
                    const b = document.createElement('div');
                    b.className = 'completed-badge';
                    b.innerHTML = '✓ Done';
                    btn.appendChild(b);
                }
            }
            await refreshUser();
            return true;
        }
        return false;
    } catch (e) { showNotification('Failed to claim reward', true); return false; }
}

window.TASK_CONFIG = window.TASK_CONFIG || {};
window.handleTaskClick = window.handleTaskClick || function() {};
window.cancelTask = window.cancelTask || function() {};

// ============================================================
// BONUS CODES & HISTORY
// ============================================================

async function loadBonusHistory() {
    if (!currentUser) return;
    try {
        const response = await fetch('/api/bonus-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData: tg.initData })
        });
        if (response.ok) {
            const history = await response.json();
            displayBonusHistoryUI(history);
        }
    } catch (err) { console.error('Failed to load bonus history:', err); }
}

function displayBonusHistoryUI(history) {
    const container = document.getElementById('bonusHistoryList');
    if (!container) return;
    if (!history || history.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color: var(--gray);">No bonuses redeemed yet</div>';
        return;
    }
    container.innerHTML = history.map(item => {
        const redeemedDate = new Date(item.redeemed_at);
        const formattedDate = redeemedDate.toLocaleDateString() + ' ' + redeemedDate.toLocaleTimeString();
        return `
            <div class="bonus-history-item">
                <div>
                    <div class="bonus-code-display">${item.bonus_code}</div>
                    <div class="bonus-expiry">Redeemed: ${formattedDate}</div>
                </div>
                <div><span class="bonus-used-badge">✅ Redeemed</span></div>
            </div>
        `;
    }).join('');
}

async function redeemBonus() {
    const codeInput = document.getElementById('bonusCodeInput');
    if (!codeInput) return;
    const code = codeInput.value.trim().toUpperCase();
    if (!code) { showNotification('Enter a bonus code', true); return; }
    try {
        const response = await fetch('/api/redeem-bonus', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData: tg.initData, code: code })
        });
        const result = await response.json();
        if (!response.ok) { showNotification(result.error || 'Failed to redeem', true); return; }
        if (result.success) {
            showNotification(result.message || 'Bonus code redeemed!');
            await refreshUser();
            codeInput.value = '';
            await loadBonusHistory();
        }
    } catch (err) { showNotification('Failed to redeem code', true); }
}

// ============================================================
// WITHDRAWAL FUNCTIONS
// ============================================================

async function saveWallet() {
    const address = document.getElementById('walletAddress')?.value.trim();
    if (!address) { showNotification('Enter wallet address', true); return; }
    if (!address.startsWith('T') || address.length < 34) { showNotification('Please enter a valid USDT (TRC-20) wallet address (starts with T)', true); return; }
    try {
        await apiCall('/api/user', { initData: tg.initData, walletAddress: address });
        showNotification('Wallet saved!');
        await refreshUser();
    } catch (err) { showNotification('Failed to save wallet', true); }
}

function copyReferralLink() {
    const link = document.getElementById('referralLink')?.textContent;
    if (link) { navigator.clipboard.writeText(link); showNotification('Referral link copied!'); }
}

async function requestWithdrawal() {
    if (!currentUser) return;
    const coins = parseFloat(currentUser.coins) || 0;
    if (coins < COIN_ECONOMY.MIN_WITHDRAWAL_COINS) { showNotification(`Need ${COIN_ECONOMY.MIN_WITHDRAWAL_COINS} COINS to withdraw. You have ${coins.toFixed(2)} COINS`, true); return; }
    const wallet = document.getElementById('walletAddress')?.value.trim();
    if (!wallet) { showNotification('Please save your wallet address first', true); return; }
    try {
        const response = await fetch('/api/withdraw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: tg.initData, amount: COIN_ECONOMY.MIN_WITHDRAWAL_COINS, walletAddress: wallet }) });
        if (response.ok) { showNotification(`Withdrawal request submitted for ${COIN_ECONOMY.MIN_WITHDRAWAL_COINS} COINS!`); await refreshUser(); loadWithdrawalHistory(); } 
        else { const error = await response.text(); showNotification('Withdrawal failed: ' + error, true); }
    } catch (err) { showNotification('Error: ' + err.message, true); }
}

async function loadWithdrawalHistory() {
    try {
        const response = await fetch('/api/admin/withdrawals', { headers: { 'Authorization': 'Bearer admin123' } });
        if (response.ok) {
            const allWithdrawals = await response.json();
            const userWithdrawals = allWithdrawals.filter(w => w.user_id === currentUser?.id || w.telegram_id === currentUser?.telegram_id);
            displayWithdrawalHistory(userWithdrawals);
        } else displayWithdrawalHistory([]);
    } catch (err) { displayWithdrawalHistory([]); }
}

function displayWithdrawalHistory(history) {
    const container = document.getElementById('withdrawalHistoryList');
    if (!container) return;
    if (!history || history.length === 0) { container.innerHTML = '<div style="text-align:center; padding:20px;">No withdrawal requests yet</div>'; return; }
    container.innerHTML = history.map(w => {
        let statusClass = 'status-pending', statusText = w.status || 'pending';
        if (w.status === 'completed' || w.status === 'approved') { statusClass = 'status-completed'; statusText = '✅ Approved'; }
        else if (w.status === 'rejected' || w.status === 'failed') { statusClass = 'status-failed'; statusText = '❌ Rejected'; }
        else if (w.status === 'processing') { statusClass = 'status-processing'; statusText = '⏳ Processing'; }
        else { statusText = '⏳ Pending'; }
        return `<div class="history-item"><div class="history-amount">${w.amount || 0} COINS</div><div class="history-date">${new Date(w.created_at).toLocaleDateString()}</div><div><span class="${statusClass}">${statusText}</span></div></div>`;
    }).join('');
}

// ============================================================
// DAILY REWARDS FUNCTIONS
// ============================================================

async function claimDailyReward() {
    try {
        const result = await apiCall('/api/daily-reward', { initData: tg.initData });
        const streak = result.streak || 1;
        const totalReward = COIN_ECONOMY.DAILY_BASE_REWARD + (streak * COIN_ECONOMY.DAILY_STREAK_BONUS);
        await addCoins(totalReward, 'daily');
        showNotification(`🎁 Daily reward: +${totalReward.toFixed(2)} COINS! Streak: ${streak} days 🔥`);
        await refreshUser();
        if (document.getElementById('streakCount')) loadDailyStats();
    } catch (err) { showNotification(err.message, true); }
}

async function loadDailyStats() {
    try {
        const data = await apiCall('/api/daily-stats', { initData: tg.initData });
        const streakCount = document.getElementById('streakCount');
        if (streakCount) streakCount.textContent = data.current_streak || 0;
    } catch (err) { console.error('Daily stats error:', err); }
}

// ============================================================
// WHEEL FUNCTIONS (Simplified)
// ============================================================

let wheelSpinning = false;

async function spinWheel() {
    if (wheelSpinning) return;
    wheelSpinning = true;
    try {
        const result = await apiCall('/api/wheel-spin', { initData: tg.initData });
        showNotification(`🎡 You won ${result.reward.toFixed(2)} COINS!`);
        await refreshUser();
        await loadWheelStatus();
    } catch (err) {
        showNotification(err.message, true);
    } finally {
        wheelSpinning = false;
    }
}

async function loadWheelStatus() {
    try {
        const data = await apiCall('/api/wheel-status', { initData: tg.initData });
        const spinBtn = document.getElementById('spinBtn');
        if (spinBtn) spinBtn.disabled = !data.can_spin;
        const statusDiv = document.getElementById('statusText');
        const timerDiv = document.getElementById('timerText');
        const lastRewardDiv = document.getElementById('lastRewardText');
        if (statusDiv) statusDiv.innerHTML = data.can_spin ? '✅ Ready to spin!' : '⏳ Next spin available in:';
        if (timerDiv && !data.can_spin) timerDiv.innerHTML = `${data.days_left} day${data.days_left !== 1 ? 's' : ''}`;
        if (lastRewardDiv && data.last_reward > 0) lastRewardDiv.innerHTML = `Last spin: ${data.last_reward.toFixed(2)} COINS!`;
    } catch (err) { console.error('Wheel status error:', err); }
}

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
    initMonetag();
    
    try { AudioManager.updateVolumeUI(); } catch (e) {}
    
    currentUser = await registerUser();
    if (currentUser) {
        updateUI();
        updateAdStreakDisplay();
        loadWithdrawalHistory();
        loadBonusHistory();
        if (document.getElementById('streakCount')) loadDailyStats();
        if (document.getElementById('wheelCanvas')) loadWheelStatus();
        
        setTimeout(preloadMonetagAd, 2000);
    }
    
    const watchAdBtn = document.getElementById('watchAdBtn');
    if (watchAdBtn) watchAdBtn.addEventListener('click', watchAd);
    
    const redeemBonusBtn = document.getElementById('redeemBonusBtn');
    if (redeemBonusBtn) redeemBonusBtn.addEventListener('click', redeemBonus);
    
    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn) copyBtn.addEventListener('click', copyReferralLink);
    
    const saveWalletBtn = document.getElementById('saveWalletBtn');
    if (saveWalletBtn) saveWalletBtn.addEventListener('click', saveWallet);
    
    const withdrawBtn = document.getElementById('withdrawBtn');
    if (withdrawBtn) withdrawBtn.addEventListener('click', requestWithdrawal);
    
    const spinBtn = document.getElementById('spinBtn');
    if (spinBtn) spinBtn.addEventListener('click', spinWheel);
}

document.addEventListener('DOMContentLoaded', init);
