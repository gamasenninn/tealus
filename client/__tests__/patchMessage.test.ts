import { describe, it, expect } from 'vitest';
import { patchMessage } from '../src/stores/patchMessage';
import type { Message } from '../src/types';

/**
 * #346 候補6: messageStore の 7 メソッドが同型で書いていた
 * `messages.map(m => m.id === id ? { ...m, patch } : m)` を畳む純関数。
 *
 * ★ addMessage の重複排除 (`some(m => m.id === ...)`) は再接続時の二重配信を吸収する
 *   装置なので、ここには畳み込まない (docs/05 message:new × reconnect)。
 */
const msg = (id: string, extra: Partial<Message> = {}) =>
  ({ id, content: `body-${id}`, ...extra }) as Message;

describe('patchMessage', () => {
  it('該当 id だけを patch する', () => {
    const out = patchMessage([msg('a'), msg('b')], 'b', { read_count: 3 });
    expect(out[0].read_count).toBeUndefined();
    expect(out[1].read_count).toBe(3);
  });

  it('元の配列とオブジェクトを変更しない (immutable)', () => {
    const before = [msg('a')];
    const out = patchMessage(before, 'a', { read_count: 1 });
    expect(before[0].read_count).toBeUndefined();
    expect(out).not.toBe(before);
    expect(out[0]).not.toBe(before[0]);
  });

  it('該当 id が無ければ全要素の参照を保つ (無駄な再描画を作らない)', () => {
    const before = [msg('a'), msg('b')];
    const out = patchMessage(before, 'zzz', { read_count: 1 });
    expect(out[0]).toBe(before[0]);
    expect(out[1]).toBe(before[1]);
  });

  it('順序を保つ', () => {
    const out = patchMessage([msg('a'), msg('b'), msg('c')], 'b', { is_deleted: true });
    expect(out.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('複数フィールドを同時に patch できる (markDeleted 型)', () => {
    const out = patchMessage([msg('a')], 'a', { is_deleted: true, content: null });
    expect(out[0]).toMatchObject({ is_deleted: true, content: null });
  });

  it('★ 関数 patch で既存値を読める (updateTranscription の部分マージ)', () => {
    const before = [msg('a', { transcription: { status: 'done', raw_text: 'なま' } as never })];
    const out = patchMessage(before, 'a', (m) => ({
      transcription: { ...m.transcription, formatted_text: 'せいけい' } as never,
    }));
    expect(out[0].transcription).toEqual({
      status: 'done', raw_text: 'なま', formatted_text: 'せいけい',
    });
  });
});
