/**
 * ttsSpeak の動作テスト (#189 リファクタ後)。
 *
 * 配信経路:
 *   - browser → pushTtsSpeak (text)
 *   - aivis-cloud + 合成成功 → pushTtsAudio (WAV blob)
 *   - aivis-cloud + 合成失敗 → pushTtsSpeak fallback
 *   - aivis-cloud + Socket.IO POST 失敗 → pushTtsSpeak fallback
 *   - aivis-cloud + AIVIS_API_KEY なし → pushTtsSpeak fallback
 *   - none → no-op
 *
 * TTS_BROADCAST_MEDIASOUP=true 時は sendViaPlainTransport も並走。
 */

jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} }));

const mockSynthesize = jest.fn();
const mockSendViaPlainTransport = jest.fn();
jest.mock('../../src/lib/tts-core.mts', () => ({
  synthesize: (...args: unknown[]) => mockSynthesize(...args),
  sendViaPlainTransport: (...args: unknown[]) => mockSendViaPlainTransport(...args),
}));

const mockSynthesizeOpenai = jest.fn();
jest.mock('../../src/lib/tts-openai.mts', () => ({
  synthesizeOpenai: (...args: unknown[]) => mockSynthesizeOpenai(...args),
}));

const mockSynthesizeGemini = jest.fn();
jest.mock('../../src/lib/tts-gemini.mts', () => ({
  synthesizeGemini: (...args: unknown[]) => mockSynthesizeGemini(...args),
}));

// ★ 2026-09-26 ルームごとのエンジン・声: 読み込みだけ差し替え、決め方 (resolveRoomTts) は本物を使う
const mockReadRoomTtsSettings = jest.fn().mockReturnValue(null);
jest.mock('../../src/lib/ttsRoom.mts', () => ({
  ...jest.requireActual('../../src/lib/ttsRoom.mts'),
  readRoomTtsSettings: (...args: unknown[]) => mockReadRoomTtsSettings(...args),
}));

const mockPushTtsSpeak = jest.fn();
const mockPushTtsAudio = jest.fn();
jest.mock('../../src/lib/botApi.mts', () => ({
  pushTtsSpeak: (...args: unknown[]) => mockPushTtsSpeak(...args),
  pushTtsAudio: (...args: unknown[]) => mockPushTtsAudio(...args),
}));

