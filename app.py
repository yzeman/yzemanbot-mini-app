# app.py
from flask import Flask, request, jsonify, make_response
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta
import os
import requests
import json
import uuid
from functools import wraps

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///app.db').replace('postgres://', 'postgresql://', 1)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'supersecretkey')
db = SQLAlchemy(app)

# Telegram configuration
BOT_TOKEN = os.getenv('BOT_TOKEN', '6235048166:AAE7jQItOA3n5tqn_971ih6RQ8qvPY4V7X0')
ADMIN_CHAT_ID = os.getenv('ADMIN_CHAT_ID', '1828689837')
API_URL = f'https://api.telegram.org/bot{BOT_TOKEN}'

# Tier configuration
TIERS = [
    {"name": "Fresher", "refsRequired": 0, "multiplier": 1, "adReward": 51, "referralReward": 1000},
    {"name": "Brute", "refsRequired": 50, "multiplier": 1.2, "adReward": 74, "referralReward": 1500},
    {"name": "Silver", "refsRequired": 150, "multiplier": 1.5, "adReward": 105, "referralReward": 2000},
    {"name": "Gold", "refsRequired": 300, "multiplier": 2, "adReward": 140, "referralReward": 3000},
    {"name": "Platinum", "refsRequired": 500, "multiplier": 3, "adReward": 210, "referralReward": 5000}
]

# Bonus codes configuration
BONUS_CODES = {
    "BASER": {"points": 2000, "dollars": 0, "daily": True},
    "BOTYZEMAN": {"points": 100000, "dollars": 0, "daily": True},
    "EARNSBOTT": {"points": 0, "dollars": 15, "daily": True},
    "BONUSBOTTER": {"points": 0, "dollars": 100, "daily": True},
    "GAINMASTER": {"points": 50000, "dollars": 100, "daily": True}
}

# Database Models
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    telegram_id = db.Column(db.Integer, unique=True, nullable=False)
    username = db.Column(db.String(80))
    first_name = db.Column(db.String(80))
    last_name = db.Column(db.String(80))
    photo_url = db.Column(db.String(200))
    referral_code = db.Column(db.String(10), unique=True)
    referrer_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Stats
    points = db.Column(db.Integer, default=0)
    referrals = db.Column(db.Integer, default=0)
    tier = db.Column(db.String(20), default='Fresher')
    multiplier = db.Column(db.Float, default=1.0)
    next_tier_refs = db.Column(db.Integer, default=50)
    social_dollars = db.Column(db.Float, default=0.0)
    wallet_address = db.Column(db.String(100))
    
    # Activity tracking
    last_ad_watch = db.Column(db.DateTime)
    last_website_visit = db.Column(db.DateTime)
    last_youtube_watch = db.Column(db.DateTime)
    last_premium_ad = db.Column(db.DateTime)
    ad_count = db.Column(db.Integer, default=0)
    premium_ad_count = db.Column(db.Integer, default=0)
    daily_reset = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Social tasks
    youtube1_completed = db.Column(db.Boolean, default=False)
    youtube2_completed = db.Column(db.Boolean, default=False)
    youtube3_completed = db.Column(db.Boolean, default=False)
    facebook_completed = db.Column(db.Boolean, default=False)
    instagram_completed = db.Column(db.Boolean, default=False)
    twitter_completed = db.Column(db.Boolean, default=False)
    telegram_completed = db.Column(db.Boolean, default=False)
    
    # Bonus codes
    used_bonus_codes = db.Column(db.JSON, default={})
    
    referred_users = db.relationship('User', backref=db.backref('referrer', remote_side=[id]))
    
    def to_dict(self):
        return {
            'id': self.id,
            'telegram_id': self.telegram_id,
            'username': self.username,
            'first_name': self.first_name,
            'last_name': self.last_name,
            'photo_url': self.photo_url,
            'referral_code': self.referral_code,
            'points': self.points,
            'referrals': self.referrals,
            'tier': self.tier,
            'multiplier': self.multiplier,
            'next_tier_refs': self.next_tier_refs,
            'social_dollars': self.social_dollars,
            'wallet_address': self.wallet_address,
            'ad_count': self.ad_count,
            'premium_ad_count': self.premium_ad_count,
            'daily_reset': self.daily_reset.isoformat() if self.daily_reset else None,
            'completed_social': {
                'youtube1': self.youtube1_completed,
                'youtube2': self.youtube2_completed,
                'youtube3': self.youtube3_completed,
                'facebook': self.facebook_completed,
                'instagram': self.instagram_completed,
                'twitter': self.twitter_completed,
                'telegram': self.telegram_completed
            },
            'used_bonus_codes': self.used_bonus_codes
        }

# Helper functions
def validate_telegram_data(data):
    """Validate Telegram WebApp data"""
    # In production, you should validate the hash properly
    # For now, we'll just trust the data
    return True

