const express = require('express');
const bodyParser = require('body-parser');
const app = express();

app.use(bodyParser.json());

// In-memory database (replace with real DB in production)
const users = {};
const referrals = {};

// Referral endpoint
app.get('/api/referral', (req, res) => {
    const refCode = req.query.ref;
    const userId = req.query.user;
    
    if (!refCode || !userId) {
        return res.status(400).json({ error: 'Invalid parameters' });
    }
    
    // Prevent self-referral
    if (referrals[refCode] === userId) {
        return res.json({ success: false, message: 'Self-referral not allowed' });
    }
    
    // First-time referral
    if (!referrals[refCode]) {
        referrals[refCode] = {
            referred: [userId],
            count: 1
        };
        
        // Add reward to referrer
        const referrer = Object.keys(users).find(id => users[id].referralCode === refCode);
        if (referrer) {
            users[referrer].points += 1000;
            users[referrer].referrals++;
        }
        
        return res.json({ 
            success: true, 
            reward: 1000,
            message: 'Referral recorded' 
        });
    }
    
    // Existing referral
    if (!referrals[refCode].referred.includes(userId)) {
        referrals[refCode].referred.push(userId);
        referrals[refCode].count++;
        
        // Add reward to referrer
        const referrer = Object.keys(users).find(id => users[id].referralCode === refCode);
        if (referrer) {
            users[referrer].points += 1000;
            users[referrer].referrals++;
        }
        
        return res.json({ 
            success: true, 
            reward: 1000,
            message: 'Referral recorded' 
        });
    }
    
    return res.json({ success: false, message: 'Already referred' });
});

// User registration endpoint
app.post('/api/register', (req, res) => {
    const { userId, referralCode } = req.body;
    
    if (!userId) {
        return res.status(400).json({ error: 'User ID required' });
    }
    
    users[userId] = {
        points: 0,
        referrals: 0,
        referralCode: referralCode || generateReferralCode(),
        createdAt: new Date()
    };
    
    res.json(users[userId]);
});

function generateReferralCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

app.listen(3000, () => {
    console.log('Server running on port 3000');
});