describe('ttsSpeak speakMessage', () => {
  let originalAivisKey: string | undefined;
  let originalBroadcastMediasoup: string | undefined;

  beforeEach(() => {
    jest.resetModules();
    originalAivisKey = process.env.AIVIS_API_KEY;
    originalBroadcastMediasoup = process.env.TTS_BROADCAST_MEDIASOUP;
    mockSynthesize.mockReset().mockResolvedValue(Buffer.from('fake-wav'));
    mockSendViaPlainTransport.mockReset().mockResolvedValue(undefined);
    mockPushTtsSpeak.mockReset().mockResolvedValue(undefined);
    mockPushTtsAudio.mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    if (originalAivisKey === undefined) delete process.env.AIVIS_API_KEY;
    else process.env.AIVIS_API_KEY = originalAivisKey;
    if (originalBroadcastMediasoup === undefined) delete process.env.TTS_BROADCAST_MEDIASOUP;
    else process.env.TTS_BROADCAST_MEDIASOUP = originalBroadcastMediasoup;
  });

  // 同期完了を待つ helper (queue の processQueue は非同期)
  function flushAsync(ms = 30): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  test('TTS_PROVIDER=browser → pushTtsSpeak のみ', async () => {
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'browser' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'こんにちは');
    await flushAsync();

    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'こんにちは');
    expect(mockPushTtsAudio).not.toHaveBeenCalled();
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  test('TTS_PROVIDER=aivis-cloud + AIVIS_API_KEY 設定済 → synthesize + pushTtsAudio', async () => {
    process.env.AIVIS_API_KEY = 'test-key';
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flushAsync();

    expect(mockSynthesize).toHaveBeenCalled();
    // ★ #444: contentType を明示して渡すようになった。★★ aivis 側は wav のまま (回帰の見張り)
    expect(mockPushTtsAudio).toHaveBeenCalledWith('room-1', expect.any(Buffer), 'audio/wav');
    expect(mockPushTtsSpeak).not.toHaveBeenCalled();
    expect(mockSendViaPlainTransport).not.toHaveBeenCalled(); // BROADCAST_MEDIASOUP デフォルト false
  });

  test('TTS_PROVIDER=aivis-cloud + AIVIS_API_KEY 未設定 → browser に fallback', async () => {
    delete process.env.AIVIS_API_KEY;
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flushAsync();

    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'テスト');
    expect(mockPushTtsAudio).not.toHaveBeenCalled();
  });

  test('aivis-cloud + Aivis 合成失敗 → pushTtsSpeak に fallback', async () => {
    process.env.AIVIS_API_KEY = 'test-key';
    mockSynthesize.mockRejectedValueOnce(new Error('Aivis API error'));
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flushAsync(50);

    expect(mockSynthesize).toHaveBeenCalled();
    expect(mockPushTtsAudio).not.toHaveBeenCalled();
    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'テスト');
  });

  test('aivis-cloud + Socket.IO POST 失敗 → pushTtsSpeak に fallback', async () => {
    process.env.AIVIS_API_KEY = 'test-key';
    mockPushTtsAudio.mockRejectedValueOnce(new Error('Network error'));
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flushAsync(50);

    expect(mockSynthesize).toHaveBeenCalled();
    expect(mockPushTtsAudio).toHaveBeenCalled();
    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'テスト');
  });

  test('TTS_BROADCAST_MEDIASOUP=true → pushTtsAudio + sendViaPlainTransport の両方', async () => {
    process.env.AIVIS_API_KEY = 'test-key';
    process.env.TTS_BROADCAST_MEDIASOUP = 'true';
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flushAsync(50);

    expect(mockPushTtsAudio).toHaveBeenCalled();
    expect(mockSendViaPlainTransport).toHaveBeenCalled();
  });

  test('TTS_PROVIDER=none → 何もしない', async () => {
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'none' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flushAsync();

    expect(mockSynthesize).not.toHaveBeenCalled();
    expect(mockPushTtsAudio).not.toHaveBeenCalled();
    expect(mockPushTtsSpeak).not.toHaveBeenCalled();
  });
});

describe('preprocessText hard cap (Aivis 3000 文字上限)', () => {
  const { preprocessText } = require('../../src/lib/ttsSpeak');

  test('truncate=true: 500 文字超は「以下省略」で短縮 (既存挙動)', () => {
    const out = preprocessText('あ'.repeat(800), { truncate: true });
    expect(out.length).toBeLessThanOrEqual(520);
    expect(out.endsWith('以下省略。')).toBe(true);
  });

  test('truncate=false でも API 上限 (3000) は必ず enforce (422 防止)', () => {
    const out = preprocessText('あ'.repeat(5000), { truncate: false });
    expect(out.length).toBeLessThanOrEqual(3000);
    expect(out.endsWith('以下省略。')).toBe(true);
  });

  test('truncate=false で 3000 字以内ならそのまま全文 (短縮しない)', () => {
    const body = 'これはテストです。'.repeat(100); // 900 文字程度
    const out = preprocessText(body, { truncate: false });
    expect(out.endsWith('以下省略。')).toBe(false);
    expect(out.length).toBeLessThanOrEqual(3000);
  });
});

/**
 * #444 段 1 — TTS_PROVIDER=openai の分岐。
 *
 * ★ aivis-cloud と **同じ形**に乗る: 合成 → pushTtsAudio → Socket.IO 配信。
 *   ★★ 違うのは合成関数と contentType だけ。★★★ fallback / queue / 排他は既存のまま。
 */
