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
