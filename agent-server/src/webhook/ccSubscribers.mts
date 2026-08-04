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
 * 1 行を購読者集合に書き出す共通処理。write が投げた購読者は登録から外す。
 * 配信中に set を触るので、走査は snapshot に対して行う。
 */
function writeTo(set: Set<CcSubscriber>, line: string, filter?: (s: CcSubscriber) => boolean): void {
  for (const sub of [...set]) {
    if (filter && !filter(sub)) continue;
    try {
      sub.sink.write(line);
    } catch (err) {
      logger.debug(`[cc-stream] write 失敗のため購読解除: project=${sub.project} ${err instanceof Error ? err.message : String(err)}`);
      removeSubscriber(sub);
    }
  }
}

/**
 * project の全購読者に**制御メッセージ**を送る (#365)。
 *
 * ★ `publish()` では送れない。制御メッセージは room に属さないため
 *   `publish` の「room_id が無い payload は捨てる」に引っかかる。
 *   逆に言うと、**制御メッセージは認可 (allowedRooms) の対象外**である
 *   ことを明示するために経路を分けている。room の中身を含めてはいけない。
 *
 * 消費側は `{"__` 接頭辞を「イベントではない制御行」として扱う (前方互換)。
 */
export function broadcastControl(project: string, payload: Record<string, unknown>): void {
  const set = subscribers.get(project);
  if (!set || set.size === 0) return;
  writeTo(set, JSON.stringify(payload) + '\n');
}

/**
 * ★ 計画的な停止を全 project の購読者に予告する (#365)。
 *
 * 再起動はバグ修正のたびに起きる。人が毎回予告する運用は **忘れるようになった
 * 時点で、本当に必要な場面でも使われなくなる**。情報を持っているサーバが
 * 自分で予告すれば、覚えておく必要が消える。
 *
 * ★ この予告が出るのは graceful shutdown (SIGINT / SIGTERM) のときだけ。
 *   クラッシュや強制終了では出ない —— **予告できるものは予告し、
 *   予告できないものは異常として残る**、が仕組みから自然にそうなる。
 *
 * @param expectBackMs クライアントに伝える「戻ってくるまでの見込み」。
 *   これをクライアント側にハードコードさせない (デプロイ時間を知るのはサーバだけ)。
 */
export function broadcastShutdown(expectBackMs: number): void {
  broadcastBye('shutdown', expectBackMs);
}

/**
 * ★ 理由つきの切断予告を全 project の購読者へ送る (#368 で `broadcastShutdown` から切り出し)。
 *
 * reason を外から渡せるようにしたのは、**agent-server 自身の停止以外にも
 * 予告すべき停止がある**と分かったため。2026-08-04、本体サーバ (cc-queue の中継を
 * している側) を再起動したところ、別マシンの購読者が予告なしで切れた
 * (`curl=92` = HTTP/2 ストリーム破損)。
 *
 * ★ 本体サーバは「自分が落ちる」を知っているが購読者を知らない。こちらはその逆。
 *   **情報と、配る能力が別プロセスにある**ので、本体から一段渡して配らせる
 *   (`POST /cc-queue/gateway-bye` → `reason: 'gateway_restart'`)。
 *
 * 消費側は `{"__bye"` の接頭辞一致で猶予窓を張り、読むのは `expect_back_ms` だけ。
 * reason は記録に残るのみなので、**新しい reason 値を足しても再配布は要らない**。
 *
 * @param reason 予告の理由 (`shutdown` = 自分の停止 / `gateway_restart` = 中継の再起動)
 * @param expectBackMs 「戻ってくるまでの見込み」。★ 値を知っているのは停止する側なので、
 *   クライアントにハードコードさせない (#361 と同じ理由)。
 * @returns 送信した購読者数。0 なら誰も繋いでいない (呼び出し側が判別できるように返す)
 */
export function broadcastBye(reason: string, expectBackMs: number): number {
  const payload = { __bye: { reason, expect_back_ms: expectBackMs } };
  const line = JSON.stringify(payload) + '\n';
  let total = 0;
  for (const set of subscribers.values()) {
    total += set.size;
    writeTo(set, line);
  }
  if (total > 0) {
    logger.info(`[cc-stream] 切断を予告しました: reason=${reason} ${total} 購読者 (expect_back_ms=${expectBackMs})`);
  }
  return total;
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

  writeTo(set, JSON.stringify(payload) + '\n', (sub) => sub.allowedRooms.has(roomId));
}
