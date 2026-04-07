// Get referral code from Telegram WebApp
const telegram = window.Telegram.WebApp;
const initData = telegram.initDataUnsafe;

// Check for referral code in session
let referralCode = null;

// Method 1: From URL parameters
const urlParams = new URLSearchParams(window.location.search);
referralCode = urlParams.get('start');

// Method 2: From Telegram WebApp init data (if stored by bot)
if (initData && initData.start_param) {
    referralCode = initData.start_param;
}

// Method 3: From session storage (if bot stored it)
const storedReferral = sessionStorage.getItem('referralCode');
if (storedReferral) {
    referralCode = storedReferral;
    sessionStorage.removeItem('referralCode');
}

// When registering user, send the referral code
if (referralCode) {
    console.log('📝 Referral code detected:', referralCode);
    // Include in your /api/user request
    fetch('/api/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            initData: telegram.initData,
            referralCode: referralCode
        })
    });
}