def generate_referral_code():
    """Generate a unique referral code"""
    while True:
        code = str(uuid.uuid4())[:8].upper()
        if not User.query.filter_by(referral_code=code).first():
            return code

def check_tier_upgrade(user):
    """Check and upgrade user tier if needed"""
    current_tier_index = next((i for i, t in enumerate(TIERS) if t['name'] == user.tier), -1)
    if current_tier_index < len(TIERS) - 1:
        next_tier = TIERS[current_tier_index + 1]
        if user.referrals >= next_tier['refsRequired']:
            user.tier = next_tier['name']
            user.multiplier = next_tier['multiplier']
            if current_tier_index < len(TIERS) - 2:
                next_next_tier = TIERS[current_tier_index + 2]
                user.next_tier_refs = next_next_tier['refsRequired'] - user.referrals
            else:
                user.next_tier_refs = 0
            return True
    return False

def reset_daily_tasks(user):
    """Reset daily tasks if needed"""
    if datetime.utcnow() > user.daily_reset:
        user.ad_count = 0
        user.premium_ad_count = 0
        user.daily_reset = datetime.utcnow() + timedelta(days=1)
        return True
    return False

def telegram_auth_required(f):
    """Decorator to require Telegram authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        data = request.json
        if not data.get('initData'):
            return jsonify({'error': 'Telegram initData required'}), 401
            
        if not validate_telegram_data(data['initData']):
            return jsonify({'error': 'Invalid Telegram data'}), 401
            
        # Extract user ID from initData
        init_data = data['initData']
        user_data = {}
        if 'user' in init_data:
            user_data = json.loads(init_data['user'])
            
        telegram_id = user_data.get('id')
        if not telegram_id:
            return jsonify({'error': 'User ID not found'}), 400
            
        # Find or create user
        user = User.query.filter_by(telegram_id=telegram_id).first()
        if not user:
            user = User(
                telegram_id=telegram_id,
                username=user_data.get('username'),
                first_name=user_data.get('first_name'),
                last_name=user_data.get('last_name'),
                photo_url=user_data.get('photo_url'),
                referral_code=generate_referral_code()
            )
            db.session.add(user)
            db.session.commit()
            
        # Check if we have referral code in start param
        if data.get('ref_code'):
            referrer = User.query.filter_by(referral_code=data['ref_code']).first()
            if referrer and referrer.id != user.id and not user.referrer_id:
                user.referrer_id = referrer.id
                referrer.referrals += 1
                referrer.points += int(referrer.multiplier * TIERS[next(i for i, t in enumerate(TIERS) if t['name'] == referrer.tier)]['referralReward'])
                check_tier_upgrade(referrer)
                db.session.commit()
        
        # Reset daily tasks if needed
        reset_daily_tasks(user)
        
        # Attach user to request
        request.user = user
        return f(*args, **kwargs)
    return decorated_function

# API Endpoints
@app.route('/api/user', methods=['GET'])
@telegram_auth_required
def get_user():
    """Get user data"""
    return jsonify(request.user.to_dict())

@app.route('/api/user', methods=['POST'])
@telegram_auth_required
def update_user():
    """Update user data"""
    user = request.user
    data = request.json
    
    # Update wallet address
    if 'wallet_address' in data:
        user.wallet_address = data['wallet_address']
    
    db.session.commit()
    return jsonify(user.to_dict())

@app.route('/api/complete-task', methods=['POST'])
@telegram_auth_required
def complete_task():
    """Complete a task and award points"""
    user = request.user
    data = request.json
    task_type = data.get('type')
    points = 0
    
    # Handle different task types
    if task_type == 'ad_watch':
        current_tier = next(t for t in TIERS if t['name'] == user.tier)
        points = int(current_tier['adReward'] * user.multiplier)
        user.points += points
        user.ad_count += 1
        user.last_ad_watch = datetime.utcnow()
        
    elif task_type == 'premium_ad':
        if user.premium_ad_count >= 1:
            return jsonify({'error': 'Premium ad limit reached'}), 400
        points = int(1000 * user.multiplier)
        user.points += points
        user.premium_ad_count += 1
        user.last_premium_ad = datetime.utcnow()
        
    elif task_type == 'website_visit':
        # Check if already completed today
        if user.last_website_visit and (datetime.utcnow() - user.last_website_visit).days < 1:
            return jsonify({'error': 'Task already completed today'}), 400
        points = int(500 * user.multiplier)
        user.points += points
        user.last_website_visit = datetime.utcnow()
        
    elif task_type == 'youtube_watch':
        # Check if already completed today
        if user.last_youtube_watch and (datetime.utcnow() - user.last_youtube_watch).days < 1:
            return jsonify({'error': 'Task already completed today'}), 400
        points = int(2000 * user.multiplier)
        user.points += points
        user.last_youtube_watch = datetime.utcnow()
        
    elif task_type == 'social':
        platform = data.get('platform')
        if not platform:
            return jsonify({'error': 'Platform not specified'}), 400
            
        # Check if already completed
        if getattr(user, f'{platform}_completed', False):
            return jsonify({'error': 'Task already completed'}), 400
            
        # Mark as completed and award
        setattr(user, f'{platform}_completed', True)
        user.social_dollars += 50
        points = 50  # Dollars, not points
        
    else:
        return jsonify({'error': 'Invalid task type'}), 400
    
    db.session.commit()
    return jsonify({'success': True, 'points_awarded': points, 'user': user.to_dict()})

@app.route('/api/redeem-bonus', methods=['POST'])
@telegram_auth_required
def redeem_bonus():
    """Redeem a bonus code"""
    user = request.user
    data = request.json
    code = data.get('code', '').strip().upper()
    
    if not code:
        return jsonify({'error': 'Code is required'}), 400
        
    bonus = BONUS_CODES.get(code)
    if not bonus:
        return jsonify({'error': 'Invalid bonus code'}), 400
        
    # Check if already used
    today = datetime.utcnow().date().isoformat()
    if bonus['daily']:
        if user.used_bonus_codes.get(code) == today:
            return jsonify({'error': 'Code already used today'}), 400
    else:
        if code in user.used_bonus_codes:
            return jsonify({'error': 'Code already used'}), 400
            
    # Apply bonus
    points_awarded = 0
    dollars_awarded = 0
    
    if bonus['points'] > 0:
        user.points += bonus['points']
        points_awarded = bonus['points']
        
    if bonus['dollars'] > 0:
        user.social_dollars += bonus['dollars']
        dollars_awarded = bonus['dollars']
        
    # Record usage
    user.used_bonus_codes[code] = today if bonus['daily'] else True
    
    db.session.commit()
    return jsonify({
        'success': True,
        'points_awarded': points_awarded,
        'dollars_awarded': dollars_awarded,
        'user': user.to_dict()
    })

@app.route('/api/withdraw', methods=['POST'])
@telegram_auth_required
def withdraw():
    """Request a withdrawal"""
    user = request.user
    data = request.json
    
    # Validate withdrawal amount
    total_balance = (user.points / 100000) + user.social_dollars
    if total_balance < 1000:
        return jsonify({'error': 'Minimum withdrawal is $1000'}), 400
        
    if not user.wallet_address:
        return jsonify({'error': 'Wallet address not set'}), 400
        
    # Send notification to admin
    message = (
        f" New Withdrawal Request!\n\n"
        f" User: {user.first_name} {user.last_name} (@{user.username})\n"
        f" ID: {user.telegram_id}\n"
        f" Amount: ${total_balance:.2f}\n"
        f" Wallet: {user.wallet_address}\n"
        f" Referral Code: {user.referral_code}"
    )
    
    send_telegram_message(ADMIN_CHAT_ID, message)
    
    # Reset user balance
    user.points = 0
    user.social_dollars = 0
    db.session.commit()
    
    return jsonify({'success': True, 'message': 'Withdrawal requested. Admin will contact you soon.'})

@app.route('/api/send-message', methods=['POST'])
def send_admin_message():
    """Endpoint for users to send messages to admin"""
    data = request.json
    user_id = data.get('user_id')
    message = data.get('message')
    
    if not user_id or not message:
        return jsonify({'error': 'Missing parameters'}), 400
        
    # Forward message to admin
    full_message = f" New Message from User {user_id}:\n\n{message}"
    send_telegram_message(ADMIN_CHAT_ID, full_message)
    
    return jsonify({'success': True})

def send_telegram_message(chat_id, text):
    """Send message via Telegram Bot"""
    url = f"{API_URL}/sendMessage"
    payload = {
        'chat_id': chat_id,
        'text': text,
        'parse_mode': 'HTML'
    }
    requests.post(url, json=payload)

# Telegram Webhook
@app.route('/telegram-webhook', methods=['POST'])
def telegram_webhook():
    """Handle Telegram bot updates"""
    update = request.json
    message = update.get('message', {})
    chat_id = message.get('chat', {}).get('id')
    text = message.get('text', '').strip()
    
    if text.startswith('/start'):
        # Extract referral code
        ref_code = None
        if len(text.split()) > 1:
            ref_code = text.split()[1]
        
        # Create deep link
        deep_link = f"https://t.me/YzemanBot?start=ref-{ref_code}" if ref_code else "https://t.me/YzemanBot"
        
        # Send welcome message with web app button
        keyboard = {
            "inline_keyboard": [[
                {
                    "text": "Open Reward Center",
                    "web_app": {"url": f"https://your-frontend-url.com?ref={ref_code}"}
                }
            ]]
        }
        
        send_telegram_message(
            chat_id,
            " Welcome to YzemanBot! Click below to start earning rewards:",
            reply_markup=keyboard
        )
    
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))