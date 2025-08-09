bot.onText(/\/start ref-(.+)/, async (msg, match) => {
  try {
    const chatId = msg.chat.id;
    const referralCode = match[1];
    
    const response = await fetch(`${process.env.BACKEND_URL}/api/referral`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        referrerId: await getUserIdFromCode(referralCode),
        referredId: msg.from.id
      })
    });
    
    if (!response.ok) throw new Error('Failed to register referral');
    
    bot.sendMessage(chatId, '✅ Referral registered successfully!');
  } catch (error) {
    bot.sendMessage(chatId, '⚠️ Failed to register referral. Please try again.');
    console.error('Referral error:', error);
  }
});