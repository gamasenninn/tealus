/**
 * transcriptionConfig ユニットテスト
 * 設定ファイル読込・Whisper prompt 構築・AI 整形 prompt 拡張のロジック
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

let configModule;
let tmpFile;

function loadFresh() {
  jest.resetModules();
  configModule = require('../../src/services/transcriptionConfig');
}

beforeEach(() => {
  tmpFile = path.join(os.tmpdir(), `tealus-test-guideline-${process.pid}-${Date.now()}.json`);
  process.env.TRANSCRIPTION_GUIDELINE_PATH = tmpFile;
  loadFresh();
});

afterEach(() => {
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  delete process.env.TRANSCRIPTION_GUIDELINE_PATH;
});

describe('loadGuideline', () => {
  test('returns empty defaults when file does not exist', () => {
    const config = configModule.loadGuideline();
    expect(config).toEqual({
      version: 1,
      whisper_context: '',
      vocabulary: [],
      guidelines: [],
    });
  });

  test('loads valid JSON file', () => {
    fs.writeFileSync(tmpFile, JSON.stringify({
      version: 1,
      whisper_context: 'これは業務無線です。',
      vocabulary: [{ term: 'A', category: 'person' }],
      guidelines: ['ルール 1'],
    }));
    const config = configModule.loadGuideline();
    expect(config.whisper_context).toBe('これは業務無線です。');
    expect(config.vocabulary).toHaveLength(1);
    expect(config.guidelines).toEqual(['ルール 1']);
  });

  test('returns empty defaults when file is malformed JSON', () => {
    fs.writeFileSync(tmpFile, '{ broken json');
    const config = configModule.loadGuideline();
    expect(config.vocabulary).toEqual([]);
    expect(config.guidelines).toEqual([]);
  });

  test('coerces non-array vocabulary/guidelines to empty arrays', () => {
    fs.writeFileSync(tmpFile, JSON.stringify({
      vocabulary: 'not-an-array',
      guidelines: null,
    }));
    const config = configModule.loadGuideline();
    expect(config.vocabulary).toEqual([]);
    expect(config.guidelines).toEqual([]);
  });

  test('caches result across multiple calls', () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ vocabulary: [{ term: 'A' }] }));
    const a = configModule.loadGuideline();
    fs.writeFileSync(tmpFile, JSON.stringify({ vocabulary: [{ term: 'B' }] }));
    const b = configModule.loadGuideline();
    expect(a).toBe(b);
    expect(b.vocabulary[0].term).toBe('A');
  });
});

describe('buildWhisperPrompt', () => {
  afterEach(() => {
    delete process.env.WHISPER_VOCAB_INJECT_MODELS;
  });

  test('returns null when whisper_context is empty', () => {
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: '',
      vocabulary: [],
    });
    expect(prompt).toBeNull();
  });

  test('returns whisper_context as-is when set (no model passed)', () => {
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: '業務無線です。',
      vocabulary: [],
    });
    expect(prompt).toBe('業務無線です。');
  });

  test('does NOT include vocabulary when model is not in VOCAB_INJECT_MODELS (default: gpt-4o-transcribe)', () => {
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: '業務無線です。',
      vocabulary: [{ term: '甲' }, { term: '乙' }, { term: '丙' }],
    }, 'gpt-4o-transcribe');
    expect(prompt).toBe('業務無線です。');
    expect(prompt).not.toContain('甲');
  });

  test('does NOT include vocabulary for whisper-1 (legacy bias risk)', () => {
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: '業務無線です。',
      vocabulary: [{ term: '甲' }],
    }, 'whisper-1');
    expect(prompt).toBe('業務無線です。');
    expect(prompt).not.toContain('甲');
  });

  test('does NOT include vocabulary when no model passed (backward compat)', () => {
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: '業務無線です。',
      vocabulary: [{ term: '甲' }],
    });
    expect(prompt).toBe('業務無線です。');
    expect(prompt).not.toContain('甲');
  });

  test('INCLUDES vocabulary for gpt-4o-mini-transcribe (#269 Phase 2、5/9 verify)', () => {
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: '業務無線です。',
      vocabulary: [{ term: '冷蔵コンテナ' }, { term: 'アシストさん' }],
    }, 'gpt-4o-mini-transcribe');
    expect(prompt).toContain('業務無線です。');
    expect(prompt).toContain('冷蔵コンテナ');
    expect(prompt).toContain('アシストさん');
    expect(prompt).toContain('用語:');
  });

  test('vocab inject works with empty whisper_context (gpt-4o-mini-transcribe)', () => {
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: '',
      vocabulary: [{ term: '甲' }, { term: '乙' }],
    }, 'gpt-4o-mini-transcribe');
    expect(prompt).toBe('用語: 甲、乙');
  });

  test('returns null when whisper_context empty + vocabulary empty (any model)', () => {
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: '',
      vocabulary: [],
    }, 'gpt-4o-mini-transcribe');
    expect(prompt).toBeNull();
  });

  test('env WHISPER_VOCAB_INJECT_MODELS で list 拡張可能', () => {
    process.env.WHISPER_VOCAB_INJECT_MODELS = 'gpt-4o-transcribe,gpt-4o-mini-transcribe';
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: '業務無線です。',
      vocabulary: [{ term: '甲' }],
    }, 'gpt-4o-transcribe');
    expect(prompt).toContain('甲');
  });

  test('legacy model (no model passed): truncates to 200 chars from start', () => {
    const longContext = 'あ'.repeat(250);
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: longContext,
      vocabulary: [],
    });
    expect(prompt.length).toBe(200);
  });

  test('legacy model (whisper-1): truncates to 200 chars', () => {
    const longContext = 'あ'.repeat(250);
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: longContext,
      vocabulary: [],
    }, 'whisper-1');
    expect(prompt.length).toBe(200);
  });

  test('new gen (gpt-4o-mini-transcribe): truncates to 2000 chars, not 200', () => {
    const longContext = 'あ'.repeat(2500);
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: longContext,
      vocabulary: [],
    }, 'gpt-4o-mini-transcribe');
    expect(prompt.length).toBe(2000);
  });

  test('new gen (gpt-4o-transcribe): 2000 char 上限', () => {
    const longContext = 'あ'.repeat(2500);
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: longContext,
      vocabulary: [],
    }, 'gpt-4o-transcribe');
    expect(prompt.length).toBe(2000);
  });

  test('vocab inject + 新世代 model で whisper_context 冒頭が保持される (slice(0, N))', () => {
    // 旧実装 slice(-200) では whisper_context 冒頭が削れていた問題の regression
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: 'これは農機販売店の業務無線です。',
      vocabulary: Array.from({ length: 37 }, (_, i) => ({ term: `用語${i}` })),
    }, 'gpt-4o-mini-transcribe');
    expect(prompt.startsWith('これは農機販売店の業務無線です。')).toBe(true);
  });

  test('vocab inject 全 37 term が 2000 char 上限内に収まる (実 dataset 想定)', () => {
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: 'これは農機販売店の業務無線の音声記録です。',
      vocabulary: Array.from({ length: 37 }, (_, i) => ({ term: `用語${i}` })),
    }, 'gpt-4o-mini-transcribe');
    expect(prompt).toContain('用語0');
    expect(prompt).toContain('用語36');
    expect(prompt.length).toBeLessThan(2000);
  });
});

describe('buildFormattingExtension', () => {
  test('returns empty string when config is empty', () => {
    const ext = configModule.buildFormattingExtension({
      vocabulary: [],
      guidelines: [],
    });
    expect(ext).toBe('');
  });

  test('builds vocabulary section with category and aliases', () => {
    const ext = configModule.buildFormattingExtension({
      vocabulary: [
        { term: '甲', category: 'person', aliases: ['コウ', 'こう'] },
      ],
      guidelines: [],
    });
    expect(ext).toContain('組織固有語彙');
    expect(ext).toContain('[person] 甲');
    expect(ext).toContain('転写ブレ例: コウ, こう');
  });

  test('builds guidelines section', () => {
    const ext = configModule.buildFormattingExtension({
      vocabulary: [],
      guidelines: ['ルール A', 'ルール B'],
    });
    expect(ext).toContain('追加ガイドライン');
    expect(ext).toContain('- ルール A');
    expect(ext).toContain('- ルール B');
  });

  test('builds both sections when present', () => {
    const ext = configModule.buildFormattingExtension({
      vocabulary: [{ term: '甲' }],
      guidelines: ['ルール A'],
    });
    expect(ext).toContain('組織固有語彙');
    expect(ext).toContain('追加ガイドライン');
  });
});
