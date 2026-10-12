import type { Server } from 'socket.io';
import { pool } from '../db/pool.mts';
import { logger } from '../utils/logger.mts';
import { formatTranscription } from './formatting.mts';

/**
 * ★ #585 受付を始めてからの経過 (ms)。SQL では DB 自身の now() から引いて「受付を始めた時刻」にする。
 *   Node の時刻をそのまま DB の created_at と比べると、2 つの時計のずれ (DB は Docker の中) で
 *   直前に作られた行が「後」に見える (テストで実際に落ちた)。経過の長さだけを渡せば、ずれに左右されない
 */
function elapsedMs(startedAt: Date): number {
  return Math.max(0, Date.now() - startedAt.getTime());
}

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
  { format = formatTranscription as Formatter, io = null, startedAt = new Date() }: { format?: Formatter; io?: Server | null; startedAt?: Date } = {},
): Promise<number> {
  const { rows } = await pool.query<{ message_id: string; raw_text: string; room_id: string; version: number; type: string }>(
    `SELECT vt.message_id, vt.raw_text, m.room_id, vt.version, m.type
       FROM voice_transcriptions vt
       JOIN messages m ON m.id = vt.message_id
      WHERE vt.status = 'formatting'
        AND vt.raw_text IS NOT NULL AND vt.raw_text <> ''
        AND m.is_deleted = false
        AND vt.version = (SELECT MAX(version) FROM voice_transcriptions x WHERE x.message_id = vt.message_id)
        AND vt.created_at < now() - ($1::double precision * interval '1 millisecond')
      ORDER BY vt.created_at`, [elapsedMs(startedAt)]);
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

type Transcriber = (messageId: string, filePath: string, options: { io?: Server | null; roomId?: string | null; version?: number; isVideo?: boolean; messageType?: string }) => Promise<unknown>;

/**
 * ★ #579 起動時に、音を文字にしている途中 (pending / transcribing) で止まったものをやり直す。
 *
 * ★ #536 (上) は formatting だけを拾っていた。投稿→生の文字起こしは p50 4.4 秒・p95 6.2 秒で、
 *   整える段 (約 2.5 秒) より長いのに拾われず、ここで落ちると「⏳ 文字起こし中...」のまま止まった。
 * ★ 本体は 1 台・1 プロセスなので、起動した時点で pending / transcribing のまま残っているものは前のプロセスの取り残し。
 *   拾うのは「最新の版がそれで、投稿が消えておらず、添付のファイルがある」もの。1 件ずつ順に、失敗しても続ける
 * ★ #585 拾うのは startedAt (= 受付を始めた時刻) より前に作られた行だけ。拾い直しは HTTP を受け付け始めた後に走るので、
 *   その後に届いた投稿 (自分で文字起こしを始める) まで拾うと、同じ版を 2 本が並走する。#536 の formatting も同じ
 * @returns やり直しを試みた件数
 */
export async function recoverStuckTranscribing(
  { transcribe, io = null, startedAt = new Date() }: { transcribe?: Transcriber; io?: Server | null; startedAt?: Date } = {},
): Promise<number> {
  const run: Transcriber = transcribe ?? (async (id, file, opts) => (await import('./transcription.mts')).transcribeMessage(id, file, opts));
  const { rows } = await pool.query<{ message_id: string; room_id: string; version: number; type: string; file_path: string }>(
    `SELECT vt.message_id, m.room_id, vt.version, m.type,
            (SELECT mm.file_path FROM message_media mm WHERE mm.message_id = m.id ORDER BY mm.created_at LIMIT 1) AS file_path
       FROM voice_transcriptions vt
       JOIN messages m ON m.id = vt.message_id
      WHERE vt.status IN ('pending', 'transcribing')
        AND m.is_deleted = false
        AND vt.version = (SELECT MAX(version) FROM voice_transcriptions x WHERE x.message_id = vt.message_id)
        AND EXISTS (SELECT 1 FROM message_media mm WHERE mm.message_id = m.id)
        AND vt.created_at < now() - ($1::double precision * interval '1 millisecond')
      ORDER BY vt.created_at`, [elapsedMs(startedAt)]);
  if (rows.length > 0) logger.info(`[transcription-recovery] 音を文字にしている途中で止まった ${rows.length} 件をやり直します`);
  for (const r of rows) {
    try {
      await run(r.message_id, r.file_path, { io, roomId: r.room_id, version: r.version, isVideo: r.type === 'video', messageType: r.type });
    } catch (err) {
      logger.warn(`[transcription-recovery] やり直しに失敗 message=${r.message_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return rows.length;
}