describe('ttsSpeak speakMessage — ★ TTS_PROVIDER=openai (#444)', () => {
  let originalOpenaiKey: string | undefined;

  beforeEach(() => {
    jest.resetModules();
    originalOpenaiKey = process.env.OPENAI_API_KEY;
    mockSynthesizeOpenai.mockReset().mockResolvedValue({ buffer: Buffer.from('fake-openai-wav'), contentType: 'audio/wav' });
    mockPushTtsSpeak.mockReset().mockResolvedValue(undefined);
    mockPushTtsAudio.mockReset().mockResolvedValue({ ok: true });
    mockSynthesize.mockReset().mockResolvedValue(Buffer.from('fake-wav'));
  });

  afterEach(() => {
    if (originalOpenaiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenaiKey;
  });

  function flush(ms = 30): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

  test('openai + OPENAI_API_KEY 設定済 → ★ synthesizeOpenai + pushTtsAudio (contentType つき)', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flush();

    expect(mockSynthesizeOpenai).toHaveBeenCalled();
    expect(mockSynthesize).not.toHaveBeenCalled();            // ★ Aivis は叩かない
    expect(mockPushTtsAudio).toHaveBeenCalledWith('room-1', expect.any(Buffer), 'audio/wav');
    expect(mockPushTtsSpeak).not.toHaveBeenCalled();
  });

  test('openai + 合成失敗 → ★ browser に fallback (★★ aivis と同じ形)', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockSynthesizeOpenai.mockRejectedValueOnce(new Error('OpenAI 500'));
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flush(50);

    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'テスト');
    expect(mockPushTtsAudio).not.toHaveBeenCalled();
  });

  test('★★★★ openai は読みを当ててから合成する (#446) —— ★ 鹿沼 → カヌマ', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', '鹿沼の現場に行きます');
    await flush();

    expect(mockSynthesizeOpenai).toHaveBeenCalledWith('カヌマの現場に行きます', expect.any(Object));
  });

  test('★★★★ aivis は読みを当てない (#446) —— ★ Aivis は正しく読めるので触らない', async () => {
    process.env.AIVIS_API_KEY = 'test-key';
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', '鹿沼の現場に行きます');
    await flush();

    // ★ 原文のまま渡る (★★ 置換して壊す理由が無い)
    expect(mockSynthesize).toHaveBeenCalledWith('鹿沼の現場に行きます', expect.anything());
    expect(mockSynthesizeOpenai).not.toHaveBeenCalled();
  });

  test('★★ openai + OPENAI_API_KEY 未設定 → browser に fallback (★ 黙って止まらない)', async () => {
    delete process.env.OPENAI_API_KEY;
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'openai', OPENAI_API_KEY: '' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flush();

    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'テスト');
    expect(mockSynthesizeOpenai).not.toHaveBeenCalled();
    expect(mockPushTtsAudio).not.toHaveBeenCalled();
  });
});

/**
 * #444 段 2 — ★ 合成の分岐を **1 か所**に集約する (synthesizeByEngine)。
 *
 * ★★ 自動読み上げ (processQueue) と 手動ボタン (routes/tts.mts) が
 *   **同じ関数**を呼ぶ形にする。★★★ 記憶「同じ仕事が 2 か所にあると壊れを隠す」。
 *   → ★ 読みを当てるかどうかも ここ 1 か所で決まる。
 */
