const logger = require('../../utils/logger');
const pool = require('../../db/pool');
const { sendPushToUser } = require('../../services/push');
const capabilityWatcher = require('../../services/capabilityWatcher');

/**
 * Handle call events (notification + history + status)
 * mediasoup signaling is handled by rtc-server independently.
 *
 * 通話状態:
 *   なし → 待機中（1人）→ 通話中（2人以上）→ なし（全員退出）
 *
 * メッセージ:
 *   開始時に1通、終了時に1通のみ
 */

// 通話中ルームの管理: roomId -> { participants: Set<userId>, startedBy }
const activeCalls = new Map();

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

function broadcastCallStatus(roomId, io) {
  const call = activeCalls.get(roomId);
  if (!call) {
    io.to(roomId).emit('call:status', { roomId, active: false, count: 0 });
  } else {
    io.to(roomId).emit('call:status', {
      roomId,
      active: true,
      count: call.participants.size,
      // 1人=待機中、2人以上=通話中
      state: call.participants.size >= 2 ? 'active' : 'waiting',
    });
  }
}

function registerCallHandler(socket, io) {
  // 通話開始 or 途中参加
  socket.on('call:start', async ({ roomId }) => {
    logger.debug(`call:start user=${socket.user.id} room=${roomId}`);

    // Defense: rtc-server 不可時は reject (古い client / race condition 保護)
    if (!capabilityWatcher.getState()) {
      logger.info(`call:start rejected: realtime voice unavailable (user=${socket.user.id} room=${roomId})`);
      socket.emit('call:rejected', {
        roomId,
        userName: 'システム',
        reason: 'realtime_voice_unavailable',
        message: '通話機能は現在利用できません (rtc-server 未起動)',
      });
      return;
    }

    try {
      const existing = activeCalls.get(roomId);

      if (existing) {
        // 既に通話中 → 着信通知なし、そのまま参加
        existing.participants.add(socket.user.id);
        broadcastCallStatus(roomId, io);
        return;
      }

      // 新規通話開始
      activeCalls.set(roomId, {
        participants: new Set([socket.user.id]),
        startedBy: socket.user.id,
      });

      // DM の場合のみ着信モーダルを送る。グループはステータス表示のみ
      const roomResult = await pool.query('SELECT type FROM rooms WHERE id = $1', [roomId]);
      const roomType = roomResult.rows[0]?.type;

      if (roomType === 'direct') {
        const result = await pool.query(
          'SELECT user_id FROM room_members WHERE room_id = $1 AND user_id != $2',
          [roomId, socket.user.id]
        );
        const { getOnlineUserIds } = require('../index');
        const onlineUserIds = new Set(getOnlineUserIds());
        for (const row of result.rows) {
          io.to(`user:${row.user_id}`).emit('call:incoming', {
            roomId,
            callerId: socket.user.id,
            callerName: socket.user.display_name,
          });
          // オフラインならプッシュ通知
          if (!onlineUserIds.has(row.user_id)) {
            sendPushToUser(row.user_id, {
              title: '📞 着信',
              body: `${socket.user.display_name} からの通話`,
              data: { roomId, type: 'call' },
            });
          }
        }
      }

      // 開始メッセージ（1通のみ）
      await insertCallMessage(roomId, socket.user.id, `📞 ${socket.user.display_name} が通話を開始しました`, io);
      broadcastCallStatus(roomId, io);
    } catch (err) {
      console.error('call:start error:', err);
    }
  });

  // 通話拒否 → 発信者に通知
  socket.on('call:reject', ({ roomId, callerId }) => {
    logger.debug(`call:reject user=${socket.user.id} room=${roomId} caller=${callerId}`);
    io.to(`user:${callerId}`).emit('call:rejected', {
      roomId,
      userId: socket.user.id,
      userName: socket.user.display_name,
    });
  });

  // 通話終了（個人の退出）
  socket.on('call:end', async ({ roomId }) => {
    logger.debug(`call:end user=${socket.user.id} room=${roomId}`);
    try {
      const call = activeCalls.get(roomId);
      if (call) {
        call.participants.delete(socket.user.id);

        if (call.participants.size === 0) {
          // 最後の人が退出 → 通話終了
          activeCalls.delete(roomId);
          await insertCallMessage(roomId, socket.user.id, `📞 通話が終了しました`, io);
        }
        broadcastCallStatus(roomId, io);
      }

      // 他メンバーに退出を通知（着信モーダルのクリア用）
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
    } catch (err) {
      console.error('call:end error:', err);
    }
  });

  // ルームの通話状態を問い合わせ
  socket.on('call:getStatus', ({ roomId }) => {
    const call = activeCalls.get(roomId);
    socket.emit('call:status', {
      roomId,
      active: !!call,
      count: call ? call.participants.size : 0,
      state: call ? (call.participants.size >= 2 ? 'active' : 'waiting') : null,
    });
  });
}

module.exports = { registerCallHandler, activeCalls };
