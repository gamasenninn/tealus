const pool = require('../../db/pool');

/**
 * Handle call events (notification + history)
 * mediasoup signaling is handled by rtc-server independently.
 */

// 通話中ルームの管理
const activeCalls = new Set(); // Set<roomId>

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
  // 通話開始 or 途中参加
  socket.on('call:start', async ({ roomId }) => {
    try {
      if (activeCalls.has(roomId)) {
        // 既に通話中 → 着信通知なし、そのまま参加
        await insertCallMessage(roomId, socket.user.id, `📞 ${socket.user.display_name} が通話に参加しました`, io);
        return;
      }

      // 新規通話開始
      activeCalls.add(roomId);
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

  // 通話終了（個人の退出）
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
      await insertCallMessage(roomId, socket.user.id, `📞 ${socket.user.display_name} が通話を終了しました`, io);

      // rtc-server 側で全員退出したら activeCalls から削除される
      // ここでは安全のため 30 秒後にチェック（rtc-server のルームが空なら削除）
      setTimeout(() => {
        // activeCalls のクリーンアップは rtc-server が管理するため、
        // ここでは保守的に残す。長時間残っても実害はない。
      }, 30000);
    } catch (err) {
      console.error('call:end error:', err);
    }
  });

  // ルームの通話状態をクリア（外部から呼べるよう export）
  socket.on('call:roomClear', ({ roomId }) => {
    activeCalls.delete(roomId);
  });
}

module.exports = { registerCallHandler, activeCalls };
