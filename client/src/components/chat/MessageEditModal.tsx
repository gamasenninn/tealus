import { useState, useRef, useEffect } from 'react';
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
  const boxRef = useRef<HTMLDivElement | null>(null);
  const audios = (media ?? []).filter((m) => m.mime_type?.startsWith('audio/'));

  // ★ 開いた直後のフォーカスは箱に置く (2026-09-05)。詳細は textarea 側のコメント。
  useEffect(() => { boxRef.current?.focus(); }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={boxRef}
        tabIndex={-1}
        className="modal-box voice-edit-modal message-edit-modal"
        onClick={e => e.stopPropagation()}
      >
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
          /* ★ autoFocus を外した (2026-09-05)。スマホで編集を開いた瞬間に仮想キーボードが
             立ち上がり、textarea の**上**にある音声プレイヤーと時刻シークバー (#378 / #398)
             が画面から押し出されていた。通話履歴の修正は「聞きながら直す」ので、
             ★ 聞く方が先に潰れる。タップすれば当然出る — 止めたのは「勝手に出る」だけ。
             ★★ 代わりのフォーカス先は modal-box (上の boxRef)。どこにも当てないと body に
             残り、Tab が裏のトーク画面へ抜ける。確定ボタンには当てない (Enter/Space で誤発火)。
             ★ rows={6} は 8/29 の判断のまま。タップすればキーボードは出るので理由は生きている。 */
          rows={6}
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
