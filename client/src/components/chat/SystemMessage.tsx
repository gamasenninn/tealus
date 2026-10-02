import type { Message } from '../../types';
import { formatClockTime } from '../../utils/format';

/**
 * system メッセージ (入退室・通話の開始/終了・スタンプの完成など) を、LINE のように中央に小さく出す (2026-10-02)。
 * ★ 本文と時刻だけ。送り手のアイコン・名前・既読・吹き出し・長押しのメニューは出さない
 *   (以前は普通の吹き出しで、送り手の発言に見えていた)
 * ★ 人やボットの口からは system を名乗れない (サーバの services/messageTypes.mts)。だから「公式の記録」として出してよい
 */
export default function SystemMessage({ message }: { message: Message }) {
  return (
    <div className="system-message" role="note">
      <span className="system-message-text">{message.content}</span>
      <span className="system-message-time">{formatClockTime(message.created_at)}</span>
    </div>
  );
}
