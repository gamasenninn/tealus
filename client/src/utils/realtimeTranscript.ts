/**
 * #412 Realtime のイベントから「どちら側の発話か」を読み取る。
 *
 * ★ **人の発話が 1 件も記録されていなかった。** 受け取りの条件が
 *   `type.endsWith('transcript.done')` で、入力側のイベント名
 *   `conversation.item.input_audio_transcription.completed` に**一致しなかった**。
 *   文字起こし自体は行われていた (session に `transcription` を渡している) ので、
 *   **受け取り側だけが取りこぼしていた** —— 実測で transcript 328 件すべて AI 側 (2026-09-06)。
 *
 * ★★ これは 1 軸測れないだけの話ではない。docs/08 §12.6 は基準④ を
 *   「**transcript 全文を人が読んで判定する**」と決めている。
 *   **答えだけ並んでいて、何を聞かれたかが無い**状態では判定できない。
 *
 * ★ 名前が 2 通りあるのは経路が違うから。**片方だけを見る形にしない**ために、
 *   ここに 1 か所だけ判定を置く (呼ぶ側で文字列を比べない)。
 */
export interface TranscriptLine {
  who: 'user' | 'ai';
  text: string;
}

/** 入力側 (人が話した分) の文字起こし完了 */
function isUserTranscript(type: string): boolean {
  return type.includes('input_audio_transcription') && type.endsWith('.completed');
}

/** 出力側 (AI が話した分) の文字起こし完了 */
function isAiTranscript(type: string): boolean {
  return type.endsWith('transcript.done');
}

/**
 * 文字起こしのイベントなら `{ who, text }`、そうでなければ `null`。
 * ★ 途中経過 (`.delta`) と失敗 (`.failed`) は拾わない。完了したものだけを残す。
 */
export function readTranscriptEvent(msg: { type?: string; transcript?: string }): TranscriptLine | null {
  const type = msg.type;
  if (!type) return null;
  const text = typeof msg.transcript === 'string' ? msg.transcript.trim() : '';
  if (!text) return null;      // ★ 空の行を計測に混ぜない
  if (isUserTranscript(type)) return { who: 'user', text };
  if (isAiTranscript(type)) return { who: 'ai', text };
  return null;
}
