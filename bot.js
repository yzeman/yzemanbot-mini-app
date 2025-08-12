require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const crypto = require('crypto');
const app = express();

// Configuration
const PORT = process.env.PORT || 3001;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Middleware
app.use(bodyParser.json({ limit: '10kb' }));
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

// API endpoint for web app
app.post('/api/user', async (req, res) => {
  try {
    const { telegramId } = req.body;
    
    const { rows } = await pool.query(
      `SELECT u.*, t.multiplier, t.referral_reward
       FROM users u
       LEFT JOIN tiers t ON u.tier = t.name
       WHERE u.telegram_id = $1`,
      [telegramId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      points: rows[0].points,
      tier: rows[0].tier,
      multiplier: rows[0].multiplier,
      referralCode: rows[0].referral_code
    });
    
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});