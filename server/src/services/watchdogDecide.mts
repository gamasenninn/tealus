/**
 * 見張り: 判定 (#595、docs/09 §3)
 *
 * ★ どれも時計と観測を受け取る純関数。DB・HTTP・ファイルは watchdogRunner が持ってくる。
 * ★★ 知らせるのは「変わったとき」だけ (§3.2): 正常 → 異常 で ⚠ を 1 回、異常 → 正常 で ✅ を 1 回。
 */
import type { BackupAssessment } from './backupLog.mts';
import type { Heartbeat } from './heartbeats.mts';
import { markFor, type HeartbeatWatch, type RoomQuietWatch, type Watch } from './watchdogs.mts';

export type Observation =
  | { state: 'ok'; detail: string }
  | { state: 'down'; detail: string }
  /** 判定しない (稼働時間の外など)。★ 状態を変えない = ⚠ のまま夜を越す */
  | { state: 'skip'; detail: string };

export interface LastNotice {
  kind: 'alert' | 'recover';
  at: Date;
}

const JST_OFFSET_MS = 9 * 3_600_000;

/** JST の「その日の 0 時からの分」と曜日と、その日の 0 時 (UTC の Date) */
function jstClock(now: Date): { minute: number; day: number; midnight: Date } {
  const j = new Date(now.getTime() + JST_OFFSET_MS);
  const minute = j.getUTCHours() * 60 + j.getUTCMinutes();
  const midnight = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()) - JST_OFFSET_MS);
  return { minute, day: j.getUTCDay(), midnight };
}

/** JST の "MM-DD HH:MM" */
function formatJst(d: Date): string {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(j.getUTCMonth() + 1)}-${p(j.getUTCDate())} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} 時間` : `${h} 時間 ${m} 分`;
}

/**
 * 部屋に、指定した送り手の投稿が来ているか。
 *
 * ★ 稼働時間の外・稼働しない曜日は判定しない (夜は静かなのが正常)。
 * ★★ 稼働時間に入ったら**稼働開始の時刻から**数える。前夜の最後の投稿から数えると毎朝鳴る (§3.1)。
 */
export function judgeRoomQuiet(w: RoomQuietWatch, lastPostAt: Date | null, now: Date): Observation {
  const { minute, day, midnight } = jstClock(now);
  if (!w.days.includes(day) || minute < w.start_minute || minute >= w.end_minute) {
    return { state: 'skip', detail: '稼働時間の外' };
  }
  const windowStart = new Date(midnight.getTime() + w.start_minute * 60_000);
  const from = lastPostAt && lastPostAt > windowStart ? lastPostAt : windowStart;
  const quiet = Math.floor((now.getTime() - from.getTime()) / 60_000);
  const last = lastPostAt ? formatJst(lastPostAt) : 'なし';
  if (quiet > w.max_quiet_minutes) {
    return { state: 'down', detail: `${w.room || '部屋'} に ${w.max_quiet_minutes} 分を超えて投稿がありません (最後の投稿: ${last})` };
  }
  return { state: 'ok', detail: `${w.room || '部屋'} に投稿が来ています (最後の投稿: ${last})` };
}

function parseTime(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Tealus の部品の鼓動 (docs/09 §3.2)。
 *
 * ★ 一度も来ていないのは異常 (見ていないものを正常と言わない)。
 * ★★ 鼓動が来ていても、`info` の「最新のファイル」が「最後に送った時刻」より閾値を超えて新しければ異常
 *   (生きているが働いていない。10-12 の #582・#587 はこの形だった)。時刻が無い・壊れているときは遅れとして扱わない。
 */
export function judgeHeartbeat(w: HeartbeatWatch, hb: Heartbeat | null, now: Date): Observation {
  if (!hb) return { state: 'down', detail: `鼓動 (${w.heartbeat}) が一度も届いていません` };
  const silent = Math.floor((now.getTime() - hb.last_seen.getTime()) / 60_000);
  const last = formatJst(hb.last_seen);
  if (silent > w.max_silence_minutes) {
    return { state: 'down', detail: `鼓動が ${w.max_silence_minutes} 分を超えて来ていません (最後の鼓動: ${last})` };
  }
  if (w.max_send_lag_minutes !== undefined) {
    const latest = parseTime(hb.info.latest_file_at);
    const sent = parseTime(hb.info.last_sent_at);
    if (latest && sent) {
      const lag = Math.floor((latest.getTime() - sent.getTime()) / 60_000);
      if (lag > w.max_send_lag_minutes) {
        return {
          state: 'down',
          detail: `動いてはいますが、最新のファイル (${formatJst(latest)}) を送っていません (最後に送ったのは ${formatJst(sent)})`,
        };
      }
    }
  }
  return { state: 'ok', detail: `鼓動が来ています (最後の鼓動: ${last})` };
}

export function judgeBackupLog(a: BackupAssessment): Observation {
  switch (a.kind) {
    case 'ok': return { state: 'ok', detail: `最後のバックアップ: ${a.name} (${a.hours} 時間前に成功)` };
    case 'bad': return { state: 'down', detail: `最後のバックアップの記録: ${a.name} (${a.hours} 時間前) — ${a.why}` };
    case 'none': return { state: 'down', detail: 'バックアップの記録が 1 つもありません' };
    case 'read-error': return { state: 'down', detail: `バックアップの記録の置き場を読めません (${a.error})` };
  }
}

/** 投稿するか、するなら本文。★ 2 行目に印 (docs/09 §5、ルームトリガー §10 と同じ理由) */
export function decideNotice(
  w: Watch,
  obs: Observation,
  last: LastNotice | null,
  now: Date,
): { kind: 'alert' | 'recover' | null; body: string | null } {
  const wasDown = last?.kind === 'alert';
  if (obs.state === 'down' && !wasDown) {
    return { kind: 'alert', body: `⚠ ${w.name} が止まっているようです\n${markFor(w.id)}\n${obs.detail}` };
  }
  if (obs.state === 'ok' && wasDown) {
    const minutes = Math.max(0, Math.round((now.getTime() - last.at.getTime()) / 60_000));
    return {
      kind: 'recover',
      body: `✅ ${w.name} が戻りました (約 ${formatDuration(minutes)}止まっていました)\n${markFor(w.id)}\n${obs.detail}`,
    };
  }
  return { kind: null, body: null };
}
