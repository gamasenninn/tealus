/**
 * 見張り: 設定の読み込みと検証 (#595)
 *
 * 設計は docs/09_見張り設計.md。**足したくなったら先に §6「作らないもの」を読むこと。**
 *
 * ★ 作法はルームトリガー (roomTriggers.mts) と同じ:
 *   - 判定のたびに読み直す = 再起動不要
 *   - **黙って減らさない。** 壊れた行は落とすが、必ず warn を返す
 *   - ファイルが無いのは正常 (見張り未設定)。起動は止めない
 */
import fs from 'node:fs';
import path from 'node:path';
import { isHeartbeatName } from './heartbeats.mts';

export const CONFIG_PATH = path.join(import.meta.dirname, '..', '..', 'config', 'watchdogs.json');

export interface Notify {
  room_id: string;
  /** 人が読むための併記。room_id が正 */
  room: string;
  as_user_id: string;
}

interface WatchBase {
  id: string;
  /** 知らせの 1 行目に出る名前 */
  name: string;
  enabled: boolean;
}

export interface BackupLogWatch extends WatchBase {
  kind: 'backup_log';
  dir: string;
}

export interface RoomQuietWatch extends WatchBase {
  kind: 'room_quiet';
  room_id: string;
  room: string;
  from_user_ids: string[];
  max_quiet_minutes: number;
  /** 稼働時間 (JST、0 時からの分)。終わりは含まない */
  start_minute: number;
  end_minute: number;
  /** 稼働する曜日 (0=日 … 6=土) */
  days: number[];
}

/**
 * Tealus の部品が送る鼓動 (docs/09 §3.2)。
 * ★ 相手 (ptt など) の決めた形の生存の口を読む `http_health` は作り直しで外した (§0: 会社の事情が本体に漏れる)。
 */
export interface HeartbeatWatch extends WatchBase {
  kind: 'heartbeat';
  /** 部品が送る名前 (`--heartbeat <name>`) */
  heartbeat: string;
  /** 部品がログインする利用者。★ 名前だけで引くと、別の人が同じ名前で送った鼓動を拾う */
  from_user_id: string;
  max_silence_minutes: number;
  /** 書いたときだけ「最新のファイルを送っていない」も見る */
  max_send_lag_minutes?: number;
}

/**
 * 通知の宛先が 0 本の人 (docs/09 §3.6、2026-10-16)。★ 1 行が人ごとの見張りに開く (印は `<id>:<user_id>`)
 */
export interface PushReachWatch extends WatchBase {
  kind: 'push_reach';
  /** この日数のうちに何か読んだ人だけを見る。使っていない人に知らせても本人が見ない */
  active_within_days: number;
  /** 見ない人 (試験用のアカウントなど) */
  exclude_user_ids: string[];
}

/** メディアの置き場の空き (docs/09 §3.7、2026-10-31)。★ 見るのはその場所の空きだけ */
export interface DiskFreeWatch extends WatchBase {
  kind: 'disk_free';
  path: string;
  min_free_gb: number;
}

export type Watch = BackupLogWatch | RoomQuietWatch | HeartbeatWatch | PushReachWatch | DiskFreeWatch;

export interface WatchdogConfig {
  notify: Notify;
  watches: Watch[];
}

export interface LoadResult {
  config: WatchdogConfig | null;
  warnings: string[];
}

/** ★ 本文の 2 行目に置く印。前回の知らせを引く検索キー (docs/09 §3.3)。トリガーの印と別の語にする */
export function markFor(id: string): string {
  return `— 見張り (watchdogs: ${id})`;
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

function parseHours(v: unknown): [number, number] | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (Number(m[2]) > 59 || Number(m[4]) > 59 || end > 24 * 60 || start >= end) return null;
  return [start, end];
}

function parseDays(v: unknown): number[] | null {
  if (typeof v !== 'string') return null;
  const days = v.split(',').map((s) => DAY_NAMES.indexOf(s.trim().toLowerCase()));
  if (days.length === 0 || days.some((d) => d < 0)) return null;
  return [...new Set(days)];
}

