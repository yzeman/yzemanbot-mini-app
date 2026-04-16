// ============================================================
// YZEMANBOT - COMPLETE APP WITH MONETAG REWARDED INTERSTITIAL
// POINT ECONOMY: 1,000,000 points = 1 COIN
// WITHDRAWAL: 100,000 COINS minimum
// MONETAG ZONE ID: 9683863
// SOUND EFFECTS ONLY (NO BACKGROUND MUSIC)
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
    POINTS_PER_COIN: 1000000,
    MIN_WITHDRAWAL_COINS: 100000,
    
    AD_REWARDS: {
        'Fresher': 5000,
        'Brute': 7500,
        'Silver': 10000,
        'Gold': 15000,
        'Platinum': 25000
    },
    
    TIER_REQUIREMENTS: {
        'Fresher': 0,
        'Brute': 150,
        'Silver': 350,
        'Gold': 700,
        'Platinum': 1500
    },
    
    REFERRAL_REWARDS: {
        'Fresher': 500000,
        'Brute': 750000,
        'Silver': 1000000,
        'Gold': 1500000,
        'Platinum': 2500000
    },
    
    INVITEE_BONUS: 250000,
    
    AD_STREAK_BONUSES: { 5: 10000, 10: 25000, 25: 100000, 50: 500000, 100: 2000000 },
    LUCKY_AD_CHANCE: 0.10,
    GOLDEN_AD_CHANCE: 0.02,
    MEGA_AD_CHANCE: 0.005,
    DAILY_AD_GOAL: 20,
    DAILY_AD_GOAL_REWARD: 500000,
    WEEKLY_AD_GOAL: 100,
    WEEKLY_AD_GOAL_REWARD: 5000000,
    AD_MILESTONES: { 100: 1000000, 500: 10000000, 1000: 50000000, 5000: 250000000, 10000: 1000000000 },
    DAILY_BASE_REWARD: 100000,
    DAILY_STREAK_BONUS: 50000,
    WHEEL_PRIZES: [50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000],
    SOCIAL_TASK_REWARDS: { 'youtube1': 5000000, 'youtube2': 2500000, 'youtube3': 2500000, 'facebook': 2500000, 'instagram': 2500000, 'telegram': 5000000 },
    YOUTUBE_TASK_REWARD: 10000000,
    WEBSITE_TASK_REWARD: 5000000,
    ACHIEVEMENT_REWARDS: { 'Loyal User': 50000000, 'Referral Master': 100000000, 'Points Millionaire': 1000000000, 'Social Butterfly': 25000000, 'Tournament Winner': 50000000, 'Platinum Elite': 200000000, 'Wheel Champion': 25000000, 'Daily Streak 7': 5000000, 'Super Referrer': 500000000, 'Ad Master': 5000000000 },
    TOURNAMENT_PRIZES: { 1: 500000000, 2: 250000000, 3: 100000000, 4: 50000000, 5: 25000000 }
};

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

