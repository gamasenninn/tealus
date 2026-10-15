import MediaAudio from '../media/MediaAudio';
import type { Message } from '../../types';

/**
 * 添付音声つきメッセージ (通話履歴など) を連続編集モーダル (VoiceEditModal) で直すときの、再生バーと音声 ID の組。
 *
 * ★ 編集画面の再生バーは、裏のトーク画面の吹き出しの再生バーと **別の ID** で合図 (再生 / 一時停止・シーク) を受ける。
 *   同じ添付の id で受けていた頃は、編集画面の Ctrl+Space で裏の吹き出しも一緒に鳴り、
 *   次へ移っても裏が鳴り続けた (2026-10-15 実機)。
 * ★ 別の ID なので「同時に 2 つは鳴らさない」(#380) も効く: 編集画面で鳴らせば裏は止まる
 */
export const editorAudioId = (mediaId: string): string => `edit:${mediaId}`;

const audioOf = (m: Message) => (m.media || []).find((x) => x.mime_type?.startsWith('audio/'));

export const audioAttachmentEditorProps = {
  renderPlayer: (m: Message) => {
    const a = audioOf(m);
    return a ? <MediaAudio key={a.id} media={a} exclusiveId={editorAudioId(a.id)} /> : null;
  },
  // ★ 時刻タグ・10 秒送り・Ctrl+Space の宛先。再生バーと同じ ID を指す
  audioIdOf: (m: Message) => {
    const a = audioOf(m);
    return a ? editorAudioId(a.id) : null;
  },
};
