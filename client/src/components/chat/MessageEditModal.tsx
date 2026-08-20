import { useState } from 'react';
import MediaAudio from '../media/MediaAudio';
import type { MediaItem } from '../../types';

interface MessageEditModalProps {
  initialText: string;
  /** 対象メッセージの添付。音声だけ再生バーを出す (#378)。省略可 = 従来の呼び出し */
  media?: MediaItem[];
  onConfirm: (text: string) => void | Promise<void>;
  onClose: () => void;
}

/**
 * #344 候補3: メッセージ編集モーダル (MessageBubble から分離)。
 * 本文の編集状態はこのモーダル内に閉じ、確定時に onConfirm(text) を呼ぶ。
 *
 * ★ #378: 添付音声の再生バーをここにも出す。#376 で足したのは ImageGrid (= バブル側)
 *   だけで、モーダルはバブルを覆うため **編集中は音を操作できなかった**。音声メッセージ
 *   (VoiceEditModal) には最初からプレイヤーが付いており、経路による不揃いだった。
 *   条件は mime_type のみ = ルームで分岐しない (通話履歴専用の作りにしない)。
 *
 * ★ 再生位置はバブル側と共有しない (別の audio 要素なので 0 秒から)。共有するには
 *   再生状態を持ち上げる必要があり規模が変わるので、要望が出てから別途。
 */
function MessageEditModal({ initialText, media, onConfirm, onClose }: MessageEditModalProps) {
  const [text, setText] = useState(initialText);
  const audios = (media ?? []).filter((m) => m.mime_type?.startsWith('audio/'));
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box voice-edit-modal message-edit-modal" onClick={e => e.stopPropagation()}>
        <h3>メッセージを編集</h3>
        {/* ★ #380: バブルと同じ部品を使う。markup も 同時再生抑制の配線も 1 か所に持つ */}
        {audios.map((m) => <MediaAudio key={m.id} media={m} />)}
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={12}
          autoFocus
        />
        <div className="voice-edit-buttons">
          <button className="btn-cancel" onClick={onClose}>キャンセル</button>
          <button className="btn-primary" onClick={() => onConfirm(text)} disabled={!text.trim()}>確定</button>
        </div>
      </div>
    </div>
  );
}

export default MessageEditModal;