function showCelebration(msg, points) {
    const celebration = document.createElement('div');
    celebration.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 10000; display: flex; flex-direction: column; justify-content: center; align-items: center; color: white; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto; animation: fadeIn 0.3s ease;`;
    const coins = (points / POINT_ECONOMY.POINTS_PER_COIN).toFixed(3);
    celebration.innerHTML = `<div style="font-size: 80px; margin-bottom: 20px; animation: bounce 0.5s;">🎉</div><div style="font-size: 24px; margin-bottom: 10px;">${msg}</div><div style="font-size: 48px; font-weight: bold; color: #FFD700; margin-bottom: 20px;">+${coins} COINS!</div><div style="font-size: 14px; color: #aaa;">(${points.toLocaleString()} points)</div><button id="closeCelebration" style="margin-top: 30px; background: #4CAF50; color: white; border: none; padding: 12px 40px; border-radius: 30px; font-size: 16px; cursor: pointer;">AWESOME!</button>`;
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
// AUDIO MANAGER (Sound Effects Only - No Background Music)
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
        console.log('🔊 Sound effects initialized (music disabled)');
    },
    
    setSfxVolume(value) {
        this.sfxVolume = Math.max(0, Math.min(1, value));
        localStorage.setItem('sfxVolume', this.sfxVolume);
        Object.values(this.sounds).forEach(sound => {
            sound.volume = this.sfxEnabled ? this.sfxVolume : 0;
        });
        this.updateVolumeUI();
    },
    
    toggleSfx() {
        this.sfxEnabled = !this.sfxEnabled;
        localStorage.setItem('sfxEnabled', this.sfxEnabled);
        Object.values(this.sounds).forEach(sound => {
            sound.volume = this.sfxEnabled ? this.sfxVolume : 0;
        });
        this.updateVolumeUI();
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

// Initialize sound effects
try { AudioManager.init(); } catch (e) {}

// Override notification and celebration to play sounds
const originalShowNotification = showNotification;
showNotification = function(msg, isError = false) {
    originalShowNotification(msg, isError);
    try { AudioManager.playSound(isError ? 'error' : 'notification'); } catch (e) {}
};

const originalShowCelebration = showCelebration;
showCelebration = function(msg, points) {
    originalShowCelebration(msg, points);
    try { AudioManager.playSound('reward'); } catch (e) {}
};

// Play click sound on interactive elements
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
        return result;
    } catch (err) {
        console.error('Registration error:', err);
        if (nameEl) nameEl.textContent = 'Connection Error';
        showNotification('Failed to connect to server', true);
        return null;
    }
}

async function refreshUser() {
    if (!tg?.initDataUnsafe?.user) return;
    try {
        const result = await apiCall('/api/user', { initData: tg.initData, referralCode: null });
        currentUser = result;
        updateUI();
        loadWithdrawalHistory();
        updateAdStreakDisplay();
        loadBonusHistory();
    } catch (err) { console.error('Refresh error:', err); }
}
window.refreshUser = refreshUser;

async function addPoints(amount, reason = 'reward') {
    try {
        await apiCall('/api/ad-reward', { initData: tg.initData, rewardAmount: amount, adType: reason });
        await refreshUser();
        return true;
    } catch (err) { showNotification('Failed: ' + err.message, true); return false; }
}
window.addPoints = addPoints;

// ============================================================
// UI UPDATE FUNCTIONS
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
    
    if (referralReward) {
        const reward = POINT_ECONOMY.REFERRAL_REWARDS[currentUser.tier] || 500000;
        referralReward.textContent = `${(reward / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2)} COINS`;
    }
    if (adReward) {
        const reward = POINT_ECONOMY.AD_REWARDS[currentUser.tier] || 5000;
        adReward.textContent = `${(reward / POINT_ECONOMY.POINTS_PER_COIN).toFixed(3)} COINS`;
    }
    if (referralLink && currentUser.referral_code) {
        referralLink.textContent = `https://t.me/YzemanBot?start=${currentUser.referral_code}`;
    }
    
    const withdrawBtn = document.getElementById('withdrawBtn');
    if (withdrawBtn) withdrawBtn.disabled = coins < POINT_ECONOMY.MIN_WITHDRAWAL_COINS;
    
    const walletInput = document.getElementById('walletAddress');
    if (walletInput && currentUser.wallet_address) walletInput.value = currentUser.wallet_address;
    
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
    if (dailyProgressEl) dailyProgressEl.style.width = Math.min((adsWatchedToday / POINT_ECONOMY.DAILY_AD_GOAL) * 100, 100) + '%';
    if (weeklyProgressEl) weeklyProgressEl.style.width = Math.min((adsWatchedWeek / POINT_ECONOMY.WEEKLY_AD_GOAL) * 100, 100) + '%';
}

// ============================================================
// AD HELPER FUNCTIONS
// ============================================================

function calculateAdReward() {
    const baseReward = POINT_ECONOMY.AD_REWARDS[currentUser?.tier] || 5000;
    const rand = Math.random();
    let multiplier = 1, luckyType = 'normal';
    if (rand < POINT_ECONOMY.MEGA_AD_CHANCE) { multiplier = 10; luckyType = 'mega'; }
    else if (rand < POINT_ECONOMY.MEGA_AD_CHANCE + POINT_ECONOMY.GOLDEN_AD_CHANCE) { multiplier = 5; luckyType = 'golden'; }
    else if (rand < POINT_ECONOMY.MEGA_AD_CHANCE + POINT_ECONOMY.GOLDEN_AD_CHANCE + POINT_ECONOMY.LUCKY_AD_CHANCE) { multiplier = 2; luckyType = 'lucky'; }
    return { baseReward, multiplier, finalReward: Math.floor(baseReward * multiplier), luckyType };
}

