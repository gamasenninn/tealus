import { useState } from 'react';
import MediaAudio from '../media/MediaAudio';
import TranscriptSeekBar from '../media/TranscriptSeekBar';
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
        {/* ★ 通話履歴の時刻タグへ飛ぶバー。textarea の中の文字は押せないので外に出す */}
        {audios[0] && <TranscriptSeekBar text={text} audioId={audios[0].id} />}
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          /* ★ 6 に揃える (2026-08-29)。12 だとスマホでキーボードが出たとき
             ボタン行が画面外に出た。VoiceEditModal は 6 で収まっており、
             ★ しかも前/次ナビを余分に持つのに収まっている = 差は rows だった。
             ★★ PC では flex:1 (flex-basis:0) が高さを支配するので rows は効かない。
             下げても PC の見た目は変わらない。 */
          rows={6}
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
