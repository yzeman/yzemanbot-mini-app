// ============================================
// SHARED APP FUNCTIONS FOR YZEMANBOT
// Include this in all pages
// ============================================

const tg = window.Telegram?.WebApp;
if (tg) {
    tg.expand();
    tg.ready();
}

let currentUser = null;
let referralCode = null;

// Detect referral code from URL
const urlParams = new URLSearchParams(window.location.search);
referralCode = urlParams.get('start');
if (referralCode && referralCode.startsWith('ref-')) {
    referralCode = referralCode.substring(4);
}

// API call helper
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

// Register/Load user
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

// Refresh user data
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

// Add points
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

// Update UI elements
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
        referralLink.textContent = `https://t.me/YzemanBot?start=ref-${currentUser.referral_code}`;
    }
    
    const withdrawBtn = document.getElementById('withdrawBtn');
    if (withdrawBtn) withdrawBtn.disabled = usd < 1000;
    
    const walletInput = document.getElementById('walletAddress');
    if (walletInput && currentUser.wallet_address) {
        walletInput.value = currentUser.wallet_address;
    }
}

// Copy referral link
function copyReferralLink() {
    const link = document.getElementById('referralLink')?.textContent;
    if (link) {
        navigator.clipboard.writeText(link);
        showNotification('Referral link copied!');
    }
}

// Save wallet address
async function saveWallet() {
    const address = document.getElementById('walletAddress')?.value.trim();
    if (!address) {
        showNotification('Enter wallet address', true);
        return;
    }
    if (!address.startsWith('T') || address.length < 34) {
        showNotification('Enter valid USDT (TRC-20) address (starts with T)', true);
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

// Request withdrawal
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

// Load withdrawal history
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

// Watch ad
async function watchAd() {
    const adRewards = { Fresher: 557, Brute: 1058, Silver: 1559, Gold: 2021, Platinum: 2753 };
    const reward = adRewards[currentUser?.tier] || 557;
    
    const loading = document.getElementById('adLoading');
    const adStatus = document.getElementById('adStatus');
    const adCountdown = document.getElementById('adCountdown');
    
    if (loading) loading.style.display = 'flex';
    if (adStatus) adStatus.textContent = 'Loading advertisement...';
    if (adCountdown) adCountdown.textContent = '';
    
    if (typeof show_9683863 === 'function') {
        try {
            if (adStatus) adStatus.textContent = 'Showing ad...';
            await show_9683863();
            if (adStatus) adStatus.textContent = 'Ad completed! Processing reward...';
            await addPoints(reward);
            showNotification(`+${reward} points earned!`);
        } catch (error) {
            console.error('Ad error:', error);
            await simulateFallbackAd(reward, adStatus, adCountdown);
        }
    } else {
        await simulateFallbackAd(reward, adStatus, adCountdown);
    }
    
    setTimeout(() => {
        if (loading) loading.style.display = 'none';
    }, 1000);
}

async function simulateFallbackAd(reward, adStatus, adCountdown) {
    if (adStatus) adStatus.textContent = 'Watch ad for 5 seconds to earn points!';
    let seconds = 5;
    if (adCountdown) adCountdown.textContent = `⏱️ ${seconds} seconds remaining`;
    const timer = setInterval(() => {
        seconds--;
        if (adCountdown) adCountdown.textContent = `⏱️ ${seconds} seconds remaining`;
        if (seconds <= 0) {
            clearInterval(timer);
            if (adCountdown) adCountdown.textContent = '✅ Ad completed!';
        }
    }, 1000);
    await new Promise(resolve => setTimeout(resolve, 5000));
    if (adStatus) adStatus.textContent = 'Processing reward...';
    await addPoints(reward);
    showNotification(`+${reward} points earned!`);
}

// YouTube and Website tasks
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

// Social tasks
let completedSocial = JSON.parse(localStorage.getItem('completedSocial') || '{}');

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

// Bonus codes
const bonusCodesList = {
    "BASER": { points: 2000, dollars: 0, description: "2,000 bonus points" },
    "BOTYZEMAN": { points: 100000, dollars: 0, description: "100,000 bonus points" },
    "EARNSBOTT": { points: 0, dollars: 15, description: "$15 bonus" },
    "BONUSBOTTER": { points: 0, dollars: 100, description: "$100 bonus" },
    "YZEMASTER1": { points: 50000, dollars: 100, description: "50,000 points + $100" }
};

let usedBonusCodes = JSON.parse(localStorage.getItem('usedBonusCodes') || '{}');

async function redeemBonus() {
    const code = document.getElementById('bonusCodeInput')?.value.trim().toUpperCase();
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
    if (document.getElementById('bonusCodeInput')) document.getElementById('bonusCodeInput').value = '';
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

// Notification helper
function showNotification(msg, isError = false) {
    const notif = document.getElementById('notification');
    if (notif) {
        notif.textContent = msg;
        notif.style.background = isError ? '#ff5252' : '#00c853';
        notif.style.display = 'block';
        setTimeout(() => notif.style.display = 'none', 4000);
    } else {
        // Fallback for pages without notification element
        const fallback = document.createElement('div');
        fallback.textContent = msg;
        fallback.style.cssText = `position:fixed;top:20px;left:50%;transform:translateX(-50%);background:${isError ? '#ff5252' : '#00c853'};color:white;padding:12px 24px;border-radius:12px;z-index:10000;font-size:14px;`;
        document.body.appendChild(fallback);
        setTimeout(() => fallback.remove(), 4000);
    }
}

// Initialize app
async function initApp() {
    currentUser = await registerUser();
    if (currentUser) {
        updateUI();
        loadWithdrawalHistory();
        displayBonusList();
        
        // Social task buttons
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
        
        // Bonus redeem button
        const redeemBtn = document.getElementById('redeemBonusBtn');
        if (redeemBtn) redeemBtn.addEventListener('click', redeemBonus);
    }
}

// Auto-refresh every 30 seconds
setInterval(() => { if (currentUser) refreshUser(); }, 30000);

// Start app when DOM ready
document.addEventListener('DOMContentLoaded', initApp);
