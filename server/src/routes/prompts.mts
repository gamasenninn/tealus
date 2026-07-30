import { logger } from '../utils/logger.mts';
import * as E from '../constants/errors.mts';
import express from 'express';
import { pool } from '../db/pool.mts';
import { authenticate } from '../middleware/auth.mts';
import { requireMember } from '../middleware/roomAccess.mts';

/**
 * #354 エージェント指示の履歴 (読み取り専用)
 *
 * 「よく使う指示を登録する」UI を作る代わりに、過去に自分が送った `@アシスタント` /
 * `@cc-*` 宛メッセージをそのまま再利用する。登録という手間を発生させないための設計で、
 * 専用テーブルは持たず messages を読むだけ。
 *
 * cc project 一覧は agent-server 側にあり本体 server は知らないため、宛先リストは
 * client から targets= で受け取る (client は既に mention 候補として持っている)。
 */
export const router = express.Router({ mergeParams: true });

router.use(authenticate);
router.use(requireMember);

/** 履歴クエリパラメータ (境界キャスト用) */
interface HistoryQuery {
  targets?: string;
  limit?: string;
}

/** messages から読む列 */
interface PromptRow {
  id: string;
  content: string;
  created_at: Date;
}

/** レスポンス 1 件 */
interface HistoryItem {
  message_id: string;
  target: string;
  body: string;
  content: string;
  created_at: Date;
}

/**
 * 重複除去と頻度集計のために遡る件数。
 * ここで打ち止めるので target_counts も「直近 SCAN_LIMIT 件の範囲での回数」になる。
 * 古い偏りを引きずらない方が宛先チップの並びとしては望ましいので、これは仕様。
 */
const SCAN_LIMIT = 200;

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/**
 * 重複判定キー。宛先が違えば別物、本文は前後 trim + 連続空白の潰しで比較する。
 * 区切り文字を選ばずに済むよう JSON 配列で組む (宛先と本文の境界が曖昧にならない)。
 */
function dedupeKey(target: string, body: string): string {
  return JSON.stringify([target, body.replace(/\s+/g, ' ')]);
}

/**
 * フォーム回答の目印。`client/src/utils/parseForm.ts` の `buildAnswerText` が必ず付ける。
 * 「フォーム回答」の定義 (reply_to がフォーム かつ 本文に 【回答】) は
 * 同 file の `hasUserAnsweredForm` と揃えてある — 片方だけ変えないこと。
 */
const FORM_ANSWER_MARKER = '【回答】';

/**
 * GET /api/rooms/:id/prompts/history?targets=アシスタント,cc-tealus&limit=30
 *
 * 自分がこのルームで送った「宛先 + 本文」形式のメッセージを新しい順に返す。
 * 並びを新しい順にするのは messages API と同じ約束 (表示側で反転する)。
 */
router.get('/history', async (req, res) => {
  const roomId = (req.params as { id: string }).id;
  const userId = req.user!.id;
  const { targets, limit = String(DEFAULT_LIMIT) } = req.query as HistoryQuery;

  const targetList = (targets || '').split(',').map(s => s.trim()).filter(Boolean);
  if (targetList.length === 0) {
    return res.status(400).json({ error: '宛先の指定は必須です' });
  }

  const parsedLimit = Math.min(Math.max(parseInt(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  // 長い宛先を先に見る: cc-tea と cc-tealus が両方あるとき短い方に誤って割り当てない
  const byLengthDesc = [...targetList].sort((a, b) => b.length - a.length);

  try {
    // 宛先ごとの前方一致 OR。LIKE ではなく starts_with を使い、宛先名に含まれる
    // % / _ が wildcard として効いてしまう事故を型で潰す。
    // 末尾の空白まで含めて一致させることで「宛先のみ (本文なし)」を SQL 側で落とす。
    const params: unknown[] = [roomId, userId];
    const prefixConds = targetList.map(t => {
      params.push(`@${t} `);
      return `starts_with(m.content, $${params.length})`;
    });

    params.push(FORM_ANSWER_MARKER);
    const markerIdx = params.length;

    params.push(SCAN_LIMIT);

    const result = await pool.query<PromptRow>(
      `SELECT m.id, m.content, m.created_at
         FROM messages m
        WHERE m.room_id = $1
          AND m.sender_id = $2
          AND m.is_deleted = false
          AND m.content IS NOT NULL
          AND (${prefixConds.join(' OR ')})
          -- フォーム回答を除外。日付入りの一回きりの回答が 200-400 字で並び、
          -- 再利用したい定型 (「朝のバッチを回そう」等) を押し下げるため (#354 実データ調査)。
          -- フォームへの「コメント返信」で出した指示は回答ではないので残す。
          AND NOT (
            strpos(m.content, $${markerIdx}) > 0
            AND EXISTS (
              SELECT 1 FROM messages f WHERE f.id = m.reply_to AND f.type = 'form'
            )
          )
        ORDER BY m.created_at DESC
        LIMIT $${params.length}`,
      params
    );

    const items: HistoryItem[] = [];
    const targetCounts: Record<string, number> = {};
    const seen = new Set<string>();

    // 新しい順に走査しているので、同じ文面は最初に出会った (= 最新の) 1 件が残る
    for (const row of result.rows) {
      const target = byLengthDesc.find(t => row.content.startsWith(`@${t} `));
      if (!target) continue;

      const body = row.content.slice(target.length + 2).trim();
      if (!body) continue; // 宛先だけの投稿は指示として再利用できない

      targetCounts[target] = (targetCounts[target] || 0) + 1;

      const key = dedupeKey(target, body);
      if (seen.has(key)) continue;
      seen.add(key);

      // content は加工せずそのまま返す (表示された文字列がそのまま入力欄に入る約束)
      items.push({
        message_id: row.id,
        target,
        body,
        content: row.content,
        created_at: row.created_at,
      });
    }

    logger.debug(`prompt history: room=${roomId} scanned=${result.rows.length} items=${items.length}`);

    res.json({ items: items.slice(0, parsedLimit), target_counts: targetCounts });
  } catch (err) {
    logger.error('Prompt history error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});
