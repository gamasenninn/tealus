import type { Server } from 'socket.io';
import { pool } from '../db/pool.mts';
import { logger } from '../utils/logger.mts';
import { formatTranscription } from './formatting.mts';

type Formatter = (messageId: string, rawText: string, io: Server | null, roomId: string, version: number, messageType: string) => Promise<unknown>;

/**
 * #536 起動時に、整えている途中で止まった文字起こしを整え直す。
 *
 * ★ 整える処理 (formatting.mts) は status を formatting にしてから AI を呼ぶ。途中でプロセスが落ちると
 *   catch を通らず、画面は「AIが文章を整えています…」のまま止まった (2026-10-04、5 日間 1 件)。
 *   本体は 1 台・1 プロセスなので、起動した時点で formatting のまま残っているものは、すべて前のプロセスの取り残し
 * ★ 拾うのは「最新の版が formatting で、生の文字起こしがあり、投稿が消えていない」ものだけ。
 *   1 件ずつ順に (AI を一度に叩かない)。1 件が失敗しても残りは続け、起動は止めない
 * @returns 整え直しを試みた件数
 */
export async function recoverStuckFormatting(
  { format = formatTranscription as Formatter, io = null }: { format?: Formatter; io?: Server | null } = {},
): Promise<number> {
  const { rows } = await pool.query<{ message_id: string; raw_text: string; room_id: string; version: number; type: string }>(
    `SELECT vt.message_id, vt.raw_text, m.room_id, vt.version, m.type
       FROM voice_transcriptions vt
       JOIN messages m ON m.id = vt.message_id
      WHERE vt.status = 'formatting'
        AND vt.raw_text IS NOT NULL AND vt.raw_text <> ''
        AND m.is_deleted = false
        AND vt.version = (SELECT MAX(version) FROM voice_transcriptions x WHERE x.message_id = vt.message_id)
      ORDER BY vt.created_at`);
  if (rows.length > 0) logger.info(`[transcription-recovery] 整えている途中で止まった文字起こし ${rows.length} 件を整え直します`);
  for (const r of rows) {
    try {
      await format(r.message_id, r.raw_text, io, r.room_id, r.version, r.type);
    } catch (err) {
      logger.warn(`[transcription-recovery] 整え直しに失敗 message=${r.message_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return rows.length;
}
