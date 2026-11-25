/**
 * bot の検索 (GET /api/bot/search、routes/bot.mts) の SQL を組み立てる。改善ループ 121 で道から出した (中身は同じ)。
 * ★ params に積む順と $n の番号は 1 つの数え (paramIdx) で決まる。枝を足すときは、積む所と番号を取る所を必ず並べて書く
 * ★ 結果の取り出しと抜粋 (searchSnippet.mts) は道の側
 * テスト: __tests__/unit/botSearchQuery.test.mts (並びと番号)、結合は bot-api / botSearchTimezone / botRequesterScope
 */
import { hasExplicitZone, resolveTimeZone } from '../lib/localTime.mts';
import { requesterRoomCondition } from './requesterScope.mts';

export interface BotSearchFilters {
  /** 機械の口座 (room_members で見える部屋を絞る) */
  userId: string;
  roomId?: string;
  /** #564 依頼した人 (requesterOf(res))。いればその人の入っている部屋だけ */
  requester: string | null;
  senderId?: string;
  type?: string;
  since?: string;
  until?: string;
  hasReaction?: string | boolean;
  tagNames: string[];
  isDone?: string | boolean;
  /** LIKE を逃がした検索語 (escapeLike)。無ければ null */
  escapedQ: string | null;
  limit: number;
  offset: number;
}

