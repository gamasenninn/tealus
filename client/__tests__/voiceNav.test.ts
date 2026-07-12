import { describe, it, expect } from 'vitest';
import { editableVoiceMessages, voiceNav, transcriptionText } from '../src/utils/voiceNav';

const ME = 'user-me';
const OTHER = 'user-other';

function voice(id, sender, status = 'done', extra = {}) {
  return { id, type: 'voice', sender_id: sender, transcription: { status }, ...extra };
}

describe('editableVoiceMessages (#文字起こし連続編集)', () => {
  const messages = [
    { id: 't1', type: 'text', sender_id: ME },
    voice('v1', ME),
    voice('v2', OTHER),
    voice('v3', ME, 'transcribing'), // 未完了 → 除外
    voice('v4', OTHER),
    { id: 'v5', type: 'voice', sender_id: ME, is_deleted: true, transcription: { status: 'done' } }, // 削除 → 除外
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
    expect(nav.current.id).toBe('v1');
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
    expect(transcriptionText({ transcription: { formatted_text: 'F', raw_text: 'R' } })).toBe('F');
    expect(transcriptionText({ transcription: { raw_text: 'R' } })).toBe('R');
    expect(transcriptionText(null)).toBe('');
  });
});
