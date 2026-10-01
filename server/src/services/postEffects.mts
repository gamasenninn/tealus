/**
 * 投稿に付随する処理を 1 か所から出す入口 (#383 段階 1、2026-10-01)。設計は docs/07 §5.1
 *
 * ★ 付随処理 4 つ (① 配信 / ② 通知 / ③ AI 通知 / ④ リンクプレビュー) は**どれも必須の欄**。
 *   付けないものも `{ kind: 'off', reason }` と理由を書く = 「書いていない」が「付けない」と区別できる
 *   (付け忘れ 3 件は、どれも「経路が増えたときに付随処理が一緒に増えていなかった」形だった)
 * ★ INSERT は各経路に残す (添付・サムネイル・文字起こし・LINE の保存で形が違いすぎる)
 * ★ 送る中身と待ち方は、移す前と同じにする。移す経路ごとに中身を固定するテストを先に足す
 *   (例: __tests__/socket/botMediaPostPayload.test.mts)
 * ★★ 今ある形は、移した経路が使うものだけ。人の通知・AI 通知・プレビューの「付ける」形は、
 *   それを使う経路を移すときに、その経路の待ち方 (待つ / 待たない) に合わせて足す
 */
import { getIo } from '../io-registry.mts';
import { pushMachinePost, type MachinePost } from './machinePush.mts';
import { fireWebhooks, type WebhookPayload } from './webhook.mts';
import { sendPushToRoomMembers, type PushPayload } from './push.mts';
import { logger } from '../utils/logger.mts';

/** 付けない、と理由つきで書く */
export interface Off {
  kind: 'off';
  reason: string;
}

export interface PostEffects {
  roomId: string;
  /** ① 配信 (`message:new`)。画面の更新と未読の数え直し */
  emit: Record<string, unknown>;
  /**
   * ② 通知
   *   human   … その部屋のメンバーへ鳴らす。★ 待たずに投げる (移す前の #3 と同じ。投げるところの例外だけ記録して続ける)
   *   machine … 部屋の管理者の設定で鳴らすか決まる (#463)。★ 待ってから戻る (移す前と同じ)
   */
  push: { kind: 'human'; senderId: string; payload: PushPayload } | { kind: 'machine'; post: MachinePost } | Off;
  /** ③ AI 通知 (`message.created`)。★ 待たずに投げる (移す前の #5 と同じ。fireWebhooks は中で失敗を握る) */
  webhook: { kind: 'on'; payload: WebhookPayload } | Off;
  /** ④ リンクプレビュー */
  preview: Off;
}

/**
 * system メッセージ (#2 通話 / #10 #11 スタンプ / #12 入退室・権限変更 / #12' ボットの参加) の付随処理。
 * ★ 配信だけ。通知・AI 通知・プレビューは**意図して付けない** (docs/07 §3.1「スタンプ・入退室・通話でエージェントが動くのは誤り」)
 */
export const SYSTEM_MESSAGE_EFFECTS: Pick<PostEffects, 'push' | 'webhook' | 'preview'> = {
  push: { kind: 'off', reason: '意図 (docs/07 §3.1)。system メッセージでは鳴らさない' },
  webhook: { kind: 'off', reason: '意図 (docs/07 §3.1)。system メッセージでエージェントが動くのは誤り' },
  preview: { kind: 'off', reason: '意図 (docs/07 §3.1)。system メッセージに URL は入らない' },
};

export async function announcePost(e: PostEffects): Promise<void> {
  getIo().to(e.roomId).emit('message:new', e.emit);
  if (e.push.kind === 'human') {
    try {
      sendPushToRoomMembers(e.roomId, e.push.senderId, e.push.payload);
    } catch (err) {
      logger.warn('Push notification failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }
  if (e.push.kind === 'machine') await pushMachinePost(e.push.post);
  if (e.webhook.kind === 'on') fireWebhooks('message.created', e.roomId, e.webhook.payload);
}