function checkAndAwardStreakBonus() {
    const bonuses = POINT_ECONOMY.AD_STREAK_BONUSES;
    for (const [streakRequired, bonus] of Object.entries(bonuses)) {
        if (adStreak === parseInt(streakRequired)) return bonus;
    }
    return 0;
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
}

// ============================================================
// MONETAG REWARDED INTERSTITIAL INTEGRATION (Zone: 9683863)
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
    const { finalReward, luckyType } = calculateAdReward();
    updateAdStats();
    const streakBonus = checkAndAwardStreakBonus();
    const milestoneBonus = checkAndAwardMilestones();
    let totalPoints = finalReward + streakBonus + milestoneBonus;
    
    let dailyGoalBonus = 0, weeklyGoalBonus = 0;
    if (adsWatchedToday >= POINT_ECONOMY.DAILY_AD_GOAL && !dailyGoalClaimed) {
        dailyGoalBonus = POINT_ECONOMY.DAILY_AD_GOAL_REWARD;
        dailyGoalClaimed = true;
        localStorage.setItem('dailyGoalClaimed', 'true');
    }
    if (adsWatchedWeek >= POINT_ECONOMY.WEEKLY_AD_GOAL && !weeklyGoalClaimed) {
        weeklyGoalBonus = POINT_ECONOMY.WEEKLY_AD_GOAL_REWARD;
        weeklyGoalClaimed = true;
        localStorage.setItem('weeklyGoalClaimed', 'true');
    }
    totalPoints += dailyGoalBonus + weeklyGoalBonus;
    
    let celebrationMsg = 'Ad Completed!';
    if (luckyType === 'mega') celebrationMsg = '🌟 MEGA AD! 10x REWARD! 🌟';
    else if (luckyType === 'golden') celebrationMsg = '⭐ GOLDEN AD! 5x REWARD! ⭐';
    else if (luckyType === 'lucky') celebrationMsg = '✨ LUCKY AD! 2x REWARD! ✨';
    
    showCelebration(celebrationMsg, totalPoints);
    await addPoints(totalPoints, 'monetag');
    
    if (streakBonus > 0) showNotification(`🔥 Streak bonus! +${(streakBonus / POINT_ECONOMY.POINTS_PER_COIN).toFixed(3)} COINS!`);
    if (dailyGoalBonus > 0) showNotification(`🎯 Daily goal reached!`);
    if (weeklyGoalBonus > 0) showNotification(`🏆 Weekly goal reached!`);
    if (milestoneBonus > 0) showNotification(`🎖️ Ad milestone!`);
    
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
// TASK FUNCTIONS (TIMER & ONE-TIME REWARDS)
// ============================================================

async function checkTask(taskName) {
    try {
        const res = await apiCall('/api/check-task', { taskName });
        return res?.completed || false;
    } catch (e) { return false; }
}

async function completeTaskOnServer(taskName, points) {
    try {
        const res = await apiCall('/api/complete-task', { taskName, points });
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

function startTimer(taskKey, task) {
    if (timerInterval) clearInterval(timerInterval);
    if (taskCheckInterval) clearInterval(taskCheckInterval);
    
    activeTask = taskKey;
    taskStartTime = Date.now();
    
    if (task.useFrame) taskWindow = window.open(task.url, '_blank');
    else {
        const a = document.createElement('a');
        a.href = task.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.click();
    }
    
    const popup = document.getElementById('timerPopup');
    const timerEl = document.getElementById('timerTimeLeft');
    if (popup) popup.classList.add('active');
    
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - taskStartTime) / 1000);
        const remaining = Math.max(0, task.time - elapsed);
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        if (timerEl) timerEl.textContent = `${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}`;
        
        if (remaining <= 0) {
            clearInterval(timerInterval);
            clearInterval(taskCheckInterval);
            timerInterval = null;
            taskCheckInterval = null;
            if (popup) popup.classList.remove('active');
            if (taskWindow && !taskWindow.closed) taskWindow.close();
            showNotification(`Task completed! +${task.points/POINT_ECONOMY.POINTS_PER_COIN} COINS!`, false);
            completeTaskOnServer(task.name, task.points);
            activeTask = null;
            taskWindow = null;
        }
    }, 1000);
    
    if (task.useFrame) {
        taskCheckInterval = setInterval(() => {
            if (taskWindow && taskWindow.closed) {
                clearInterval(timerInterval);
                clearInterval(taskCheckInterval);
                timerInterval = null;
                taskCheckInterval = null;
                if (popup) popup.classList.remove('active');
                showNotification('Task cancelled - window closed early. No reward.', true);
                activeTask = null;
                taskWindow = null;
            }
        }, 500);
    }
}

