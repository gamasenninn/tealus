/**
 * cc-queue 購読者レジストリ (#214)
 *
 * `@cc-{project}` の起床通知を、file beacon に加えて **接続中の HTTP 購読者にも配る**。
 * file への append は一切変えない (併存)。この module は「配る側」だけを持つ。
 *
 * ★ 認可がここに入る理由:
 *   beacon を書くのは agent-server の bot、消費して返信するのは CC セッションの bot で
 *   **別 principal**。参加ルームが違うため、agent-server の bot は member でも CC 側は
 *   member でないルーム (他人の DM 等) が beacon に載りうる。そのまま配ると、
 *   **返信できない (bot API が 403) イベントで起こされる**うえ、HTTP 公開時は
 *   読み手の権限を超えた本文が流れる。
 *   → 購読者ごとの `allowedRooms` (接続時に呼び出し元のトークンで /api/rooms を引いた結果) で絞り、
 *     **消費者が実際に行動できる範囲に揃える**。
 */
import { logger } from '../lib/logger.mts';

/** 購読者が書き出せる最小のインターフェース (express の Response を想定) */
export interface CcSubscriberSink {
  write(chunk: string): boolean;
}

export interface CcSubscriber {
  /** cc-queue の project 識別子 (= beacon の file 名) */
  project: string;
  /** ★ この購読者に配ってよい room id 集合。接続時に確定させる */
  allowedRooms: Set<string>;
  sink: CcSubscriberSink;
}

/** project → 購読者集合 */
const subscribers = new Map<string, Set<CcSubscriber>>();

export function addSubscriber(sub: CcSubscriber): void {
  let set = subscribers.get(sub.project);
  if (!set) {
    set = new Set();
    subscribers.set(sub.project, set);
  }
  set.add(sub);
  logger.debug(`[cc-stream] subscriber added: project=${sub.project} rooms=${sub.allowedRooms.size} total=${set.size}`);
}

export function removeSubscriber(sub: CcSubscriber): void {
  const set = subscribers.get(sub.project);
  if (!set) return;
  if (set.delete(sub)) {
    logger.debug(`[cc-stream] subscriber removed: project=${sub.project} total=${set.size}`);
  }
  if (set.size === 0) subscribers.delete(sub.project);
}

export function subscriberCount(project: string): number {
  return subscribers.get(project)?.size ?? 0;
}

/**
 * project の購読者に 1 イベントを配る (NDJSON = 1 行 + 改行)。
 *
 * - **allowedRooms に含まれる room_id のイベントだけ**配る (認可)
 * - `room_id` を持たない payload は誰にも配らない (安全側)
 * - write が投げた購読者 (切断済み) は登録から外す。他の購読者への配信は続ける
 * - 購読者ゼロでも例外を投げない。file beacon への append は既に済んでいる
 */
export function publish(project: string, payload: Record<string, unknown>): void {
  const set = subscribers.get(project);
  if (!set || set.size === 0) return;

  const roomId = payload.room_id;
  if (typeof roomId !== 'string' || !roomId) {
    logger.warn(`[cc-stream] payload に room_id が無いため配信しません (project=${project})`);
    return;
  }

  const line = JSON.stringify(payload) + '\n';
  // 配信中に set を触る (切断済みの除去) ので、走査は snapshot に対して行う
  for (const sub of [...set]) {
    if (!sub.allowedRooms.has(roomId)) continue;
    try {
      sub.sink.write(line);
    } catch (err) {
      logger.debug(`[cc-stream] write 失敗のため購読解除: project=${project} ${err instanceof Error ? err.message : String(err)}`);
      removeSubscriber(sub);
    }
  }
}
