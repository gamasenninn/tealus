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

/**
 * ISO 日時文字列 → "今日" / "昨日" / "3日前" / "2週間前" / "5か月前" / "1年前" (#354)
 * 履歴一覧の「いつ使った指示か」の粗い目印。分単位の精度は要らないので日以下は切り捨てる。
 * 未来日時 (端末時計のずれ等) は "今日" に丸める。
 */
export function formatRelativeDay(dateStr: string): string {
  const then = new Date(dateStr).getTime();
  if (!isFinite(then)) return '';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return '今日';
  if (days === 1) return '昨日';
  if (days < 7) return `${days}日前`;
  if (days < 30) return `${Math.floor(days / 7)}週間前`;
  if (days < 365) return `${Math.floor(days / 30)}か月前`;
  return `${Math.floor(days / 365)}年前`;
}