export function buildBotSearchQuery(f: BotSearchFilters): { query: string; params: (string | number | boolean)[] } {
  // パラメータと WHERE 句を動的構築
  const params: (string | number | boolean)[] = [];
  let paramIdx = 1;
  const filtersSQL: string[] = []; // 共通の追加 WHERE (Case 1 / 2 path で使い回し)

  // bot user (room_members JOIN 用)
  params.push(f.userId);
  const userIdParamIdx = paramIdx++;

  if (f.roomId) {
    params.push(f.roomId);
    filtersSQL.push(`m.room_id = $${paramIdx++}`);
  }
  // ★ #564 依頼した人が入っている部屋だけ (部屋の指定が無いときの横断検索も)
  if (f.requester) {
    params.push(f.requester);
    filtersSQL.push(requesterRoomCondition('m.room_id', paramIdx++));
  }
  if (f.senderId) {
    params.push(f.senderId);
    filtersSQL.push(`m.sender_id = $${paramIdx++}`);
  }
  if (f.type) {
    params.push(f.type);
    filtersSQL.push(`m.type = $${paramIdx++}`);
  }
  // ★ 時間帯の無い日付はサーバーの時間帯で読む (2026-10-30 小野さん判断 8)。DB (UTC) で読むと、
  //   「10 月の〜」で 10-01 の 0〜9 時 (日本時間) が抜け、11-01 の 0〜9 時が混ざった。明示された値は書いてあるとおり
  const atLocal = (value: string) => {
    params.push(value);
    const p = paramIdx++;
    if (hasExplicitZone(value)) return `$${p}::timestamptz`;
    params.push(resolveTimeZone());
    return `($${p}::timestamp AT TIME ZONE $${paramIdx++})`;
  };
  if (f.since) filtersSQL.push(`m.created_at >= ${atLocal(String(f.since))}`);
  if (f.until) filtersSQL.push(`m.created_at <= ${atLocal(String(f.until))}`);
  // #325: リアクション有無で SQL フィルタ（agent が大量 message をスキャンせず
  // 「✅(完了)が付いていないもの」等を決定論的に絞れる）。param 不要の EXISTS 述語。
  if (f.hasReaction !== undefined && f.hasReaction !== '') {
    const wantReaction = f.hasReaction === 'true' || f.hasReaction === true;
    filtersSQL.push(
      `${wantReaction ? 'EXISTS' : 'NOT EXISTS'} (SELECT 1 FROM message_reactions mr WHERE mr.message_id = m.id)`
    );
  }

  // tag_match CTE (tag_names 指定時のみ)
  let tagCteSQL = '';
  let tagFilterSQL = '';
  if (f.tagNames.length > 0) {
    const tagPlaceholders = f.tagNames.map((name) => {
      params.push(name);
      return `$${paramIdx++}`;
    });
    params.push(f.tagNames.length);
    const havingParam = paramIdx++;

    let isDoneFilter = '';
    if (f.isDone !== undefined && f.isDone !== '') {
      params.push(f.isDone === 'true' || f.isDone === true);
      isDoneFilter = ` AND mt.is_done = $${paramIdx++}`;
    }

    tagCteSQL = `
      WITH tag_match AS (
        SELECT mt.message_id
        FROM message_tags mt
        JOIN tags t ON t.id = mt.tag_id
        WHERE t.name IN (${tagPlaceholders.join(', ')})${isDoneFilter}
        GROUP BY mt.message_id
        HAVING COUNT(DISTINCT t.name) = $${havingParam}
      )
    `;
    tagFilterSQL = ` AND m.id IN (SELECT message_id FROM tag_match)`;
  }

  const commonWhere = filtersSQL.length > 0 ? ' AND ' + filtersSQL.join(' AND ') : '';
  const selectFields = `
    m.id, m.room_id, m.sender_id, m.content, m.type, m.created_at,
    u.display_name AS sender_display_name,
    r.name AS room_name, r.type AS room_type
  `;

  let query: string;
  if (!f.escapedQ) {
    // Case 1: q なし — 単一 SELECT (btree index 経由)
    params.push(f.limit + 1, f.offset);
    const limitIdx = paramIdx++;
    const offsetIdx = paramIdx++;
    query = `
      ${tagCteSQL}
      SELECT ${selectFields},
             vt.formatted_text AS transcription_formatted,
             vt.raw_text AS transcription_raw
      FROM messages m
      JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $${userIdParamIdx}
      JOIN users u ON u.id = m.sender_id
      JOIN rooms r ON r.id = m.room_id
      LEFT JOIN LATERAL (
        SELECT formatted_text, raw_text FROM voice_transcriptions
        WHERE message_id = m.id ORDER BY version DESC LIMIT 1
      ) vt ON m.type = 'voice'
      WHERE NOT m.is_deleted${commonWhere}${tagFilterSQL}
      ORDER BY m.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;
  } else {
    // Case 2: q あり — UNION (path_content + path_voice)
    params.push(`%${f.escapedQ}%`);
    const qIdx = paramIdx++;
    params.push(f.limit + 1, f.offset);
    const limitIdx = paramIdx++;
    const offsetIdx = paramIdx++;

    // path_voice は type フィルタが 'voice' 以外を強制した場合スキップ
    const skipPathVoice = f.type && f.type !== 'voice';
    // path_content は type='voice' が強制された場合スキップ
    const skipPathContent = f.type === 'voice';

    const pathContentSQL = skipPathContent ? '' : `
      SELECT ${selectFields},
             NULL::text AS transcription_formatted,
             NULL::text AS transcription_raw
      FROM messages m
      JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $${userIdParamIdx}
      JOIN users u ON u.id = m.sender_id
      JOIN rooms r ON r.id = m.room_id
      WHERE NOT m.is_deleted
        AND m.content ILIKE $${qIdx} ESCAPE '\\'${commonWhere}${tagFilterSQL}
    `;

    const pathVoiceSQL = skipPathVoice ? '' : `
      SELECT ${selectFields},
             vt.formatted_text AS transcription_formatted,
             vt.raw_text AS transcription_raw
      FROM messages m
      JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $${userIdParamIdx}
      JOIN users u ON u.id = m.sender_id
      JOIN rooms r ON r.id = m.room_id
      JOIN voice_transcriptions vt ON vt.message_id = m.id
        AND vt.version = (SELECT MAX(version) FROM voice_transcriptions WHERE message_id = m.id)
      WHERE NOT m.is_deleted
        AND m.type = 'voice'
        AND (vt.formatted_text ILIKE $${qIdx} ESCAPE '\\' OR vt.raw_text ILIKE $${qIdx} ESCAPE '\\')${commonWhere}${tagFilterSQL}
    `;

    const unionSQL =
      pathContentSQL && pathVoiceSQL
        ? `(${pathContentSQL}) UNION (${pathVoiceSQL})`
        : pathContentSQL || pathVoiceSQL;

    query = `
      ${tagCteSQL}
      SELECT * FROM (${unionSQL}) u
      ORDER BY created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;
  }

  return { query, params };
}
