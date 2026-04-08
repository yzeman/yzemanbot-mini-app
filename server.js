// ============ WITHDRAWAL API ENDPOINT (ADDED) ============
app.post('/api/withdraw', verifyTelegramData, async (req, res) => {
  const client = await pool.connect();
  try {
    const { amount, walletAddress } = req.body;
    const telegramId = req.telegramUser.id;
    
    const userResult = await client.query(
      'SELECT id, points FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    const pointsNeeded = amount * 100000;
    
    if (user.points < pointsNeeded) {
      return res.status(400).json({ error: 'Insufficient points' });
    }
    
    await client.query('BEGIN');
    
    await client.query(
      'UPDATE users SET points = points - $1 WHERE id = $2',
      [pointsNeeded, user.id]
    );
    
    await client.query(
      `INSERT INTO withdrawals (user_id, amount, wallet_address, status) 
       VALUES ($1, $2, $3, 'pending')`,
      [user.id, amount, walletAddress]
    );
    
    await client.query('COMMIT');
    res.json({ success: true, message: 'Withdrawal request submitted' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Withdrawal Error:', err);
    res.status(500).json({ error: 'Failed to process withdrawal' });
  } finally {
    client.release();
  }
});
