// ========== REFERRAL CODE DETECTION (ADD THIS FIRST) ==========
const telegram = window.Telegram.WebApp;
telegram.ready();
telegram.expand();

const initData = telegram.initDataUnsafe;
let referralCode = null;

const urlParams = new URLSearchParams(window.location.search);
referralCode = urlParams.get('start');

if (!referralCode && initData && initData.start_param) {
    referralCode = initData.start_param;
}

if (!referralCode) {
    const storedReferral = sessionStorage.getItem('referralCode');
    if (storedReferral) {
        referralCode = storedReferral;
        sessionStorage.removeItem('referralCode');
    }
}

window.referralCode = referralCode;
console.log('Referral code:', referralCode);
// ========== END REFERRAL CODE DETECTION ==========

// ========== YOUR EXISTING APP CODE GOES BELOW ==========
// Keep all your existing functions like:
// - User registration
// - Points display
// - Ad rewards
// - Referral link generation
// etc.

async function initApp() {
    // Get telegram user
    const user = initData.user;
    
    if (!user) {
        console.error('No user data');
        return;
    }
    
    // Register user with referral code
    const response = await fetch('/api/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            initData: telegram.initData,
            referralCode: window.referralCode || null
        })
    });
    
    const userData = await response.json();
    console.log('User registered:', userData);
    
    // Update UI with user data
    updateUI(userData);
}

// Call init when page loads
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function updateUI(userData) {
    // Your existing UI update code
    document.getElementById('points').innerText = userData.points || 0;
    document.getElementById('tier').innerText = userData.tier || 'Fresher';
    document.getElementById('referrals').innerText = userData.referrals || 0;
    document.getElementById('referral-link').value = `https://t.me/YzemanBot?start=${userData.referral_code}`;
}

// Keep all your other existing functions...