describe('synthesizeByEngine — ★ 分岐は 1 か所 (#444 段 2)', () => {
  beforeEach(() => {
    jest.resetModules();
    mockSynthesize.mockReset().mockResolvedValue(Buffer.from('aivis-wav'));
    mockSynthesizeOpenai.mockReset().mockResolvedValue({ buffer: Buffer.from('openai-wav'), contentType: 'audio/wav' });
  });

  test('aivis → ★ tts-core で合成し contentType は audio/wav。★★ 読みは当てない', async () => {
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    const { synthesizeByEngine } = require('../../src/lib/ttsSpeak');
    const got = await synthesizeByEngine('aivis', '鹿沼へ行く', 'uuid-1');

    // ★ 原文のまま。★★ ttsSpeak.synthesize は tts-core に {modelUuid, apiKey} で渡す
    expect(mockSynthesize).toHaveBeenCalledWith('鹿沼へ行く', expect.objectContaining({ modelUuid: 'uuid-1' }));
    expect(mockSynthesizeOpenai).not.toHaveBeenCalled();
    expect(got.contentType).toBe('audio/wav');
    expect(got.buffer.toString()).toBe('aivis-wav');
  });

  test('★★★★ openai → 読みを当ててから合成し、contentType は合成結果のものを使う', async () => {
    mockSynthesizeOpenai.mockResolvedValueOnce({ buffer: Buffer.from('x'), contentType: 'audio/mpeg' });
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'openai', OPENAI_API_KEY: 'k' }));
    const { synthesizeByEngine } = require('../../src/lib/ttsSpeak');
    const got = await synthesizeByEngine('openai', '鹿沼へ行く');

    expect(mockSynthesizeOpenai).toHaveBeenCalledWith('カヌマへ行く', expect.any(Object));
    expect(mockSynthesize).not.toHaveBeenCalled();
    expect(got.contentType).toBe('audio/mpeg');   // ★ wav 固定にしない
  });

  /**
   * ★ 「鍵なし → throw」は **ここでは書かない。**
   *   ★★ synthesizeOpenai をモックしているので、書いても **モックを試すだけ**になる。
   *   ★★★ 実物の throw は ttsOpenai.test.mts で固定済み
   *   (「apiKey が無ければ fetch を叩かずに throw する」)。
   * → ★ この層で固定すべきなのは **config の鍵がそのまま渡ること**。
   */
  test('★★ config の OPENAI_API_KEY がそのまま合成に渡る', async () => {
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'openai', OPENAI_API_KEY: 'key-from-config' }));
    const { synthesizeByEngine } = require('../../src/lib/ttsSpeak');
    await synthesizeByEngine('openai', 'テスト');

    expect(mockSynthesizeOpenai).toHaveBeenCalledWith(
      'テスト',
      expect.objectContaining({ apiKey: 'key-from-config' }),
    );
  });
});

/**
 * 2026-09-26 — TTS_PROVIDER=gemini (Gemini 3.8 Flash-Lite TTS)。
 *
 * ★ openai と **同じ形**に乗る: 合成 → pushTtsAudio → Socket.IO 配信 / 失敗は browser に fallback。
 * ★★ 読みも openai と同じく当てる —— 利用者の聞き比べで Gemini も 7俵 を読み違えた (Flash「ななたま」、Lite 3 回中 2 回)。
 * ★★★ 'gemini' も自動判定には入れない (GOOGLE_API_KEY の有無で全採用者の声が黙って変わるのを防ぐ)。
 */