function validate(raw: unknown, i: number): Watch | string {
  const where = `watches[${i}]`;
  if (typeof raw !== 'object' || raw === null) return `${where}: オブジェクトではありません`;
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.id)) return `${where}: id がありません`;
  const label = `${where} (${r.id})`;
  if (!isNonEmptyString(r.name)) return `${label}: name がありません`;
  const base = { id: r.id, name: r.name, enabled: r.enabled !== false };

  switch (r.kind) {
    case 'backup_log':
      if (!isNonEmptyString(r.dir)) return `${label}: dir (記録の置き場) がありません`;
      return { ...base, kind: 'backup_log', dir: r.dir };

    case 'room_quiet': {
      if (!isUuid(r.room_id)) return `${label}: room_id が UUID ではありません`;
      if (!Array.isArray(r.from_user_ids) || r.from_user_ids.length === 0 || !r.from_user_ids.every(isUuid)) {
        return `${label}: from_user_ids (見る送り手の user id) が 1 つ以上の UUID の配列ではありません`;
      }
      if (typeof r.max_quiet_minutes !== 'number' || !(r.max_quiet_minutes > 0)) {
        return `${label}: max_quiet_minutes が正の数ではありません`;
      }
      const hours = parseHours(r.hours);
      if (!hours) return `${label}: hours は "09:00-17:00" の形で書いてください`;
      const days = parseDays(r.days);
      if (!days) return `${label}: days は "mon,tue,thu" の形で書いてください`;
      return {
        ...base, kind: 'room_quiet', room_id: r.room_id, room: isNonEmptyString(r.room) ? r.room : '',
        from_user_ids: r.from_user_ids as string[], max_quiet_minutes: r.max_quiet_minutes,
        start_minute: hours[0], end_minute: hours[1], days,
      };
    }

    case 'heartbeat': {
      if (!isHeartbeatName(r.heartbeat)) return `${label}: heartbeat (部品が送る名前) は英数字と . _ : - だけで書いてください`;
      if (!isUuid(r.from_user_id)) return `${label}: from_user_id (部品がログインする利用者の id) が UUID ではありません`;
      if (typeof r.max_silence_minutes !== 'number' || !(r.max_silence_minutes > 0)) {
        return `${label}: max_silence_minutes が正の数ではありません`;
      }
      if (r.max_send_lag_minutes !== undefined && (typeof r.max_send_lag_minutes !== 'number' || !(r.max_send_lag_minutes > 0))) {
        return `${label}: max_send_lag_minutes は正の数で書くか、省いてください`;
      }
      return {
        ...base, kind: 'heartbeat', heartbeat: r.heartbeat, from_user_id: r.from_user_id,
        max_silence_minutes: r.max_silence_minutes,
        ...(r.max_send_lag_minutes !== undefined ? { max_send_lag_minutes: r.max_send_lag_minutes as number } : {}),
      };
    }

    case 'push_reach': {
      if (r.active_within_days !== undefined && (typeof r.active_within_days !== 'number' || !(r.active_within_days > 0))) {
        return `${label}: active_within_days は正の数で書くか、省いてください (既定 30 日)`;
      }
      if (r.exclude_user_ids !== undefined && (!Array.isArray(r.exclude_user_ids) || !r.exclude_user_ids.every(isUuid))) {
        return `${label}: exclude_user_ids (見ない人の user id) が UUID の配列ではありません`;
      }
      return {
        ...base, kind: 'push_reach',
        active_within_days: (r.active_within_days as number | undefined) ?? 30,
        exclude_user_ids: (r.exclude_user_ids as string[] | undefined) ?? [],
      };
    }

    case 'disk_free':
      if (!isNonEmptyString(r.path)) return `${label}: path (空きを見る置き場) がありません`;
      if (typeof r.min_free_gb !== 'number' || !(r.min_free_gb > 0)) return `${label}: min_free_gb が正の数ではありません`;
      return { ...base, kind: 'disk_free', path: r.path, min_free_gb: r.min_free_gb };

    case 'http_health':
      return `${label}: kind "http_health" は使えなくなりました。相手の生存の口を本体が読む形はやめ、部品から鼓動 (heartbeat) を送ってもらいます (docs/09 §0)`;

    default:
      return `${label}: kind "${String(r.kind)}" は backup_log / room_quiet / heartbeat / push_reach / disk_free のどれでもありません`;
  }
}

/** パース済みの値から読む (テストと loadWatchdogs の共通部分) */
export function loadWatchdogsFrom(parsed: unknown): LoadResult {
  if (typeof parsed !== 'object' || parsed === null) {
    return { config: null, warnings: ['watchdogs.json がオブジェクトではありません (見張りを使いません)'] };
  }
  const p = parsed as Record<string, unknown>;
  const n = p.notify as Record<string, unknown> | undefined;
  if (!n || !isUuid(n.room_id) || !isUuid(n.as_user_id)) {
    return { config: null, warnings: ['watchdogs.json の notify (room_id / as_user_id) がありません。知らせる先が無いので見張りを使いません'] };
  }
  const notify: Notify = { room_id: n.room_id, room: isNonEmptyString(n.room) ? n.room : '', as_user_id: n.as_user_id };
  if (!Array.isArray(p.watches)) {
    return { config: { notify, watches: [] }, warnings: ['watchdogs.json の watches が配列ではありません'] };
  }
  const watches: Watch[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  p.watches.forEach((raw, i) => {
    const result = validate(raw, i);
    if (typeof result === 'string') { warnings.push(result); return; }
    // ★ id が重複すると印から前回の知らせを引けなくなる (docs/09 §5)
    if (seen.has(result.id)) { warnings.push(`watches[${i}]: id ${result.id} が重複しています (後の行を無視します)`); return; }
    seen.add(result.id);
    watches.push(result);
  });
  return { config: { notify, watches }, warnings };
}

/** 設定ファイルを読む。★ 無いのは正常 (未設定)。壊れているのは warn。起動は止めない */
export function loadWatchdogs(configPath: string = CONFIG_PATH): LoadResult {
  let text: string;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch {
    return { config: null, warnings: [] };
  }
  try {
    return loadWatchdogsFrom(JSON.parse(text.replace(/^﻿/, '')));
  } catch (err) {
    return { config: null, warnings: [`watchdogs.json が JSON として読めません: ${err instanceof Error ? err.message : String(err)}`] };
  }
}
