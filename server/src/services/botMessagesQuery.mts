/**
 * bot のメッセージ取得 (GET /api/bot/messages、routes/bot.mts) の SQL の組み立て・件数の丸め・文字起こしの列。
 * 改善ループ 125 で道から出した (中身は同じ)。pool も logger も読まない純粋なファイル
 * テスト: __tests__/unit/botMessagesQuery.test.mts (枝ごとの形)、結合は bot-api
 */

/**
 * #373: tealus-mcp は v0.1.0 から limit を送っていたが、道で読んでいなかったため
 *   silent に 20 件固定だった (既定値が一致していたので誤りが表に出ない)。
 *   既定は 20 のまま = 既存の呼び出し元 (全員 20 を渡している) の挙動は不変。1〜100 に収める
 */
export function parseBotMessagesLimit(limit: string | number | undefined): number {
  return Math.min(Math.max(parseInt(limit as string) || 20, 1), 100);
}

export function buildBotMessagesQuery({ roomId, since, limit }: { roomId: string; since?: string; limit: number }): { query: string; params: (string | number)[] } {
  if (since) {
    // #373 方針 A: since は catch-up 用途なので limit を効かせない。
    //   件数で絞ると「前回の続き」を取りこぼすため、上限 100 は保険として固定のまま。
    return {
      query: `
        SELECT m.*, u.display_name AS sender_display_name
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.room_id = $1 AND m.created_at > $2 AND m.is_deleted = false
        ORDER BY m.created_at ASC
        LIMIT 100
      `,
      params: [roomId, since],
    };
  }
  return {
    query: `
        SELECT m.*, u.display_name AS sender_display_name
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.room_id = $1 AND m.is_deleted = false
        ORDER BY m.created_at DESC
        LIMIT $2
      `,
    params: [roomId, limit],
  };
}

/** 音声メッセージに添える文字起こしの列 (verbosity 制御 #219)。raw は文字起こしを出すときだけ */
export function transcriptionColumns(includeTranscription: boolean, includeRaw: boolean): string {
  const cols = ['id', 'status', 'version'];
  if (includeTranscription) cols.push('formatted_text');
  if (includeTranscription && includeRaw) cols.push('raw_text');
  return cols.join(', ');
}

/**
 * 音声メッセージ群の文字起こしの最新版を 1 回で引く (11-26 小野さん判断 Q3、以前は 1 件ずつ)。$1 = message id の配列。
 * ★ どのメッセージの行かは __message_id で返す。道は取り出して捨てる (返す列は #219 の細かさのまま)
 */
export function latestTranscriptionsQuery(selectList: string): string {
  return `SELECT DISTINCT ON (message_id) message_id AS __message_id, ${selectList}
     FROM voice_transcriptions
     WHERE message_id = ANY($1::uuid[])
     ORDER BY message_id, version DESC`;
}

const UNREAD_SELECT = `
        SELECT m.id, m.room_id, m.sender_id, m.content, m.type, m.created_at,
               u.display_name AS sender_display_name,
               r.name AS room_name, r.type AS room_type
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        JOIN rooms r ON r.id = m.room_id`;

/**
 * bot の未読 (GET /api/bot/unread) の SQL。改善ループ 133 で道から出した (中身は同じ)。古い順に最大 100 件
 * ★ 部屋を指定したら、メンバーかどうかは道で先に確かめる (403)。ここは SQL を作るだけ
 * ★ requesterCondition は requesterScope.mts の requesterRoomCondition('m.room_id', 2) を渡す (あちらは pool を読むので、ここからは import しない)
 */
export function buildBotUnreadQuery({ userId, roomId, requester, requesterCondition }: {
  userId: string; roomId?: string; requester: string | null; requesterCondition: string;
}): { query: string; params: (string | null)[] } {
  if (roomId) {
    return {
      query: `${UNREAD_SELECT}
        WHERE m.room_id = $1
          AND m.sender_id != $2
          AND m.is_deleted = false
          AND m.created_at > GREATEST(
            (SELECT last_read_at FROM room_read_cursors WHERE room_id = $1 AND user_id = $2),
            (SELECT joined_at FROM room_members WHERE room_id = $1 AND user_id = $2)   -- ★ docs/02
          )
        ORDER BY m.created_at ASC
        LIMIT 100`,
      params: [roomId, userId],
    };
  }
  return {
    query: `${UNREAD_SELECT}
        JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $1
        WHERE m.sender_id != $1
          AND ($2::uuid IS NULL OR ${requesterCondition})   -- ★ #564
          AND m.is_deleted = false
          AND m.created_at > GREATEST(
            (SELECT last_read_at FROM room_read_cursors WHERE room_id = m.room_id AND user_id = $1),
            rm.joined_at   -- ★ docs/02
          )
        ORDER BY m.created_at ASC
        LIMIT 100`,
    params: [userId, requester],
  };
}
