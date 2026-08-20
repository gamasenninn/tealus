import { describe, it, expect } from 'vitest';
import { editableVoiceMessages, voiceNav, transcriptionText, editableAudioAttachmentMessages, navFor } from '../src/utils/voiceNav';
import type { Message } from '../src/types';

const ME = 'user-me';
const OTHER = 'user-other';

function voice(id: string, sender: string, status = 'done', extra: Partial<Message> = {}): Message {
  return { id, type: 'voice', sender_id: sender, transcription: { status } as Message['transcription'], ...extra } as Message;
}

describe('editableVoiceMessages (#文字起こし連続編集)', () => {
  const messages = [
    { id: 't1', type: 'text', sender_id: ME } as Message,
    voice('v1', ME),
    voice('v2', OTHER),
    voice('v3', ME, 'transcribing'), // 未完了 → 除外
    voice('v4', OTHER),
    { id: 'v5', type: 'voice', sender_id: ME, is_deleted: true, transcription: { status: 'done' } } as Message, // 削除 → 除外
  ];

  it('allowMemberEdit=false: 自分の done 音声のみ', () => {
    const list = editableVoiceMessages(messages, ME, false);
    expect(list.map((m) => m.id)).toEqual(['v1']);
  });

  it('allowMemberEdit=true: 全員の done 音声 (未完了/削除は除外)', () => {
    const list = editableVoiceMessages(messages, ME, true);
    expect(list.map((m) => m.id)).toEqual(['v1', 'v2', 'v4']);
  });

  it('messages が配列でなければ空', () => {
    expect(editableVoiceMessages(null, ME, true)).toEqual([]);
  });
});

describe('voiceNav', () => {
  const messages = [voice('v1', OTHER), voice('v2', ME), voice('v3', OTHER)];

  it('先頭: prevId は null、nextId は次', () => {
    const nav = voiceNav(messages, 'v1', ME, true);
    expect(nav.index).toBe(0);
    expect(nav.total).toBe(3);
    expect(nav.prevId).toBeNull();
    expect(nav.nextId).toBe('v2');
    expect(nav.current!.id).toBe('v1');
  });

  it('中間: 前後とも存在', () => {
    const nav = voiceNav(messages, 'v2', ME, true);
    expect(nav.prevId).toBe('v1');
    expect(nav.nextId).toBe('v3');
  });

  it('末尾: nextId は null', () => {
    const nav = voiceNav(messages, 'v3', ME, true);
    expect(nav.prevId).toBe('v2');
    expect(nav.nextId).toBeNull();
  });

  it('対象が list に無い: index -1、prev/next とも null', () => {
    const nav = voiceNav(messages, 'nope', ME, true);
    expect(nav.index).toBe(-1);
    expect(nav.current).toBeNull();
    expect(nav.prevId).toBeNull();
    expect(nav.nextId).toBeNull();
  });

  it('allowMemberEdit=false では自分の音声だけが対象 (他人は飛ばす)', () => {
    const nav = voiceNav(messages, 'v2', ME, false);
    expect(nav.total).toBe(1);
    expect(nav.prevId).toBeNull();
    expect(nav.nextId).toBeNull();
  });
});

describe('transcriptionText', () => {
  it('formatted_text 優先、無ければ raw_text', () => {
    expect(transcriptionText({ transcription: { formatted_text: 'F', raw_text: 'R' } } as Message)).toBe('F');
    expect(transcriptionText({ transcription: { raw_text: 'R' } } as Message)).toBe('R');
    expect(transcriptionText(null)).toBe('');
  });
});

/**
 * #379: 連続編集を 添付音声つきメッセージ でも使うための一覧抽出。
 *
 * ★ 「編集できるか」は右クリックメニュー (useContextMenuItems) と同じ規則を使う。
 *   別ルールを書くと「前/次で送った先が保存時に 403」になり、実行時にしか出ない。
 * ★★ type='voice' は除く —— あちらは既に連続編集を持っており、含めると同じメッセージに
 *   2 系統のナビができて、どちらから開いたかで挙動が変わる。
 */
describe('editableAudioAttachmentMessages (#379)', () => {
  const withAudio = (id: string, senderId = 'other', extra: Record<string, unknown> = {}) => ({
    id, sender_id: senderId, type: 'text', content: 'x', is_deleted: false,
    media: [{ id: `${id}m`, file_path: `${id}.m4a`, mime_type: 'audio/mp4' }],
    ...extra,
  }) as never;

  it('★ 音声添付を持つものだけを拾う', () => {
    const list = [
      withAudio('a'),
      { id: 'b', type: 'text', content: 'y', is_deleted: false, media: [{ id: 'bm', mime_type: 'image/jpeg' }] },
      { id: 'c', type: 'text', content: 'z', is_deleted: false },
    ] as never[];
    expect(editableAudioAttachmentMessages(list, 'u1', 'member').map((m) => m.id)).toEqual(['a']);
  });

  it('★ type=voice は除く (VoiceEditModal の担当)', () => {
    const list = [withAudio('a'), withAudio('v', 'other', { type: 'voice' })] as never[];
    expect(editableAudioAttachmentMessages(list, 'u1', 'member').map((m) => m.id)).toEqual(['a']);
  });

  it('削除済みは除く', () => {
    const list = [withAudio('a'), withAudio('d', 'other', { is_deleted: true })] as never[];
    expect(editableAudioAttachmentMessages(list, 'u1', 'member').map((m) => m.id)).toEqual(['a']);
  });

  it('★ policy=none は 1 件も返さない', () => {
    expect(editableAudioAttachmentMessages([withAudio('a', 'u1')] as never[], 'u1', 'none')).toEqual([]);
  });

  it('★ policy=sender は自分の投稿だけ', () => {
    const list = [withAudio('mine', 'u1'), withAudio('theirs', 'u2')] as never[];
    expect(editableAudioAttachmentMessages(list, 'u1', 'sender').map((m) => m.id)).toEqual(['mine']);
  });

  it('★ policy=member は他人の投稿も含む (bot 投稿の文字起こしを直せること)', () => {
    const list = [withAudio('bot', 'bot-user'), withAudio('mine', 'u1')] as never[];
    expect(editableAudioAttachmentMessages(list, 'u1', 'member').map((m) => m.id)).toEqual(['bot', 'mine']);
  });

  it('並び順は元のメッセージ順のまま', () => {
    const list = [withAudio('c'), withAudio('a'), withAudio('b')] as never[];
    expect(editableAudioAttachmentMessages(list, 'u1', 'member').map((m) => m.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('navFor — 一覧を渡してナビ情報を得る (#379 汎用版)', () => {
  const m = (id: string) => ({ id }) as never;

  it('中間なら前後ともある', () => {
    const r = navFor([m('a'), m('b'), m('c')], 'b');
    expect([r.prevId, r.nextId, r.index, r.total]).toEqual(['a', 'c', 1, 3]);
  });

  it('端は null になる', () => {
    expect(navFor([m('a'), m('b')], 'a').prevId).toBeNull();
    expect(navFor([m('a'), m('b')], 'b').nextId).toBeNull();
  });

  it('一覧に無い id なら current が null', () => {
    expect(navFor([m('a')], 'zzz').current).toBeNull();
  });
});
