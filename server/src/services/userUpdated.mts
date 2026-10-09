import { getIo } from '../io-registry.mts';
import { pool } from '../db/pool.mts';
import { logger } from '../utils/logger.mts';

/**
 * ★ #534 表示名・アイコンが変わったことを、その人が入っている部屋と本人の全端末に知らせる。
 *   以前は本体の socket が持つ名前を書き換えるだけで (#498)、相手の画面では 1 対 1 の一覧・見出し・
 *   メンバー一覧・過去の吹き出しが、読み込み直すまで古い名前のままだった (新しい投稿だけ新しい名前)
 * ★ 中身は ID・表示名・アイコンだけ (どれも部屋の中で見えている情報)。部屋を共有していない人には送らない
 * ★ 知らせられなくても更新そのものは成立済みなので、warn だけ
 */
export async function announceUserUpdated(user: { id: string; display_name: string; avatar_url: string | null }): Promise<void> {
  try {
    const { rows } = await pool.query<{ room_id: string }>('SELECT room_id FROM room_members WHERE user_id = $1', [user.id]);
    getIo().to([...rows.map((r) => r.room_id), `user:${user.id}`])
      .emit('user:updated', { user_id: user.id, display_name: user.display_name, avatar_url: user.avatar_url ?? null });
  } catch (err) {
    logger.warn(`[profile] 名前の変更を知らせられませんでした: ${err instanceof Error ? err.message : String(err)}`);
  }
}
