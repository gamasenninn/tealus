const pool = require('../../db/pool');

/**
 * Handle call events (notification + history)
 * mediasoup signaling is handled by rtc-server independently.
 *
 * socket.to(roomId) ではなく user:${userId} ルームに送信する。
 * これにより、相手がどの画面にいても着信通知が届く。
 */

async function insertCallMessage(roomId, senderId, content, io) {
  try {
    const result = await pool.query(
      `INSERT INTO messages (room_id, sender_id, content, type)
       VALUES ($1, $2, $3, 'system') RETURNING *`,
      [roomId, senderId, content]
    );
    const msg = result.rows[0];
    io.to(roomId).emit('message:new', msg);
  } catch (err) {
    console.error('insertCallMessage error:', err);
  }
}

function registerCallHandler(socket, io) {
  // 通話開始 → ルームメンバー全員に着信通知 + 履歴記録
  socket.on('call:start', async ({ roomId }) => {
    try {
      const result = await pool.query(
        'SELECT user_id FROM room_members WHERE room_id = $1 AND user_id != $2',
        [roomId, socket.user.id]
      );
      for (const row of result.rows) {
        io.to(`user:${row.user_id}`).emit('call:incoming', {
          roomId,
          callerId: socket.user.id,
          callerName: socket.user.display_name,
        });
      }
      // 通話履歴
      await insertCallMessage(roomId, socket.user.id, `📞 ${socket.user.display_name} が通話を開始しました`, io);
    } catch (err) {
      console.error('call:start error:', err);
    }
  });

  // 通話拒否 → 発信者に通知
  socket.on('call:reject', ({ roomId, callerId }) => {
    io.to(`user:${callerId}`).emit('call:rejected', {
      roomId,
      userId: socket.user.id,
      userName: socket.user.display_name,
    });
  });

  // 通話終了 → ルームメンバー全員に通知 + 履歴記録
  socket.on('call:end', async ({ roomId }) => {
    try {
      const result = await pool.query(
        'SELECT user_id FROM room_members WHERE room_id = $1 AND user_id != $2',
        [roomId, socket.user.id]
      );
      for (const row of result.rows) {
        io.to(`user:${row.user_id}`).emit('call:ended', {
          roomId,
          userId: socket.user.id,
        });
      }
      // 通話履歴
      await insertCallMessage(roomId, socket.user.id, `📞 通話が終了しました`, io);
    } catch (err) {
      console.error('call:end error:', err);
    }
  });
}

module.exports = { registerCallHandler };
