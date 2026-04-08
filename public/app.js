// ============================================================
// REFERRAL CODE DETECTION - MUST BE AT THE VERY TOP
// ============================================================

const telegram = window.Telegram.WebApp;
telegram.ready();
telegram.expand();

let referralCode = null;

// Method 1: Check URL parameters (from bot's web_app url)
const urlParams = new URLSearchParams(window.location.search);
referralCode = urlParams.get('start');

// Method 2: Check Telegram WebApp init data
const initData = telegram.initDataUnsafe;
if (!referralCode && initData && initData.start_param) {
    referralCode = initData.start_param;
}

// Method 3: Check session storage (backup)
if (!referralCode) {
    const stored = sessionStorage.getItem('referralCode');
    if (stored) {
        referralCode = stored;
        sessionStorage.removeItem('referralCode');
    }
}

// Store globally for use in registration
window.referralCode = referralCode;

if (referralCode) {
    console.log('✅ Referral code found:', referralCode);
    telegram.showPopup({
        title: '🎉 Referral Detected!',
        message: 'You were referred! You will get a bonus when you register.',
        buttons: [{ type: 'ok' }]
    });
} else {
    console.log('No referral code found');
}

// ============================================================
// MAIN APP CODE STARTS HERE
// ============================================================

// DOM Elements
const pointsElement = document.getElementById('points');
const tierElement = document.getElementById('tier');
const referralsElement = document.getElementById('referrals');
const referralLinkInput = document.getElementById('referral-link');
const copyBtn = document.getElementById('copy-btn');
const watchAdBtn = document.getElementById('watch-ad-btn');
const loadingElement = document.getElementById('loading');
const userInfoElement = document.getElementById('user-info');

// Current user data
let currentUser = null;

// Initialize the app
async function initApp() {
    try {
        // Show loading
        if (loadingElement) loadingElement.style.display = 'block';
        
        // Get Telegram user data
        const user = initData.user;
        
        if (!user) {
            console.error('No user data from Telegram');
            if (userInfoElement) userInfoElement.innerText = 'Error: Could not get user data';
            return;
        }
        
        // Display user info
        if (userInfoElement) {
            userInfoElement.innerHTML = `
                <img src="${user.photo_url || 'https://via.placeholder.com/50'}" alt="Profile" width="50" height="50" style="border-radius: 50%;">
                <div>
                    <strong>${user.first_name} ${user.last_name || ''}</strong><br>
                    <small>@${user.username || 'no username'}</small>
                </div>
            `;
        }
        
        // Register or update user with referral code
        const response = await fetch('/api/user', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                initData: telegram.initData,
                referralCode: window.referralCode || null
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        
        currentUser = await response.json();
        console.log('User data:', currentUser);
        
        // Update UI with user data
        updateUI();
        
        // Clear referral code after use (so it doesn't get used again)
        window.referralCode = null;
        
    } catch (error) {
        console.error('Failed to initialize app:', error);
        if (userInfoElement) userInfoElement.innerText = 'Error loading data. Please refresh.';
    } finally {
        if (loadingElement) loadingElement.style.display = 'none';
    }
}

// Update UI with current user data
function updateUI() {
    if (currentUser) {
        if (pointsElement) pointsElement.innerText = currentUser.points || 0;
        if (tierElement) tierElement.innerText = currentUser.tier || 'Fresher';
        if (referralsElement) referralsElement.innerText = currentUser.referrals || 0;
        
        // Generate referral link
        if (referralLinkInput && currentUser.referral_code) {
            const referralLink = `https://t.me/YzemanBot?start=${currentUser.referral_code}`;
            referralLinkInput.value = referralLink;
        }
    }
}

// Copy referral link to clipboard
function copyReferralLink() {
    if (!referralLinkInput || !referralLinkInput.value) return;
    
    referralLinkInput.select();
    document.execCommand('copy');
    
    telegram.showPopup({
        title: 'Copied!',
        message: 'Referral link copied to clipboard!',
        buttons: [{ type: 'ok' }]
    });
}

// Watch ad to earn points
async function watchAd() {
    if (!currentUser) return;
    
    try {
        // Simulate ad watching (in real app, you'd integrate an ad network)
        telegram.showPopup({
            title: 'Watch Ad',
            message: 'Watch a short ad to earn points?',
            buttons: [
                { type: 'ok', text: 'Watch' },
                { type: 'cancel', text: 'Cancel' }
            ]
        }, async (buttonId) => {
            if (buttonId === 'ok') {
                // Show "watching" state
                if (watchAdBtn) {
                    watchAdBtn.disabled = true;
                    watchAdBtn.innerText = 'Watching ad...';
                }
                
                // Simulate ad delay (3 seconds)
                setTimeout(async () => {
                    const rewardAmount = 100; // Base reward
                    
                    const response = await fetch('/api/ad-reward', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            initData: telegram.initData,
                            rewardAmount: rewardAmount,
                            adType: 'rewarded_video'
                        })
                    });
                    
                    if (response.ok) {
                        const result = await response.json();
                        currentUser.points = result.points;
                        updateUI();
                        
                        telegram.showPopup({
                            title: '🎉 Reward Earned!',
                            message: `You earned ${rewardAmount} points!`,
                            buttons: [{ type: 'ok' }]
                        });
                    } else {
                        throw new Error('Failed to process reward');
                    }
                    
                    if (watchAdBtn) {
                        watchAdBtn.disabled = false;
                        watchAdBtn.innerText = 'Watch Ad (+100 points)';
                    }
                }, 3000);
            }
        });
    } catch (error) {
        console.error('Ad reward error:', error);
        telegram.showPopup({
            title: 'Error',
            message: 'Failed to process ad reward. Please try again.',
            buttons: [{ type: 'ok' }]
        });
        if (watchAdBtn) {
            watchAdBtn.disabled = false;
            watchAdBtn.innerText = 'Watch Ad (+100 points)';
        }
    }
}

// Refresh user data
async function refreshUserData() {
    try {
        const response = await fetch('/api/user', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                initData: telegram.initData,
                referralCode: null
            })
        });
        
        if (response.ok) {
            currentUser = await response.json();
            updateUI();
        }
    } catch (error) {
        console.error('Refresh error:', error);
    }
}

// Event listeners
if (copyBtn) {
    copyBtn.addEventListener('click', copyReferralLink);
}

if (watchAdBtn) {
    watchAdBtn.addEventListener('click', watchAd);
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

// Refresh data every 30 seconds
setInterval(refreshUserData, 30000);
