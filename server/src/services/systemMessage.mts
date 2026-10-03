import type { Server } from 'socket.io';
import { pool } from '../db/pool.mts';
import { announcePost, SYSTEM_MESSAGE_EFFECTS } from './postEffects.mts';

/**
 * ルームに system メッセージを 1 件入れて配信する。
 *
 * 元は `routes/members.mts` の private helper だった (#390 で共有化)。
 * bot の join だけが「入ったことがルームに出ない」経路になっていたので、
 * 人間側の招待と同じ見え方に揃えるために切り出した。**文面と挙動は元のまま。**
 *
 * ★ sender_id は**本文の主語になる本人** (操作した人 / 入ったボット) を渡す (2026-10-03)。
 *   以前は部屋の誰か 1 人を借りていて、本番の 377 件のうち 127 件が本文に出てこない人の名前で残り、
 *   MCP・検索では「借りられた人がやった」と読めた。表示名は配信時に「システム」で上書きされる。
 */
export async function insertSystemMessage(
  roomId: string,
  content: string,
  io: Server | undefined,
  senderId: string
): Promise<void> {
  // ★ 部屋に誰もいなければ入れない (2026-10-01)。最後の 1 人の退会のあとは誰も見ないので、入れないことで失うものは無い。
  //   ★ 送り主は部屋のメンバーでなくてよい (退会した本人が「退会しました」の主語になる)
  const result = await pool.query(
    `INSERT INTO messages (room_id, sender_id, content, type)
     SELECT $1, $3, $2, 'system'
     WHERE EXISTS (SELECT 1 FROM room_members WHERE room_id = $1)
     RETURNING *`,
    [roomId, content, senderId]
  );
  if (result.rows.length === 0) return;

  // ★ 付随処理は announcePost から (docs/07 §5.1、#12 #12')。io を渡さなければ配信しない (移す前と同じ)
  if (io) {
    await announcePost({
      roomId,
      emit: { ...result.rows[0], sender_display_name: 'システム' },
      ...SYSTEM_MESSAGE_EFFECTS,
    });
  }
}