function cancelTask() {
    if (timerInterval) clearInterval(timerInterval);
    if (taskCheckInterval) clearInterval(taskCheckInterval);
    timerInterval = null;
    taskCheckInterval = null;
    if (taskWindow && !taskWindow.closed) taskWindow.close();
    const popup = document.getElementById('timerPopup');
    if (popup) popup.classList.remove('active');
    showNotification('Task cancelled. No reward.', true);
    activeTask = null;
    taskWindow = null;
}

async function handleTaskClick(taskKey) {
    const TASK_CONFIG = window.TASK_CONFIG;
    if (!TASK_CONFIG) return;
    if (activeTask) { showNotification('Complete current task first!', true); return; }
    const task = TASK_CONFIG[taskKey];
    if (!task) return;
    const completed = await checkTask(task.name);
    if (completed) {
        showNotification('Task already completed!', true);
        const btn = document.getElementById(`task${taskKey.charAt(0).toUpperCase() + taskKey.slice(1)}`);
        if (btn) {
            btn.classList.add('completed');
            if (!btn.querySelector('.completed-badge')) {
                const b = document.createElement('div');
                b.className = 'completed-badge';
                b.innerHTML = '✓ Done';
                btn.appendChild(b);
            }
        }
        return;
    }
    startTimer(taskKey, task);
}

window.TASK_CONFIG = window.TASK_CONFIG || {};
window.handleTaskClick = handleTaskClick;
window.cancelTask = cancelTask;
window.startTimer = startTimer;
window.checkTask = checkTask;
window.completeTask = completeTaskOnServer;

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
            <div class="bonus-history-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 10px; margin-bottom: 8px;">
                <div>
                    <div class="bonus-code-display" style="font-weight: bold; color: var(--gold); font-family: monospace; font-size: 14px;">${item.bonus_code}</div>
                    <div class="bonus-expiry" style="font-size: 10px; color: var(--gray);">Redeemed: ${formattedDate}</div>
                </div>
                <div><span class="bonus-used-badge" style="background: var(--success); color: white; padding: 3px 8px; border-radius: 5px; font-size: 10px;">✅ Redeemed</span></div>
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
    const coins = (currentUser.points || 0) / POINT_ECONOMY.POINTS_PER_COIN;
    if (coins < POINT_ECONOMY.MIN_WITHDRAWAL_COINS) { showNotification(`Need ${POINT_ECONOMY.MIN_WITHDRAWAL_COINS} COINS to withdraw. You have ${coins.toFixed(2)} COINS`, true); return; }
    const wallet = document.getElementById('walletAddress')?.value.trim();
    if (!wallet) { showNotification('Please save your wallet address first', true); return; }
    try {
        const response = await fetch('/api/withdraw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: tg.initData, amount: POINT_ECONOMY.MIN_WITHDRAWAL_COINS, walletAddress: wallet }) });
        if (response.ok) { showNotification(`Withdrawal request submitted for ${POINT_ECONOMY.MIN_WITHDRAWAL_COINS} COINS!`); await refreshUser(); loadWithdrawalHistory(); } 
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
        const totalReward = POINT_ECONOMY.DAILY_BASE_REWARD + (streak * POINT_ECONOMY.DAILY_STREAK_BONUS);
        await addPoints(totalReward, 'daily');
        showNotification(`🎁 Daily reward: +${(totalReward / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2)} COINS! Streak: ${streak} days 🔥`);
        await refreshUser();
        if (document.getElementById('streakCount')) loadDailyStats();
    } catch (err) { showNotification(err.message, true); }
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
        if (todayReward) todayReward.textContent = `${(totalReward / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2)} COINS`;
        if (claimBtn) {
            if (data.claimed_today) { claimBtn.disabled = true; claimBtn.textContent = '✅ Already Claimed Today'; }
            else { claimBtn.disabled = false; claimBtn.textContent = '🎁 Claim Daily Reward'; }
        }
        renderCalendar(data);
    } catch (err) { console.error('Daily stats error:', err); }
}

