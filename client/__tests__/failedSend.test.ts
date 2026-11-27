/**
 * #619 音声・写真の送信に失敗したとき、手元に残して「もう一度送る」。
 * ★ 送れていたのに返事だけ来なかった (電波が途中で切れた) ときに二重に送らないよう、
 *   もう一度送る前に部屋を読み直し、失敗した時点より後に自分の同じ種類の投稿があれば送らない
 */
import { describe, it, expect } from 'vitest';
import { arrivedAfter, lastMessageId } from '../src/services/failedSend';

const m = (id: string, sender_id: string, type: string) => ({ id, sender_id, type });

describe('lastMessageId — 送る前の部屋の最後の投稿', () => {
  it('並びの最後の id。空なら null', () => {
    expect(lastMessageId([m('a', 'u1', 'text'), m('b', 'u2', 'text')])).toBe('b');
    expect(lastMessageId([])).toBeNull();
  });
});

describe('arrivedAfter — 失敗した便が実は届いていたか', () => {
  const before = [m('a', 'u1', 'text'), m('b', 'u2', 'voice')];

  it('★★ 送る前の最後の投稿より後に、自分の音声があれば届いていた', () => {
    expect(arrivedAfter([...before, m('c', 'me', 'voice')], 'b', 'me', 'voice')).toBe(true);
  });

  it('★ 後に何も無ければ届いていない', () => {
    expect(arrivedAfter(before, 'b', 'me', 'voice')).toBe(false);
  });

  it('★ 前からあった自分の音声は数えない (送る前の最後より前)', () => {
    expect(arrivedAfter([m('x', 'me', 'voice'), ...before], 'b', 'me', 'voice')).toBe(false);
  });

  it('ほかの人の音声・自分の文字は数えない', () => {
    expect(arrivedAfter([...before, m('c', 'u2', 'voice'), m('d', 'me', 'text')], 'b', 'me', 'voice')).toBe(false);
  });

  it('★ 写真・動画・ファイル (media) は image / video / file のどれでも届いていた', () => {
    expect(arrivedAfter([...before, m('c', 'me', 'image')], 'b', 'me', 'media')).toBe(true);
    expect(arrivedAfter([...before, m('c', 'me', 'video')], 'b', 'me', 'media')).toBe(true);
    expect(arrivedAfter([...before, m('c', 'me', 'file')], 'b', 'me', 'media')).toBe(true);
    expect(arrivedAfter([...before, m('c', 'me', 'voice')], 'b', 'me', 'media')).toBe(false);
  });

  it('送る前に部屋が空だった (null) なら、全部が「後」', () => {
    expect(arrivedAfter([m('c', 'me', 'voice')], null, 'me', 'voice')).toBe(true);
  });

  it('送る前の最後の投稿が読み直した中に無い (間に 1 ページ分より多く投稿があった) なら、確かめられないので false', () => {
    expect(arrivedAfter([m('c', 'me', 'voice')], 'gone', 'me', 'voice')).toBe(false);
  });
});
