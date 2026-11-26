/**
 * #664 の 3: 文字起こしの知らせは services/voiceTranscriptionEvent.mts の 1 か所から配る
 */
import fs from 'node:fs';
import path from 'node:path';
import { emitVoiceTranscription } from '../../src/services/voiceTranscriptionEvent.mts';

describe('emitVoiceTranscription', () => {
  const make = () => {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    return { io: { to }, to, emit };
  };

  it('部屋へ voice:transcription を、渡した中身のまま配る', () => {
    const { io, to, emit } = make();
    const ev = { message_id: 'm1', status: 'done' as const, raw_text: '生', formatted_text: '整形', version: 2 };
    emitVoiceTranscription(io, 'r1', ev);
    expect(to).toHaveBeenCalledWith('r1');
    expect(emit).toHaveBeenCalledWith('voice:transcription', ev);
  });

  it('io か部屋が無ければ配らない', () => {
    const { io, emit } = make();
    emitVoiceTranscription(null, 'r1', { message_id: 'm1', status: 'formatting', raw_text: '生' });
    emitVoiceTranscription(io, null, { message_id: 'm1', status: 'formatting', raw_text: '生' });
    expect(emit).not.toHaveBeenCalled();
  });

  it('★ src の中で voice:transcription を emit するのはこのファイルだけ', () => {
    const SRC = path.join(__dirname, '../../src');
    const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? files(p) : /\.m?ts$/.test(e.name) ? [p] : [];
    });
    const hits = files(SRC).filter((f) => /emit\(\s*'voice:transcription'/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f).split(path.sep).join('/'));
    expect(hits).toEqual(['services/voiceTranscriptionEvent.mts']);
  });
});
