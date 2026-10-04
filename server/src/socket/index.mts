import jwt from 'jsonwebtoken';
import type { Server } from 'socket.io';
import { logger } from '../utils/logger.mts';
import { pool } from '../db/pool.mts';
import { JWT_SECRET } from '../middleware/auth.mts';
import { isAdmin } from '../utils/permissions.mts';
import { registerMessageHandler } from './handlers/message.mts';
import { registerReadHandler } from './handlers/read.mts';
import { registerTypingHandler } from './handlers/typing.mts';
import { registerCallHandler } from './handlers/call.mts';
import { setViewing, removeSocket } from './viewingRooms.mts';
import type { SocketUser } from '../types.mts';

// Online users: userId -> Set of socketIds
const onlineUsers = new Map<string, Set<string>>();

// UUID validation (= 6/9 DoS crash fix、client から non-UUID で room:join 送られて
// pool.query が Postgres 22P02 throw → unhandledRejection で process exit していた)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ★ #498 つながっている socket が持つ利用者の表示名・アイコンを書き換える。
 *   socket はつながったときに読んだ値を持ち続けるので、プロフィールを変えても
 *   読み込み直すまで古い名前で投稿が配られていた (入力中の表示なども同じ値を使う)
 */
export function refreshSocketUser(io: Server, userId: string, patch: Partial<Pick<SocketUser, 'display_name' | 'avatar_url'>>): void {
  for (const s of io.of('/').sockets.values()) {
    if (s.user?.id === userId) Object.assign(s.user, patch);
  }
}

export function getOnlineUserIds(): string[] {
  return Array.from(onlineUsers.keys());
}

export function setupSocketHandlers(io: Server): void {
  // Authentication middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('認証トークンがありません'));
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
      const result = await pool.query<SocketUser>(
        'SELECT id, login_id, display_name, avatar_url, role FROM users WHERE id = $1 AND is_active = true',
        [decoded.id]
      );
      if (result.rows.length === 0) {
        return next(new Error('ユーザーが見つかりません'));
      }
      socket.user = result.rows[0];
      next();
    } catch {
      next(new Error('トークンが無効です'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.user.display_name} (${socket.id})`);

    const userId = socket.user.id;

    // Join user-specific room (for targeted events like stamp generation)
    socket.join(`user:${userId}`);

    // Admin: join all rooms for dashboard monitoring
    if (isAdmin(socket.user)) {
      pool.query<{ id: string }>('SELECT id FROM rooms').then(result => {
        for (const r of result.rows) {
          socket.join(r.id);
        }
        logger.info(`Admin ${socket.user.display_name} joined all ${result.rows.length} rooms for monitoring`);
      }).catch(() => {});
    }

    // Track online status
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
      socket.broadcast.emit('user:online', { user_id: userId });
    }
    onlineUsers.get(userId)!.add(socket.id);

    // Room join/leave
    socket.on('room:join', async (roomId: unknown) => {
      // 6/9 DoS crash fix: 非 UUID は早期 reject (= Postgres 22P02 throw 防止)
      if (typeof roomId !== 'string' || !UUID_REGEX.test(roomId)) {
        logger.debug(`room:join reject: invalid uuid '${roomId}' from user=${socket.user.display_name}`);
        return;
      }
      try {
        const result = await pool.query(
          'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
          [roomId, socket.user.id]
        );
        if (result.rows.length > 0) {
          socket.join(roomId);
          logger.debug(`room:join user=${socket.user.display_name} room=${roomId}`);
        }
      } catch (err) {
        // 6/9 DoS crash fix: async handler 内 throw を catch (= 個別 safety net、global は app.mts)
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`room:join error user=${socket.user.display_name} room=${roomId}: ${message}`);
      }
    });

    socket.on('room:leave', (roomId: unknown) => {
      // 6/9 DoS crash fix: 非 UUID は silent skip (= socket.leave は throw しないが念のため early return)
      if (typeof roomId !== 'string' || !UUID_REGEX.test(roomId)) return;
      socket.leave(roomId);
    });

    // #475 その部屋を開いていて画面が見えている間だけ viewing: true が届く。通知の送り先から外すのに使う
    // ★ 影響するのは自分への通知だけなので、メンバーかどうかは確かめない (形だけ確かめる)
    socket.on('room:viewing', (data: unknown) => {
      const d = data as { room_id?: unknown; viewing?: unknown } | null;
      if (!d || typeof d.room_id !== 'string' || !UUID_REGEX.test(d.room_id) || typeof d.viewing !== 'boolean') return;
      setViewing(socket.id, userId, d.room_id, d.viewing);
    });

    // Register handlers
    registerMessageHandler(socket, io);
    registerReadHandler(socket);
    registerTypingHandler(socket);
    registerCallHandler(socket, io);

    // Disconnect
    socket.on('disconnect', () => {
      logger.info(`Client disconnected: ${socket.user.display_name} (${socket.id})`);
      removeSocket(socket.id);   // #475 見ていた部屋も消す

      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          socket.broadcast.emit('user:offline', { user_id: userId });
        }
      }
    });
  });
}
