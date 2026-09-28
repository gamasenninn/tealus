/**
 * 機械 (is_bot) の投稿の通知 (#463, 2026-09-28)
 *
 * ★ 鳴らすかどうかはルームの管理者が選ぶ (rooms.push_machine_posts、既定は鳴らさない)。
 *   機械の流れは量がルームで大きく違い (トランシーバー履歴 1 日 57 件・通話履歴 33 件・出品写真 18 件)、
 *   全部を既定で鳴らすと、止めたい人が各自でオフにするまで鳴り続けるため (利用者判断)。
 * ★ 連投もまとめずに 1 件ずつ鳴らす (利用者判断)。
 * ★ 各自のオフ (room_members.push_muted) は sendPushToOfflineMembers の中で効く。
 *
 * 呼び出し側は await してよい: 待つのはルームの設定を引く 1 回だけで、送信そのものは待たない。
 * 失敗しても投稿は止めない (ログだけ残す)。
 */
import { pool } from '../db/pool.mts';
import { logger } from '../utils/logger.mts';
import { sendPushToOfflineMembers } from './push.mts';
import { getOnlineUserIds } from '../socket/index.mts';

export interface MachinePost {
  roomId: string;
  senderId: string;
  senderName: string;
  messageId: string;
  body: string;
}

export async function pushMachinePost(post: MachinePost): Promise<void> {
  try {
    const r = await pool.query<{ push_machine_posts: boolean }>(
      'SELECT push_machine_posts FROM rooms WHERE id = $1',
      [post.roomId],
    );
    if (!r.rows[0]?.push_machine_posts) return;
    sendPushToOfflineMembers(post.roomId, post.senderId, {
      title: post.senderName,
      body: post.body,
      data: { roomId: post.roomId, messageId: post.messageId },
    }, new Set(getOnlineUserIds())).catch(() => {});
  } catch (err) {
    logger.warn('機械の投稿の通知に失敗しました (投稿は成功): ' + (err instanceof Error ? err.message : String(err)));
  }
}

/**
 * メディアの通知の本文。本文があれば 1 行目 (LINE なら「氏名@グループ」の送り手ラベル) を前に付ける。
 * ★ LINE 経由は送り手が「LINE Bridge」1 つなので、題名だけでは誰からか分からない
 */
export function mediaPushBody(label: string, content?: string | null): string {
  const head = (content ?? '').split('\n').find((l) => l.trim())?.trim();
  return head ? `${head.slice(0, 60)} ${label}` : label;
}

/** 通知の本文。テキストは先頭 100 字、フォームは JSON を見せない */
export function textPushBody(type: string, content: string): string {
  if (type === 'form') return '📝 フォーム';
  return content.slice(0, 100);
}
