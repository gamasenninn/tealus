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

/** 変動する部分の位置 (content 上のオフセット。client がそのまま選択できる) */
interface Hole {
  start: number;
  end: number;
}

/** レスポンス 1 件 */
interface HistoryItem {
  message_id: string;
  target: string;
  body: string;
  content: string;
  holes: Hole[];
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

/** 数字の連なり。骨格の切れ目であり、穴の候補でもある */
const DIGITS = /\d+/g;

/**
 * 重複判定キー (#358 で「数字を無視した骨格」に緩めた)。
 *
 * 宛先が違えば別物。本文は前後 trim + 連続空白の潰しに加え、**数字を伏せて**比較する。
 * これにより `直近の画像1枚で…` と `4枚` が 1 件にまとまり、まとまった理由
 * (= どの数字が動いたか) がそのまま穴になる。数字の個数が違えば分割数も変わるので
 * 別の指示として扱われる。
 *
 * 区切り文字を選ばずに済むよう JSON 配列で組む (宛先と本文の境界が曖昧にならない)。
 */
function dedupeKey(target: string, body: string): string {
  return JSON.stringify([target, body.replace(/\s+/g, ' ').split(DIGITS)]);
}

/** 本文中の数字の並び (骨格が同じもの同士は同じ長さになる) */
function numbersOf(body: string): string[] {
  return body.replace(/\s+/g, ' ').match(DIGITS) || [];
}

/**
 * 代表メッセージの content 上で、i 番目の数字がどこにあるかを返す。
 * body ではなく content を見るのは、client が受け取った content をそのまま
 * 選択範囲に使えるようにするため。宛先メンションに数字が含まれる可能性があるので
 * 本文の開始位置より後ろだけを走査する。
 */
function digitRanges(content: string, bodyStart: number): Hole[] {
  const ranges: Hole[] = [];
  const re = new RegExp(DIGITS.source, 'g');
  re.lastIndex = bodyStart;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  return ranges;
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

    /** 骨格ごとの束。代表は最新の1件、numberSets は各数字位置に現れた値の集合 */
    interface Group {
      row: PromptRow;
      target: string;
      body: string;
      bodyStart: number;
      numberSets: Array<Set<string>>;
    }

    const targetCounts: Record<string, number> = {};
    // Map は挿入順を保つ。走査が新しい順なので、束の並びもそのまま新しい順になる
    const groups = new Map<string, Group>();

    for (const row of result.rows) {
      const target = byLengthDesc.find(t => row.content.startsWith(`@${t} `));
      if (!target) continue;

      const rawAfter = row.content.slice(target.length + 2);
      const body = rawAfter.trim();
      if (!body) continue; // 宛先だけの投稿は指示として再利用できない

      targetCounts[target] = (targetCounts[target] || 0) + 1;

      const key = dedupeKey(target, body);
      const numbers = numbersOf(body);

      let group = groups.get(key);
      if (!group) {
        // 最初に出会ったもの = 最新。これを代表にするので「最後に使った値」が入る
        group = {
          row,
          target,
          body,
          bodyStart: target.length + 2 + (rawAfter.length - rawAfter.trimStart().length),
          numberSets: numbers.map(() => new Set<string>()),
        };
        groups.set(key, group);
      }
      // 骨格が同じなら数字の個数も同じ。i 番目に現れた値を集める
      numbers.forEach((n, i) => group!.numberSets[i]?.add(n));
    }

    const items: HistoryItem[] = [];
    for (const g of groups.values()) {
      // ★ 穴は推測しない。実際に 2 種類以上の値が現れた位置だけを穴にする。
      // これを緩めると「2026年7月」の 2026 を選択してしまい、打った瞬間に年が壊れる。
      const holes = digitRanges(g.row.content, g.bodyStart)
        .filter((_, i) => (g.numberSets[i]?.size ?? 0) > 1);

      // content は加工せずそのまま返す (表示された文字列がそのまま入力欄に入る約束)
      items.push({
        message_id: g.row.id,
        target: g.target,
        body: g.body,
        content: g.row.content,
        holes,
        created_at: g.row.created_at,
      });
    }

    logger.debug(`prompt history: room=${roomId} scanned=${result.rows.length} items=${items.length}`);

    res.json({ items: items.slice(0, parsedLimit), target_counts: targetCounts });
  } catch (err) {
    logger.error('Prompt history error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});
