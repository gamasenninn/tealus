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

/** 付けない、と理由つきで書く */
export interface Off {
  kind: 'off';
  reason: string;
}

export interface PostEffects {
  roomId: string;
  /** ① 配信 (`message:new`)。画面の更新と未読の数え直し */
  emit: Record<string, unknown>;
  /** ② 通知。machine = 部屋の管理者の設定で鳴らすか決まる (#463)。★ 待ってから戻る (移す前と同じ) */
  push: { kind: 'machine'; post: MachinePost } | Off;
  /** ③ AI 通知 (`message.created`)。★ 待たずに投げる (移す前の #5 と同じ。fireWebhooks は中で失敗を握る) */
  webhook: { kind: 'on'; payload: WebhookPayload } | Off;
  /** ④ リンクプレビュー */
  preview: Off;
}

export async function announcePost(e: PostEffects): Promise<void> {
  getIo().to(e.roomId).emit('message:new', e.emit);
  if (e.push.kind === 'machine') await pushMachinePost(e.push.post);
  if (e.webhook.kind === 'on') fireWebhooks('message.created', e.roomId, e.webhook.payload);
}