describe('ttsSpeak speakMessage — ★ TTS_PROVIDER=gemini', () => {
  beforeEach(() => {
    jest.resetModules();
    mockSynthesizeGemini.mockReset().mockResolvedValue({ buffer: Buffer.from('fake-gemini-wav'), contentType: 'audio/wav' });
    mockSynthesizeOpenai.mockReset();
    mockPushTtsSpeak.mockReset().mockResolvedValue(undefined);
    mockPushTtsAudio.mockReset().mockResolvedValue({ ok: true });
    mockSynthesize.mockReset().mockResolvedValue(Buffer.from('fake-wav'));
  });

  function flush(ms = 30): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

  test('gemini + GOOGLE_API_KEY 設定済 → ★ synthesizeGemini + pushTtsAudio', async () => {
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'gemini', GOOGLE_API_KEY: 'g-key' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flush();

    expect(mockSynthesizeGemini).toHaveBeenCalledWith('テスト', expect.objectContaining({ apiKey: 'g-key' }));
    expect(mockSynthesize).not.toHaveBeenCalled();
    expect(mockSynthesizeOpenai).not.toHaveBeenCalled();
    expect(mockPushTtsAudio).toHaveBeenCalledWith('room-1', expect.any(Buffer), 'audio/wav');
  });

  test('★★ gemini も読みを当ててから合成する —— ★ 鹿沼 → カヌマ', async () => {
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'gemini', GOOGLE_API_KEY: 'g-key' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', '鹿沼の現場に行きます');
    await flush();

    expect(mockSynthesizeGemini).toHaveBeenCalledWith('カヌマの現場に行きます', expect.any(Object));
  });

  test('gemini + 合成失敗 → ★ browser に fallback', async () => {
    mockSynthesizeGemini.mockRejectedValueOnce(new Error('Gemini 500'));
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'gemini', GOOGLE_API_KEY: 'g-key' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flush(50);

    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'テスト');
    expect(mockPushTtsAudio).not.toHaveBeenCalled();
  });

  test('★★ gemini + GOOGLE_API_KEY 未設定 → browser に fallback (★ 黙って止まらない)', async () => {
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'gemini', GOOGLE_API_KEY: '' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flush();

    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'テスト');
    expect(mockSynthesizeGemini).not.toHaveBeenCalled();
  });

  test('★ synthesizeByEngine("gemini") → 読みを当て、config の鍵を渡す (★★ 手動ボタンもここを通る)', async () => {
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'gemini', GOOGLE_API_KEY: 'key-from-config' }));
    const { synthesizeByEngine } = require('../../src/lib/ttsSpeak');
    const got = await synthesizeByEngine('gemini', '鹿沼へ行く');

    expect(mockSynthesizeGemini).toHaveBeenCalledWith('カヌマへ行く', expect.objectContaining({ apiKey: 'key-from-config' }));
    expect(got.contentType).toBe('audio/wav');
  });
});

/**
 * ★ provider → engine の対応は 1 か所 (2026-09-26)。★★ 手動ボタン (routes/tts.mts) がこれを使う。
 *   以前はルートの中に三項演算子で書いてあり、テストが 1 本も無かった (openai の時から)。
 */
describe('engineForProvider — ★ 手動ボタンの engine 選び', () => {
  beforeEach(() => { jest.resetModules(); jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'aivis-cloud' })); });

  test.each([
    ['openai', 'openai'],
    ['gemini', 'gemini'],
    ['aivis-cloud', 'aivis'],
    ['browser', 'aivis'],   // ★ 手動ボタンの REST 経路は、browser の時はクライアント側で使われない (既存どおり aivis)
  ])('%s → %s', (provider, engine) => {
    const { engineForProvider } = require('../../src/lib/ttsSpeak');
    expect(engineForProvider(provider)).toBe(engine);
  });
});

/**
 * 2026-09-26 — ★ 印は読み上げない (利用者: 「★★・・・があるとそれを変に読んでしまう」)。
 *   ★ AI 班の投稿は「★★ 結論」のように強調に ★ を重ねるので、そのまま渡すと「ほしほし」等と読まれる。
 *   ★★ 保存される本文は変えない。TTS に渡す文だけ (Markdown の記号を剥がすのと同じ場所)。
 */
describe('preprocessText — ★ 印を取り除く', () => {
  const { preprocessText } = require('../../src/lib/ttsSpeak');

  test('★ 行頭の ★ の連なりと、後ろの空白を取る', () => {
    expect(preprocessText('★★ 結論です')).toBe('結論です');
  });

  test('☆ も取る / 文中の ★ も取る', () => {
    expect(preprocessText('☆注意 と ★★★★ 重要')).toBe('注意 と 重要');
  });

  test('★ と太字が重なっていても本文だけ残る', () => {
    expect(preprocessText('★★★ **本番は Aivis**')).toBe('本番は Aivis');
  });

  test('★ しか無いメッセージは読まない (null)', () => {
    expect(preprocessText('★★★')).toBeNull();
  });

  test('★ の無い文は変わらない', () => {
    expect(preprocessText('鹿沼へ 7俵 運ぶ')).toBe('鹿沼へ 7俵 運ぶ');
  });
});

/**
 * 2026-09-26 — ★ ルームごとのエンジン・声 (利用者判断「案 B」)。
 *   それまでルームの声の選択は Aivis 専用で、全体が OpenAI / Gemini のときは黙って無視されていた。
 */
