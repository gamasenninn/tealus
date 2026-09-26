/**
 * ルームごとの読み上げエンジン・声の決め方 (2026-09-26、利用者判断「案 B: ルームごとに切り替える」)。
 *
 * ★ 決め方:
 *   全体 (TTS_PROVIDER) が browser / none → ルームの設定は効かない
 *     (端末は起動時に全体の設定を見て動き方を決める。ルームだけサーバの声にすると読み上げボタンと食い違う)
 *   それ以外 → ルームの tts_engine があればそれ、無ければ全体のエンジン
 *   声: そのエンジンの一覧に在るときだけ使う (★ エンジンを替えたあとに前の声が残っていても壊れない)
 *   Aivis の声は今までどおり tts_model_uuid (★ 既存の設定をそのまま生かす)
 */
import { resolveRoomTts, TTS_VOICES, TTS_ENGINES } from '../../src/lib/ttsRoom.mts';

describe('resolveRoomTts — ★ ルームの設定から、どのエンジン・声で読むかを決める', () => {
  test('ルームに設定が無ければ全体のエンジン (openai)', () => {
    expect(resolveRoomTts('openai', {})).toEqual({ mode: 'server', engine: 'openai' });
  });

  test('★ ルームの tts_engine が全体より優先', () => {
    expect(resolveRoomTts('openai', { tts_engine: 'gemini' })).toEqual({ mode: 'server', engine: 'gemini' });
  });

  test('★ 声はそのエンジンの一覧に在るときだけ使う', () => {
    expect(resolveRoomTts('openai', { tts_engine: 'gemini', tts_voice: 'Aoede' })).toEqual({ mode: 'server', engine: 'gemini', voice: 'Aoede' });
    // ★ openai の声 (marin) を gemini に渡さない = エンジンを替えたあとに残った声で壊れない
    expect(resolveRoomTts('openai', { tts_engine: 'gemini', tts_voice: 'marin' })).toEqual({ mode: 'server', engine: 'gemini' });
  });

  test('★ Aivis は今までどおり tts_model_uuid を使う (★ 既存のルーム設定を生かす)', () => {
    expect(resolveRoomTts('aivis-cloud', { tts_model_uuid: 'uuid-x' })).toEqual({ mode: 'server', engine: 'aivis', modelUuid: 'uuid-x' });
    expect(resolveRoomTts('openai', { tts_engine: 'aivis', tts_model_uuid: 'uuid-x' })).toEqual({ mode: 'server', engine: 'aivis', modelUuid: 'uuid-x' });
  });

  test('★ Aivis 以外のときは tts_model_uuid を使わない (★ 今まで黙って無視されていたのと同じ結果を、形で示す)', () => {
    expect(resolveRoomTts('openai', { tts_model_uuid: 'uuid-x' })).toEqual({ mode: 'server', engine: 'openai' });
  });

  test('★★ 全体が browser / none ならルームの設定は効かない', () => {
    expect(resolveRoomTts('browser', { tts_engine: 'openai' })).toEqual({ mode: 'browser' });
    expect(resolveRoomTts('none', { tts_engine: 'gemini' })).toEqual({ mode: 'none' });
  });

  test('知らないエンジン名は無視して全体に従う', () => {
    expect(resolveRoomTts('openai', { tts_engine: 'elevenlabs' })).toEqual({ mode: 'server', engine: 'openai' });
  });

  test('ルーム設定が null / undefined でも落ちない', () => {
    expect(resolveRoomTts('gemini', null)).toEqual({ mode: 'server', engine: 'gemini' });
    expect(resolveRoomTts(undefined, undefined)).toEqual({ mode: 'server', engine: 'aivis' });
  });
});

describe('TTS_VOICES / TTS_ENGINES — ★ 一覧は 1 か所 (ダッシュボードはここから受け取る)', () => {
  test('エンジンは aivis / openai / gemini', () => {
    expect(TTS_ENGINES.map((e) => e.id)).toEqual(['aivis', 'openai', 'gemini']);
  });

  test('★ Aivis はダッシュボードに書いてあった 10 種 (凛音エル = 既定 UUID を含む)', () => {
    expect(TTS_VOICES.aivis).toHaveLength(10);
    expect(TTS_VOICES.aivis.map((v) => v.id)).toContain('f5017410-fbb5-49e1-97cb-e785f42e15f5');
  });

  test('★ OpenAI は gpt-4o-mini-tts の 13 種 (公式ドキュメント 2026-09-26)', () => {
    expect(TTS_VOICES.openai.map((v) => v.id)).toEqual(
      ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'],
    );
  });

  test('★ Gemini は 30 種 (Kore を含む)', () => {
    expect(TTS_VOICES.gemini).toHaveLength(30);
    expect(TTS_VOICES.gemini.map((v) => v.id)).toContain('Kore');
  });
});
