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
  test('returns null when whisper_context is empty', () => {
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: '',
      vocabulary: [],
    });
    expect(prompt).toBeNull();
  });

  test('returns whisper_context as-is when set', () => {
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: '業務無線です。',
      vocabulary: [],
    });
    expect(prompt).toBe('業務無線です。');
  });

  test('does NOT include vocabulary terms (they are AI-formatting-only)', () => {
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: '業務無線です。',
      vocabulary: [{ term: '甲' }, { term: '乙' }, { term: '丙' }],
    });
    expect(prompt).toBe('業務無線です。');
    expect(prompt).not.toContain('甲');
    expect(prompt).not.toContain('乙');
    expect(prompt).not.toContain('丙');
  });

  test('returns null when whisper_context is missing even if vocabulary is large', () => {
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: '',
      vocabulary: Array.from({ length: 100 }, (_, i) => ({ term: `term${i}` })),
    });
    expect(prompt).toBeNull();
  });

  test('truncates whisper_context to last 200 chars when exceeded', () => {
    const longContext = 'あ'.repeat(250);
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: longContext,
      vocabulary: [],
    });
    expect(prompt.length).toBe(200);
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