describe('speakMessage — ★ ルームの設定 (エンジン・声) に従う', () => {
  beforeEach(() => {
    jest.resetModules();
    mockReadRoomTtsSettings.mockReset().mockReturnValue(null);
    mockSynthesize.mockReset().mockResolvedValue(Buffer.from('aivis-wav'));
    mockSynthesizeOpenai.mockReset().mockResolvedValue({ buffer: Buffer.from('oa'), contentType: 'audio/wav' });
    mockSynthesizeGemini.mockReset().mockResolvedValue({ buffer: Buffer.from('gm'), contentType: 'audio/wav' });
    mockPushTtsSpeak.mockReset().mockResolvedValue(undefined);
    mockPushTtsAudio.mockReset().mockResolvedValue({ ok: true });
  });
  function flush(ms = 30): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

  test('★ 全体が openai でも、ルームが gemini + Aoede なら Gemini の Aoede で読む', async () => {
    mockReadRoomTtsSettings.mockReturnValue({ tts_engine: 'gemini', tts_voice: 'Aoede' });
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'openai', OPENAI_API_KEY: 'o', GOOGLE_API_KEY: 'g' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-9', 'テスト');
    await flush();

    expect(mockReadRoomTtsSettings).toHaveBeenCalledWith('room-9');
    expect(mockSynthesizeGemini).toHaveBeenCalledWith('テスト', expect.objectContaining({ voice: 'Aoede', apiKey: 'g' }));
    expect(mockSynthesizeOpenai).not.toHaveBeenCalled();
  });

  test('★ ルームの声 (openai の cedar) が合成に渡る', async () => {
    mockReadRoomTtsSettings.mockReturnValue({ tts_voice: 'cedar' });
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'openai', OPENAI_API_KEY: 'o' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-9', 'テスト');
    await flush();

    expect(mockSynthesizeOpenai).toHaveBeenCalledWith('テスト', expect.objectContaining({ voice: 'cedar' }));
  });

  test('★ ルームの声が無ければ .env の声 (★ undefined を渡さず既定に任せる)', async () => {
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'openai', OPENAI_API_KEY: 'o' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-9', 'テスト');
    await flush();

    const opts = mockSynthesizeOpenai.mock.calls[0][1] as { voice?: string };
    expect(opts.voice).toBeTruthy();   // ★ OPENAI_TTS_VOICE か既定 marin
  });

  test('★★ 全体が browser なら、ルームが openai でも browser (★ 端末の動きと食い違わせない)', async () => {
    mockReadRoomTtsSettings.mockReturnValue({ tts_engine: 'openai' });
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'browser', OPENAI_API_KEY: 'o' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-9', 'テスト');
    await flush();

    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-9', 'テスト');
    expect(mockSynthesizeOpenai).not.toHaveBeenCalled();
  });

  test('★★ ルームが gemini でも鍵が無ければ browser に fallback (★ 黙って止まらない)', async () => {
    mockReadRoomTtsSettings.mockReturnValue({ tts_engine: 'gemini' });
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'openai', OPENAI_API_KEY: 'o', GOOGLE_API_KEY: '' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-9', 'テスト');
    await flush();

    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-9', 'テスト');
    expect(mockSynthesizeGemini).not.toHaveBeenCalled();
  });

  test('★ 全体が openai でもルームが aivis なら、ルームの tts_model_uuid で Aivis', async () => {
    process.env.AIVIS_API_KEY = 'a';
    mockReadRoomTtsSettings.mockReturnValue({ tts_engine: 'aivis', tts_model_uuid: 'uuid-room' });
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'openai', OPENAI_API_KEY: 'o' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-9', 'テスト');
    await flush();

    expect(mockSynthesize).toHaveBeenCalledWith('テスト', expect.objectContaining({ modelUuid: 'uuid-room' }));
    expect(mockSynthesizeOpenai).not.toHaveBeenCalled();
  });
});

