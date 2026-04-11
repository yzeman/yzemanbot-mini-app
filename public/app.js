// ============================================================
// YZEMANBOT - COMPLETE APP WITH ALL FEATURES
// ============================================================

const tg = window.Telegram?.WebApp;
if (tg) {
    tg.expand();
    tg.ready();
}

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

let currentUser = null;
let completedSocial = JSON.parse(localStorage.getItem('completedSocial') || '{}');
let usedBonusCodes = JSON.parse(localStorage.getItem('usedBonusCodes') || '{}');

// ============================================================
// BONUS CODES LIST
// ============================================================

const bonusCodesList = {
    "BASER": { points: 2000, dollars: 0, description: "2,000 bonus points" },
    "BOTYZEMAN": { points: 100000, dollars: 0, description: "100,000 bonus points" },
    "EARNSBOTT": { points: 0, dollars: 15, description: "$15 bonus" },
    "BONUSBOTTER": { points: 0, dollars: 100, description: "$100 bonus" },
    "YZEMASTER1": { points: 50000, dollars: 100, description: "50,000 points + $100" }
};

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
    } catch (err) {
        console.error('Refresh error:', err);
    }
}

async function addPoints(amount) {
    try {
        const result = await apiCall('/api/ad-reward', {
            initData: tg.initData,
            rewardAmount: amount,
            adType: 'reward'
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
    const usd = points / 100000;
    const progress = Math.min((usd / 1000) * 100, 100);
    
    const pointsEl = document.getElementById('points');
    const usdEl = document.getElementById('usd');
    const tierEl = document.getElementById('tier');
    const progressAmount = document.getElementById('progressAmount');
    const progressBar = document.getElementById('progressBar');
    const referralCount = document.getElementById('referralCount');
    const referralReward = document.getElementById('referralReward');
    const adReward = document.getElementById('adReward');
    const referralLink = document.getElementById('referralLink');
    
    if (pointsEl) pointsEl.textContent = points.toLocaleString();
    if (usdEl) usdEl.textContent = `$${usd.toFixed(2)}`;
    if (tierEl) tierEl.textContent = currentUser.tier || 'Fresher';
    if (progressAmount) progressAmount.textContent = usd.toFixed(2);
    if (progressBar) progressBar.style.width = progress + '%';
    if (referralCount) referralCount.textContent = currentUser.referrals || 0;
    
    const tierRewards = { Fresher: 5000, Brute: 10000, Silver: 15000, Gold: 20000, Platinum: 30000 };
    if (referralReward) referralReward.textContent = tierRewards[currentUser.tier] || 5000;
    
    const adRewards = { Fresher: 557, Brute: 1058, Silver: 1559, Gold: 2021, Platinum: 2753 };
    if (adReward) adReward.textContent = adRewards[currentUser.tier] || 557;
    
    if (referralLink && currentUser.referral_code) {
        referralLink.textContent = `https://t.me/YzemanBot?start=${currentUser.referral_code}`;
    }
    
    const withdrawBtn = document.getElementById('withdrawBtn');
    if (withdrawBtn) withdrawBtn.disabled = usd < 1000;
    
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
        const tierRefs = [0, 50, 150, 300, 500];
        const idx = tiers.indexOf(currentUser.tier);
        const nextRefs = tierRefs[idx + 1] || 500;
        if (nextTierReq) nextTierReq.textContent = nextRefs;
        const tierProgress = ((currentUser.referrals || 0) / nextRefs) * 100;
        if (tierProgressBar) tierProgressBar.style.width = Math.min(tierProgress, 100) + '%';
    }
    
    displayBonusList();
}

// ============================================================
// AD WATCHING - OPEN WITHIN MINI APP USING IFRAME MODAL
// ============================================================

let isWatchingAd = false;

function getRewardAmount() {
    const adRewards = { Fresher: 557, Brute: 1058, Silver: 1559, Gold: 2021, Platinum: 2753 };
    return adRewards[currentUser?.tier] || 557;
}

// Create modal overlay for ad
function showAdModal() {
    const reward = getRewardAmount();
    const userId = currentUser?.id || 'guest';
    const baseUrl = window.location.origin;
    const adUrl = `${baseUrl}/ad.html?userId=${userId}&reward=${reward}`;
    
    // Create modal container
    const modal = document.createElement('div');
    modal.id = 'adModal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: #000;
        z-index: 10001;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    `;
    
    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕ Close';
    closeBtn.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        background: #ff5252;
        color: white;
        border: none;
        border-radius: 20px;
        padding: 8px 16px;
        font-size: 14px;
        cursor: pointer;
        z-index: 10002;
    `;
    closeBtn.onclick = () => {
        document.body.removeChild(modal);
        isWatchingAd = false;
        showNotification('Ad closed. No reward earned.', true);
    };
    
    // Create iframe to load ad
    const iframe = document.createElement('iframe');
    iframe.style.cssText = `
        width: 100%;
        height: 100%;
        border: none;
    `;
    iframe.src = adUrl;
    
    modal.appendChild(closeBtn);
    modal.appendChild(iframe);
    document.body.appendChild(modal);
    
    // Listen for messages from iframe
    window.addEventListener('message', function adMessageHandler(event) {
        if (event.data && event.data.event === 'reward-earned') {
            const rewardAmount = event.data.amount || reward;
            showNotification(`🎉 +${rewardAmount} points earned!`);
            addPoints(rewardAmount);
            
            // Remove modal
            if (document.body.contains(modal)) {
                document.body.removeChild(modal);
            }
            isWatchingAd = false;
            
            // Remove listener
            window.removeEventListener('message', adMessageHandler);
        } else if (event.data && event.data.event === 'ad-failed') {
            showNotification('Ad failed. Please try again.', true);
            if (document.body.contains(modal)) {
                document.body.removeChild(modal);
            }
            isWatchingAd = false;
            window.removeEventListener('message', adMessageHandler);
        }
    });
}

// Main watch ad function
window.watchAd = async function() {
    if (isWatchingAd) {
        showNotification('Please wait, an ad is already playing.', true);
        return;
    }
    
    if (!currentUser) {
        showNotification('Please log in to watch ads.', true);
        return;
    }
    
    isWatchingAd = true;
    showAdModal();
};

// ============================================================
// YOUTUBE & WEBSITE TASKS
// ============================================================

function startYoutubeTask() {
    window.open('https://youtube.com/watch?v=dQw4w9WgXcQ', '_blank');
    showNotification('Watch the video for 5 minutes to earn points');
    setTimeout(async () => {
        await addPoints(12000);
        showNotification('YouTube task completed! +12000 points');
    }, 300000);
}

function startWebsiteTask() {
    window.open('https://yzeupdates.lat/articles.html', '_blank');
    showNotification('Stay on the website for 2 minutes');
    setTimeout(async () => {
        await addPoints(5000);
        showNotification('Website task completed! +5000 points');
    }, 120000);
}

// ============================================================
// SOCIAL TASKS
// ============================================================

async function completeSocialTask(taskName, reward = 5000000) {
    if (completedSocial[taskName]) {
        showNotification('You already completed this task!', true);
        return;
    }
    completedSocial[taskName] = true;
    localStorage.setItem('completedSocial', JSON.stringify(completedSocial));
    await addPoints(reward);
    showNotification(`+${reward.toLocaleString()} points earned! 🎉`);
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
    
    let totalPoints = 0;
    let msg = '';
    if (bonus.points > 0) {
        totalPoints += bonus.points;
        msg += `${bonus.points.toLocaleString()} points `;
    }
    if (bonus.dollars > 0) {
        totalPoints += bonus.dollars * 100000;
        msg += `$${bonus.dollars} `;
    }
    
    usedBonusCodes[code] = today;
    localStorage.setItem('usedBonusCodes', JSON.stringify(usedBonusCodes));
    
    await addPoints(totalPoints);
    showNotification(`Bonus code redeemed! +${msg}`);
    codeInput.value = '';
    displayBonusList();
}

function displayBonusList() {
    const today = new Date().toDateString();
    const list = document.getElementById('bonusList');
    if (!list) return;
    
    list.innerHTML = '';
    for (const [code, bonus] of Object.entries(bonusCodesList)) {
        const rewardText = [];
        if (bonus.points > 0) rewardText.push(`${bonus.points.toLocaleString()} pts`);
        if (bonus.dollars > 0) rewardText.push(`$${bonus.dollars}`);
        const isUsed = usedBonusCodes[code] === today;
        
        const item = document.createElement('div');
        item.className = 'bonus-item';
        item.innerHTML = `
            <span class="bonus-code">${code}</span>
            <span class="bonus-reward">${rewardText.join(' + ')}</span>
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
    
    const usdAmount = (currentUser.points || 0) / 100000;
    if (usdAmount < 1000) {
        showNotification(`Need $1000 to withdraw. You have $${usdAmount.toFixed(2)}`, true);
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
                amount: 1000,
                walletAddress: wallet
            })
        });
        
        if (response.ok) {
            showNotification('Withdrawal request submitted! Admin will review it.');
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
                <div class="history-amount">$${w.amount || 0}</div>
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
        showNotification(result.message);
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
        
        const baseReward = 1000;
        const streakBonus = Math.floor((data.current_streak || 0) / 7) * 5000;
        const rewardAmount = baseReward + streakBonus;
        if (todayReward) todayReward.textContent = `${rewardAmount.toLocaleString()} points`;
        
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
        ctx.font = "bold 16px 'Segoe UI'";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(segments[i].label, radius * 0.65, 0);
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
    
    const segments = [
        { label: "100", value: 100, color: "#FF6B6B" },
        { label: "250", value: 250, color: "#4ECDC4" },
        { label: "500", value: 500, color: "#45B7D1" },
        { label: "1000", value: 1000, color: "#96CEB4" },
        { label: "2500", value: 2500, color: "#FFEAA7" },
        { label: "5000", value: 5000, color: "#DDA0DD" },
        { label: "7500", value: 7500, color: "#98D8C8" },
        { label: "10000", value: 10000, color: "#F7B05E" }
    ];
    
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
        showNotification(result.message);
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
            lastRewardDiv.innerHTML = `Last spin: ${data.last_reward.toLocaleString()} points!`;
        } else if (lastRewardDiv) {
            lastRewardDiv.innerHTML = 'No spins yet!';
        }
        
        if (spinBtn) {
            spinBtn.disabled = !data.can_spin;
        }
        
        const canvas = document.getElementById('wheelCanvas');
        if (canvas) {
            const segments = [
                { label: "100", value: 100, color: "#FF6B6B" },
                { label: "250", value: 250, color: "#4ECDC4" },
                { label: "500", value: 500, color: "#45B7D1" },
                { label: "1000", value: 1000, color: "#96CEB4" },
                { label: "2500", value: 2500, color: "#FFEAA7" },
                { label: "5000", value: 5000, color: "#DDA0DD" },
                { label: "7500", value: 7500, color: "#98D8C8" },
                { label: "10000", value: 10000, color: "#F7B05E" }
            ];
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
        
        container.innerHTML = data.map((user, idx) => `
            <div class="leaderboard-item">
                <div class="rank ${idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : ''}">#${idx + 1}</div>
                <div class="avatar"><i class="fas fa-user"></i></div>
                <div class="info">
                    <div class="name">${user.first_name || user.username || 'User'}</div>
                    <div class="username">${user.username ? '@' + user.username : ''}</div>
                    <div class="tier-badge">${user.tier || 'Fresher'}</div>
                </div>
                <div class="score">${(user.points || 0).toLocaleString()} pts</div>
            </div>
        `).join('');
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
                <div class="score">${(user.referral_count || 0)} referrals</div>
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
        
        container.innerHTML = data.map((user, idx) => `
            <div class="leaderboard-item">
                <div class="rank ${idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : ''}">#${idx + 1}</div>
                <div class="avatar"><i class="fas fa-user"></i></div>
                <div class="info">
                    <div class="name">${user.first_name || user.username || 'User'}</div>
                    <div class="username">${user.username ? '@' + user.username : ''}</div>
                    <div class="tier-badge">${user.tier || 'Fresher'}</div>
                </div>
                <div class="score">${(user.weekly_earnings || 0).toLocaleString()} pts</div>
            </div>
        `).join('');
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
        if (totalPointsEarned) totalPointsEarned.textContent = (data.userStats.total_points_earned || 0).toLocaleString();
        
        if (!grid) return;
        
        const iconMap = {
            'Loyal User': '🔥', 'Referral Master': '👑', 'Points Millionaire': '💰',
            'Social Butterfly': '🦋', 'Tournament Winner': '🏆', 'Team Player': '🤝',
            'Platinum Elite': '💎', 'Wheel Champion': '🎡', 'Daily Streak 7': '📅', 'Super Referrer': '⭐'
        };
        
        grid.innerHTML = data.achievements.map(ach => `
            <div class="achievement-card ${ach.achieved ? 'unlocked' : 'locked'}">
                <div class="achievement-icon">${iconMap[ach.name] || '🏅'}</div>
                <div class="achievement-name">${ach.name}</div>
                <div class="achievement-desc">${ach.description}</div>
                <div class="achievement-reward">+${(ach.points_reward || 0).toLocaleString()} pts</div>
                ${ach.achieved ? '<div class="unlocked-badge"><i class="fas fa-check"></i> Unlocked</div>' : '<div class="locked-badge"><i class="fas fa-lock"></i> Locked</div>'}
            </div>
        `).join('');
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
        showNotification('You joined the tournament! Start earning points!');
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
        
        if (myRankCard && data.my_rank) {
            myRankCard.style.display = 'block';
            if (myRank) myRank.textContent = `#${data.my_rank}`;
            if (myPoints) myPoints.textContent = `${data.my_points.toLocaleString()} pts this week`;
        }
        
        if (!standingsList) return;
        
        if (!data.standings.length) {
            standingsList.innerHTML = '<div class="loading">No participants yet. Be the first!</div>';
            return;
        }
        
        standingsList.innerHTML = data.standings.map((user, idx) => `
            <div class="leaderboard-item">
                <div class="rank ${idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : ''}">#${idx + 1}</div>
                <div class="avatar"><i class="fas fa-user"></i></div>
                <div class="info">
                    <div class="name">${user.first_name || user.username || 'User'}</div>
                    <div class="username">${user.username ? '@' + user.username : ''}</div>
                </div>
                <div class="score">${(user.weekly_points || 0).toLocaleString()} pts</div>
            </div>
        `).join('');
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
        
        container.innerHTML = `
            <div class="team-card">
                <div class="team-name">${data.team.name}</div>
                <div class="team-code">Team Code: <strong>${data.team.code}</strong> <button class="copy-btn" onclick="window.copyTeamCode('${data.team.code}')" style="background:none;border:none;color:var(--secondary);cursor:pointer;">📋 Copy</button></div>
                <div>👑 Leader: ${data.team.leader_name || 'You'}</div>
                <div>👥 Members: ${data.team.member_count}</div>
                <div>💰 Total Points: ${(data.team.total_points || 0).toLocaleString()}</div>
                <div>📊 Total Referrals: ${data.team.total_referrals || 0}</div>
                <div class="member-list"><strong>Members:</strong> ${data.members.map(m => `<div class="member-item"><span>${m.first_name || m.username || 'User'} ${m.is_leader ? '<span class="leader-badge">👑 Leader</span>' : ''}</span><span>${(m.points || 0).toLocaleString()} pts</span></div>`).join('')}</div>
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
        
        container.innerHTML = data.map((team, idx) => `
            <div class="leaderboard-item">
                <div class="rank ${idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : ''}">#${idx + 1}</div>
                <div class="info" style="flex:1;">
                    <div class="name">${team.name}</div>
                    <div class="username">Leader: ${team.leader_name || 'Unknown'} | ${team.member_count} members</div>
                </div>
                <div class="score">${(team.total_points || 0).toLocaleString()} pts</div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Team leaderboard error:', err);
    }
}

async function loadMonthlyCompetition() {
    try {
        const data = await apiCall('/api/team/monthly-competition', { initData: tg.initData });
        const container = document.getElementById('monthlyInfo');
        if (!container) return;
        
        if (!data.standings.length) {
            container.innerHTML = '<div class="team-card"><p style="text-align:center;">No teams competing this month</p></div>';
            return;
        }
        
        container.innerHTML = `
            <div class="team-card">
                <h3>${data.month} Competition</h3>
                ${data.standings.map((team, idx) => `
                    <div class="member-item">
                        <span><strong>#${idx + 1}</strong> ${team.name}</span>
                        <span>${(team.team_points || 0).toLocaleString()} pts</span>
                    </div>
                `).join('')}
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
// TAB SWITCHING (for index.html)
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

async function initApp() {
    currentUser = await registerUser();
    if (currentUser) {
        updateUI();
        loadWithdrawalHistory();
        displayBonusList();
        
        const socialButtons = [
            { id: 'youtube1Btn', task: 'youtube1', url: 'https://youtube.com/@yzeupdates' },
            { id: 'youtube2Btn', task: 'youtube2', url: 'https://youtube.com/@codingappwithhtml' },
            { id: 'youtube3Btn', task: 'youtube3', url: 'https://youtube.com/@yzemanhacker8831' },
            { id: 'facebookBtn', task: 'facebook', url: 'https://www.facebook.com/share/1ADZJ1DVyn/' },
            { id: 'instagramBtn', task: 'instagram', url: 'https://www.instagram.com/yzeupdates' },
            { id: 'joinChannelBtn', task: 'telegram', url: 'https://t.me/YzemanEarnBotChannel', reward: 5000000 }
        ];
        
        socialButtons.forEach(btn => {
            const element = document.getElementById(btn.id);
            if (element) {
                element.addEventListener('click', () => {
                    window.open(btn.url, '_blank');
                    completeSocialTask(btn.task, btn.reward || 5000000);
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
        if (watchAdBtn) watchAdBtn.addEventListener('click', window.watchAd);
        
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
        
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const tabId = tab.dataset.tab + 'Tab';
                document.getElementById(tabId).classList.add('active');
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
        
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const tabId = tab.dataset.tab + 'Tab';
                document.getElementById(tabId).classList.add('active');
                if (tab.dataset.tab === 'leaderboard') loadTeamLeaderboard();
                if (tab.dataset.tab === 'monthly') loadMonthlyCompetition();
            });
        });
    }
}

setInterval(() => { if (currentUser) refreshUser(); }, 30000);
document.addEventListener('DOMContentLoaded', initApp);
