import os
import logging
from datetime import datetime
from typing import Dict, Optional

from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from telegram import Update, Bot, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    filters,
    ContextTypes,
)

# Configuration - Get from Render environment variables
BOT_TOKEN = os.getenv("BOT_TOKEN")
ADMIN_CHAT_ID = int(os.getenv("ADMIN_CHAT_ID"))
RENDER_EXTERNAL_URL = os.getenv("RENDER_EXTERNAL_URL")  # Provided by Render
WEBHOOK_URL = f"{RENDER_EXTERNAL_URL}/webhook"
POINTS_PER_DOLLAR = 100000  # 100,000 points = $1
MIN_WITHDRAWAL = 1000 * POINTS_PER_DOLLAR  # $1000 minimum withdrawal

# Initialize FastAPI
app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Database simulation (in production, use a real database)
users_db: Dict[int, Dict] = {}
referral_codes: Dict[str, int] = {}  # code -> user_id
withdrawal_requests = []

# Models
class UserData(BaseModel):
    user_id: int
    points: int = 0
    referrals: int = 0
    tier: str = "Fresher"
    wallet_address: Optional[str] = None
    completed_tasks: Dict[str, bool] = {}
    used_bonus_codes: Dict[str, str] = {}

class WithdrawalRequest(BaseModel):
    user_id: int
    amount: float  # in dollars
    wallet_address: str
    status: str = "pending"

# Helper functions
def calculate_tier(referrals: int) -> str:
    if referrals >= 500:
        return "Platinum"
    elif referrals >= 300:
        return "Gold"
    elif referrals >= 150:
        return "Silver"
    elif referrals >= 50:
        return "Brute"
    return "Fresher"

def get_referral_reward(tier: str) -> int:
    return {
        "Fresher": 1000,
        "Brute": 1500,
        "Silver": 2000,
        "Gold": 3000,
        "Platinum": 5000
    }.get(tier, 1000)

def generate_referral_code(user_id: int) -> str:
    code = f"YZEMAN-{user_id:06X}"[:12]
    referral_codes[code] = user_id
    return code

# Initialize bot application
application = Application.builder().token(BOT_TOKEN).build()