function renderCalendar(data) {
    const calendar = document.getElementById('calendar');
    if (!calendar) return;
    const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const claimedDays = data?.last_7_days || [];
    const claimedDates = new Set(claimedDays.map(d => d.reward_date));
    const todayStr = new Date().toISOString().split('T')[0];
    calendar.innerHTML = days.map((day, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i));
        const dateStr = date.toISOString().split('T')[0];
        const isClaimed = claimedDates.has(dateStr);
        const isToday = dateStr === todayStr;
        return `<div class="calendar-day ${isClaimed ? 'claimed' : ''} ${isToday ? 'today' : ''}"><div>${day}</div><div style="font-size: 10px; margin-top: 5px;">${date.getDate()}</div>${isClaimed ? '<i class="fas fa-check" style="font-size: 10px; margin-top: 3px;"></i>' : ''}</div>`;
    }).join('');
}

// ============================================================
// WHEEL OF FORTUNE FUNCTIONS
// ============================================================

let wheelSpinning = false, wheelAnimationFrame = null, wheelCurrentAngle = 0;

function drawWheel(segments, currentAngle) {
    const canvas = document.getElementById('wheelCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width, center = size / 2, radius = size / 2 - 10;
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
        ctx.fillText((segments[i].value / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2), radius * 0.65, 0);
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
    const segments = prizes.map((prize, i) => ({ label: (prize / POINT_ECONOMY.POINTS_PER_COIN).toFixed(1), value: prize, color: ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7B05E"][i] }));
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
        if (progress < 1) { wheelAnimationFrame = requestAnimationFrame(animateSpin); }
        else {
            wheelAnimationFrame = null;
            const finalAngle = wheelCurrentAngle % (Math.PI * 2);
            const segmentIndex = Math.floor(((Math.PI * 2) - finalAngle) / ((Math.PI * 2) / segments.length)) % segments.length;
            submitSpin(segments[segmentIndex].value);
        }
    }
    if (wheelAnimationFrame) cancelAnimationFrame(wheelAnimationFrame);
    wheelAnimationFrame = requestAnimationFrame(animateSpin);
}

async function submitSpin(prize) {
    try {
        await apiCall('/api/wheel-spin', { initData: tg.initData });
        await addPoints(prize, 'wheel');
        showNotification(`🎡 You won ${(prize / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2)} COINS!`);
        await loadWheelStatus();
        await refreshUser();
    } catch (err) { showNotification(err.message, true); document.getElementById('spinBtn').disabled = false; }
    finally { wheelSpinning = false; }
}

async function loadWheelStatus() {
    try {
        const data = await apiCall('/api/wheel-status', { initData: tg.initData });
        const statusDiv = document.getElementById('statusText');
        const timerDiv = document.getElementById('timerText');
        const lastRewardDiv = document.getElementById('lastRewardText');
        const spinBtn = document.getElementById('spinBtn');
        if (statusDiv) statusDiv.innerHTML = data.can_spin ? '<span style="color: var(--success);">✅ Ready to spin!</span>' : '<span style="color: var(--warning);">⏳ Next spin available in:</span>';
        if (timerDiv && !data.can_spin) timerDiv.innerHTML = `${data.days_left} day${data.days_left !== 1 ? 's' : ''}`;
        else if (timerDiv) timerDiv.innerHTML = '';
        if (lastRewardDiv && data.last_reward > 0) lastRewardDiv.innerHTML = `Last spin: ${(data.last_reward / POINT_ECONOMY.POINTS_PER_COIN).toFixed(2)} COINS!`;
        else if (lastRewardDiv) lastRewardDiv.innerHTML = 'No spins yet!';
        if (spinBtn) spinBtn.disabled = !data.can_spin;
        const canvas = document.getElementById('wheelCanvas');
        if (canvas) {
            const prizes = POINT_ECONOMY.WHEEL_PRIZES;
            const segments = prizes.map((prize, i) => ({ label: (prize / POINT_ECONOMY.POINTS_PER_COIN).toFixed(1), value: prize, color: ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7B05E"][i] }));
            drawWheel(segments, wheelCurrentAngle);
        }
    } catch (err) { console.error('Wheel status error:', err); }
}

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
    initMonetag();
    
    // Update sound effect UI if elements exist
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
    
    const claimBtn = document.getElementById('claimBtn');
    if (claimBtn) claimBtn.addEventListener('click', claimDailyReward);
    
    const spinBtn = document.getElementById('spinBtn');
    if (spinBtn) spinBtn.addEventListener('click', spinWheel);
}

document.addEventListener('DOMContentLoaded', init);
