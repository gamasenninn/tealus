/**
 * 表示用フォーマットの純関数。#342 系リファクタで各コンポーネントに散在していた
 * 時刻/再生時間フォーマットを集約 (テスト可能・単一実装)。
 */

/**
 * 秒 → "m:ss" (例 65 → "1:05")。0 / NaN / Infinity は "0:00"。
 * 音声の再生時間表示 (VoiceBubble / VoiceEditModal) 用。
 * ※ VoiceRecorder は "mm:ss" (分もゼロ詰め・ガード無し) の別書式なので対象外。
 */
export function formatDuration(s: number): string {
  if (!s || !isFinite(s)) return '0:00';
  const min = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

/**
 * ISO 日時文字列 → "HH:MM" (ja-JP, 2桁)。メッセージバブルの時刻表示用。
 * ※ RoomList は「今日=時刻 / それ以外=月日」の相対書式なので対象外。
 */
export function formatClockTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}