# Telegram Bot Handlers
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    user_id = user.id
    
    # Check if user exists
    if user_id not in users_db:
        # Check for referral code
        ref_code = None
        if context.args and context.args[0].startswith('ref-'):
            ref_code = context.args[0][4:]
        
        # Create new user
        users_db[user_id] = {
            "user_id": user_id,
            "username": user.username,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "points": 0,
            "referrals": 0,
            "tier": "Fresher",
            "wallet_address": None,
            "referral_code": generate_referral_code(user_id),
            "completed_tasks": {},
            "used_bonus_codes": {},
            "join_date": datetime.now().isoformat(),
            "multiplier": 1.0
        }
        
        # Process referral if exists
        if ref_code and ref_code in referral_codes:
            referrer_id = referral_codes[ref_code]
            if referrer_id in users_db:
                referrer = users_db[referrer_id]
                reward = get_referral_reward(referrer["tier"])
                referrer["points"] += reward
                referrer["referrals"] += 1
                referrer["tier"] = calculate_tier(referrer["referrals"])
                referrer["multiplier"] = {
                    "Fresher": 1.0,
                    "Brute": 1.2,
                    "Silver": 1.5,
                    "Gold": 2.0,
                    "Platinum": 3.0
                }.get(referrer["tier"], 1.0)
                
                # Notify referrer
                bot = context.bot
                try:
                    await bot.send_message(
                        chat_id=referrer_id,
                        text=f"🎉 You got +{reward} points! {user.first_name} joined using your referral link."
                    )
                except Exception as e:
                    logging.error(f"Failed to notify referrer: {e}")
    
    # Send welcome message
    user_data = users_db[user_id]
    welcome_text = (
        f"👋 Welcome to YzemanBot, {user.first_name}!\n\n"
        f"💰 Your balance: {user_data['points']} points (${user_data['points'] / POINTS_PER_DOLLAR:.2f})\n"
        f"📊 Your tier: {user_data['tier']}\n"
        f"👥 Referrals: {user_data['referrals']}\n\n"
        "Use /earn to start earning points!"
    )
    
    keyboard = [
        [InlineKeyboardButton("💰 Earn Points", callback_data="earn")],
        [InlineKeyboardButton("👥 Refer Friends", callback_data="refer")],
        [InlineKeyboardButton("💸 Withdraw", callback_data="withdraw")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await update.message.reply_text(welcome_text, reply_markup=reply_markup)

async def earn_points(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    
    user_id = query.from_user.id
    if user_id not in users_db:
        await query.edit_message_text("Please start the bot with /start first")
        return
    
    user_data = users_db[user_id]
    
    # Create a deep link to the web app
    web_app_url = f"{RENDER_EXTERNAL_URL}?startapp=yzeman_{user_id}"
    
    text = (
        f"🎯 Earn Points Menu\n\n"
        f"💰 Your balance: {user_data['points']} points (${user_data['points'] / POINTS_PER_DOLLAR:.2f})\n"
        f"📊 Your tier: {user_data['tier']} ({user_data['multiplier']:.1f}x multiplier)\n\n"
        "Click the button below to open the earning dashboard:"
    )
    
    keyboard = [
        [InlineKeyboardButton("Open Earning Dashboard", web_app=WebAppInfo(url=web_app_url))],
        [InlineKeyboardButton("🔙 Back", callback_data="main_menu")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await query.edit_message_text(text, reply_markup=reply_markup)

async def refer_friends(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    
    user_id = query.from_user.id
    if user_id not in users_db:
        await query.edit_message_text("Please start the bot with /start first")
        return
    
    user_data = users_db[user_id]
    
    text = (
        f"👥 Refer Friends\n\n"
        f"Your current tier: {user_data['tier']}\n"
        f"Referrals: {user_data['referrals']}\n"
        f"Points per referral: {get_referral_reward(user_data['tier'])}\n\n"
        f"Share your referral link:\n"
        f"https://t.me/YzemanBot?start=ref-{user_data['referral_code']}\n\n"
        "When someone joins using your link, you'll earn points!"
    )
    
    keyboard = [
        [InlineKeyboardButton("📋 Copy Referral Link", callback_data="copy_ref")],
        [InlineKeyboardButton("🔙 Back", callback_data="main_menu")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await query.edit_message_text(text, reply_markup=reply_markup)

async def withdraw(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    
    user_id = query.from_user.id
    if user_id not in users_db:
        await query.edit_message_text("Please start the bot with /start first")
        return
    
    user_data = users_db[user_id]
    balance = user_data["points"] / POINTS_PER_DOLLAR
    
    if balance < MIN_WITHDRAWAL / POINTS_PER_DOLLAR:
        text = (
            f"🚫 Withdrawal Minimum Not Met\n\n"
            f"Your balance: ${balance:.2f}\n"
            f"Minimum withdrawal: ${MIN_WITHDRAWAL / POINTS_PER_DOLLAR:.2f}\n\n"
            "Keep earning to reach the minimum!"
        )
        
        keyboard = [
            [InlineKeyboardButton("💰 Earn More", callback_data="earn")],
            [InlineKeyboardButton("🔙 Back", callback_data="main_menu")]
        ]
    else:
        text = (
            f"💸 Withdraw Funds\n\n"
            f"Available: ${balance:.2f}\n"
            f"Minimum: ${MIN_WITHDRAWAL / POINTS_PER_DOLLAR:.2f}\n\n"
            "Please enter your USDT (TRC-20) wallet address:"
        )
        
        keyboard = [
            [InlineKeyboardButton("🔙 Back", callback_data="main_menu")]
        ]
    
    reply_markup = InlineKeyboardMarkup(keyboard)
    await query.edit_message_text(text, reply_markup=reply_markup)

async def handle_wallet_address(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user_id = update.message.from_user.id
    wallet_address = update.message.text.strip()
    
    if user_id not in users_db:
        await update.message.reply_text("Please start the bot with /start first")
        return
    
    if len(wallet_address) < 20:  # Basic validation
        await update.message.reply_text("Please enter a valid USDT (TRC-20) wallet address")
        return
    
    users_db[user_id]["wallet_address"] = wallet_address
    
    # Create withdrawal request
    user_data = users_db[user_id]
    amount = user_data["points"] / POINTS_PER_DOLLAR
    withdrawal_requests.append({
        "user_id": user_id,
        "amount": amount,
        "wallet_address": wallet_address,
        "status": "pending",
        "timestamp": datetime.now().isoformat()
    })
    
    # Reset user's points
    users_db[user_id]["points"] = 0
    
    # Notify admin
    bot = context.bot
    admin_text = (
        "🔄 New Withdrawal Request\n\n"
        f"User: {user_data['first_name']} (@{user_data.get('username', 'N/A')})\n"
        f"Amount: ${amount:.2f}\n"
        f"Wallet: {wallet_address}\n\n"
        "Please process this withdrawal."
    )
    await bot.send_message(chat_id=ADMIN_CHAT_ID, text=admin_text)
    
    # Notify user
    await update.message.reply_text(
        "✅ Withdrawal request submitted!\n\n"
        "Admin will contact you soon to complete the process."
    )

async def main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    
    user = query.from_user
    user_id = user.id
    
    if user_id not in users_db:
        await query.edit_message_text("Please start the bot with /start first")
        return
    
    user_data = users_db[user_id]
    welcome_text = (
        f"👋 Welcome back, {user.first_name}!\n\n"
        f"💰 Your balance: {user_data['points']} points (${user_data['points'] / POINTS_PER_DOLLAR:.2f})\n"
        f"📊 Your tier: {user_data['tier']}\n"
        f"👥 Referrals: {user_data['referrals']}\n\n"
        "What would you like to do?"
    )
    
    keyboard = [
        [InlineKeyboardButton("💰 Earn Points", callback_data="earn")],
        [InlineKeyboardButton("👥 Refer Friends", callback_data="refer")],
        [InlineKeyboardButton("💸 Withdraw", callback_data="withdraw")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await query.edit_message_text(welcome_text, reply_markup=reply_markup)

# FastAPI Endpoints
@app.post("/webhook")
async def telegram_webhook(update: dict):
    """Handle Telegram webhook updates"""
    # Register handlers
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CallbackQueryHandler(earn_points, pattern="^earn$"))
    application.add_handler(CallbackQueryHandler(refer_friends, pattern="^refer$"))
    application.add_handler(CallbackQueryHandler(withdraw, pattern="^withdraw$"))
    application.add_handler(CallbackQueryHandler(main_menu, pattern="^main_menu$"))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_wallet_address))
    
    # Process update
    update_obj = Update.de_json(update, application.bot)
    await application.process_update(update_obj)
    
    return {"status": "ok"}

@app.get("/api/user/{user_id}")
async def get_user_data(user_id: int):
    """Get user data for the web app"""
    if user_id not in users_db:
        raise HTTPException(status_code=404, detail="User not found")
    
    user_data = users_db[user_id]
    return {
        "user_id": user_data["user_id"],
        "username": user_data.get("username"),
        "first_name": user_data["first_name"],
        "last_name": user_data.get("last_name"),
        "points": user_data["points"],
        "referrals": user_data["referrals"],
        "tier": user_data["tier"],
        "wallet_address": user_data.get("wallet_address"),
        "referral_code": user_data.get("referral_code", ""),
        "multiplier": user_data.get("multiplier", 1.0),
        "completed_tasks": user_data.get("completed_tasks", {}),
        "used_bonus_codes": user_data.get("used_bonus_codes", {})
    }

@app.post("/api/user/{user_id}/update")
async def update_user_data(user_id: int, data: dict):
    """Update user data from the web app"""
    if user_id not in users_db:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Update points
    if "points" in data:
        users_db[user_id]["points"] = data["points"]
    
    # Update completed tasks
    if "completed_tasks" in data:
        users_db[user_id]["completed_tasks"] = data["completed_tasks"]
    
    # Update used bonus codes
    if "used_bonus_codes" in data:
        users_db[user_id]["used_bonus_codes"] = data["used_bonus_codes"]
    
    # Update tier if referrals changed
    if "referrals" in data:
        users_db[user_id]["referrals"] = data["referrals"]
        users_db[user_id]["tier"] = calculate_tier(data["referrals"])
        users_db[user_id]["multiplier"] = {
            "Fresher": 1.0,
            "Brute": 1.2,
            "Silver": 1.5,
            "Gold": 2.0,
            "Platinum": 3.0
        }.get(users_db[user_id]["tier"], 1.0)
    
    return {"status": "success"}

@app.post("/api/user/{user_id}/withdraw")
async def create_withdrawal(user_id: int, request: Request):
    """Create a withdrawal request"""
    if user_id not in users_db:
        raise HTTPException(status_code=404, detail="User not found")
    
    data = await request.json()
    amount = data.get("amount")
    wallet_address = data.get("wallet_address")
    
    if not amount or not wallet_address:
        raise HTTPException(status_code=400, detail="Amount and wallet address are required")
    
    # Create withdrawal request
    withdrawal_requests.append({
        "user_id": user_id,
        "amount": amount,
        "wallet_address": wallet_address,
        "status": "pending",
        "timestamp": datetime.now().isoformat()
    })
    
    # Notify admin
    bot = Bot(token=BOT_TOKEN)
    user_data = users_db[user_id]
    admin_text = (
        "🔄 New Withdrawal Request\n\n"
        f"User: {user_data['first_name']} (@{user_data.get('username', 'N/A')})\n"
        f"Amount: ${amount:.2f}\n"
        f"Wallet: {wallet_address}\n\n"
        "Please process this withdrawal."
    )
    await bot.send_message(chat_id=ADMIN_CHAT_ID, text=admin_text)
    
    return {"status": "success"}

@app.get("/")
async def serve_index(request: Request):
    """Serve the index.html file"""
    return templates.TemplateResponse("index.html", {"request": request})

@app.on_event("startup")
async def on_startup():
    """Set up the Telegram bot with webhook on startup"""
    try:
        await application.initialize()
        await application.start()
        await application.bot.set_webhook(WEBHOOK_URL)
        logging.info(f"Webhook set to: {WEBHOOK_URL}")
    except Exception as e:
        logging.error(f"Failed to initialize bot: {e}")

@app.on_event("shutdown")
async def on_shutdown():
    """Clean up on shutdown"""
    await application.stop()
    await application.shutdown()

# For local development
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)