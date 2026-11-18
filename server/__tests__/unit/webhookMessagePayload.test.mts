/**
 * AI へ渡す `message.created` の message 部分を 1 か所で作る (改善ループ 66、#649 A-4)
 *
 * ★ 以前は送る所 4 か所 (socket の投稿・音声・転送・Bot の投稿) がそれぞれ手で組み立てていて、形がばらばらだった。
 *   受け側 (agent-server の types.mts) が当てにしている添付 (media) と作った時刻 (created_at) は、どこからも送られていなかった。
 *   そのため転送されたファイルの便は、AI から見るとファイル名が「不明なファイル」になった
 */
import fs from 'node:fs';
import path from 'node:path';
import { webhookMessage } from '../../src/services/webhookMessage.mts';

const SENDER = { id: 'u1', display_name: '田中' };

describe('webhookMessage', () => {
  it('★ 作った時刻と、添付のファイル名・種類を載せる (中身や置き場の道は載せない)', () => {
    const m = webhookMessage({
      message: { id: 'm1', type: 'file', content: null, created_at: '2026-11-18T07:00:00.000Z',
        media: [{ file_name: '見積.pdf', mime_type: 'application/pdf', file_size: 1234, file_path: 'files/x.pdf' }] },
      sender: SENDER,
    });
    expect(m).toEqual({
      id: 'm1', type: 'file', content: null, created_at: '2026-11-18T07:00:00.000Z',
      reply_to: null, reply_to_message: null,
      media: [{ file_name: '見積.pdf', mime_type: 'application/pdf', file_size: 1234 }],
      sender: SENDER,
    });
  });

  it('作った時刻が Date でも ISO の文字にする', () => {
    const m = webhookMessage({ message: { id: 'm1', type: 'text', content: 'a', created_at: new Date('2026-11-18T07:00:00Z') }, sender: SENDER });
    expect(m.created_at).toBe('2026-11-18T07:00:00.000Z');
  });

  it('返信・転送の元を載せる。添付が無ければ media は付けない', () => {
    const m = webhookMessage({
      message: { id: 'm2', type: 'text', content: 'はい', created_at: '2026-11-18T07:00:00.000Z', reply_to: 'm0',
        reply_to_message: { id: 'm0', content: '元' } },
      sender: SENDER, forwardedFrom: 'm9',
    });
    expect(m.reply_to).toBe('m0');
    expect(m.reply_to_message).toEqual({ id: 'm0', content: '元' });
    expect(m.forwarded_from).toBe('m9');
    expect(m).not.toHaveProperty('media');
  });

  it('★ 送る 4 か所は、すべてこの関数で作る (手で組み立てると、また形がずれる)', () => {
    const SRC = path.join(import.meta.dirname, '../../src');
    for (const rel of ['socket/handlers/message.mts', 'routes/voice.mts', 'routes/media.mts', 'services/postAsUser.mts']) {
      const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
      expect([rel, /message:\s*webhookMessage\(/.test(text)]).toEqual([rel, true]);
    }
  });
});
