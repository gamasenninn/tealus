/**
 * transcriptionConfig ユニットテスト
 * 設定ファイル読込・Whisper prompt 構築・AI 整形 prompt 拡張のロジック
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let configModule: any;
let tmpFile: string;

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

  // #286 follow-up: ファイル更新を mtime で自動検知し reload (admin token / endpoint 不要に)
  test('auto-reloads when file mtime changes (no resetCache / endpoint needed)', () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ version: 1, vocabulary: [{ term: 'A' }], guidelines: [] }));
    expect(configModule.loadGuideline().vocabulary).toHaveLength(1);

    // ファイル更新 + mtime を確実に進める (FS の mtime 解像度に依存しないよう明示)
    fs.writeFileSync(tmpFile, JSON.stringify({ version: 2, vocabulary: [{ term: 'A' }, { term: 'B' }], guidelines: ['r'] }));
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(tmpFile, future, future);

    const reloaded = configModule.loadGuideline();
    expect(reloaded.vocabulary).toHaveLength(2);
    expect(reloaded.version).toBe(2);
  });

  test('does not re-read file when mtime unchanged (caching retained)', () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ version: 1, vocabulary: [], guidelines: [] }));
    const spy = jest.spyOn(fs, 'readFileSync');
    configModule.loadGuideline();
    configModule.loadGuideline();
    const guidelineReads = spy.mock.calls.filter((c) => String(c[0]) === tmpFile);
    expect(guidelineReads.length).toBe(1);
    spy.mockRestore();
  });

  test('picks up a file that appears after first (missing) load', () => {
    // 最初はファイル無し → EMPTY
    expect(configModule.loadGuideline().vocabulary).toEqual([]);
    // 後からファイル出現 → 次の load で反映
    fs.writeFileSync(tmpFile, JSON.stringify({ version: 1, vocabulary: [{ term: 'X' }], guidelines: [] }));
    expect(configModule.loadGuideline().vocabulary).toHaveLength(1);
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

  test('caches result across multiple calls (ファイル不変 → 同一 cache オブジェクト)', () => {
    // 注: #296 で mtime 変化時は reload する仕様になったため、「ファイルを書き換えても
    // 古い値を返す」という旧前提のテストは機能と矛盾し、かつ 2 回の書き込みが同一ミリ秒に
    // 収まるかどうかという timing 依存の flake 源だった。caching の正しい意味は
    // 「ファイルが変わらなければ同じ cache オブジェクトを返す」なので、ファイルを
    // 書き換えずに複数回呼んで検証する (決定的)。mtime 変化時の reload は別テストで担保。
    fs.writeFileSync(tmpFile, JSON.stringify({ vocabulary: [{ term: 'A' }] }));
    const a = configModule.loadGuideline();
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

  test('INCLUDES vocabulary for gpt-4o-transcribe (5/12 default 拡張、新世代兄弟モデル)', () => {
    const prompt = configModule.buildWhisperPrompt({
      whisper_context: '業務無線です。',
      vocabulary: [{ term: '甲' }, { term: '乙' }, { term: '丙' }],
    }, 'gpt-4o-transcribe');
    expect(prompt).toContain('甲');
    expect(prompt).toContain('乙');
    expect(prompt).toContain('用語:');
  });

  test('does NOT include vocabulary for whisper-1 (legacy bias risk、default で除外維持)', () => {
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

describe('isWhisperPromptHallucination (#269 Bug 1 fix)', () => {
  const { isWhisperPromptHallucination } = require('../../src/services/transcriptionConfig');

  test('false: null / empty inputs', () => {
    expect(isWhisperPromptHallucination(null, 'prompt')).toBe(false);
    expect(isWhisperPromptHallucination('text', null)).toBe(false);
    expect(isWhisperPromptHallucination('', 'prompt')).toBe(false);
    expect(isWhisperPromptHallucination('text', '')).toBe(false);
  });

  test('true: raw_text が prompt 全体と完全一致 (基本 case)', () => {
    const prompt = 'これは農機販売店の業務無線の音声記録です。 用語: ガマ、ビレッジ';
    expect(isWhisperPromptHallucination(prompt, prompt)).toBe(true);
  });

  test('true: raw_text が prompt の whisper_context 部分のみと一致 (vocab 部分が echo されない場合)', () => {
    const prompt = 'これは農機販売店の業務無線の音声記録です。 用語: ガマ、ビレッジ';
    const raw = 'これは農機販売店の業務無線の音声記録です。';
    expect(isWhisperPromptHallucination(raw, prompt)).toBe(true);
  });

  test('true: raw_text が whisper_context のみで vocab inject なし', () => {
    const prompt = 'これは農機販売店の業務無線の音声記録です。';
    const raw = 'これは農機販売店の業務無線の音声記録です。';
    expect(isWhisperPromptHallucination(raw, prompt)).toBe(true);
  });

  test('true: raw_text が prompt の prefix (10 char 以上)', () => {
    const prompt = 'これは農機販売店の業務無線の音声記録です。 用語: ガマ';
    const raw = 'これは農機販売店の業務無線の';  // 14 chars, prompt の prefix
    expect(isWhisperPromptHallucination(raw, prompt)).toBe(true);
  });

  test('false: raw_text が prompt の prefix でも < 10 chars (短すぎる prefix は normal speech 可能)', () => {
    const prompt = 'これは農機販売店の業務無線の音声記録です。';
    const raw = 'これは';  // 3 chars, prefix だが短すぎる
    expect(isWhisperPromptHallucination(raw, prompt)).toBe(false);
  });

  test('false: 正常な転写は hallucination 判定されない', () => {
    const prompt = 'これは農機販売店の業務無線の音声記録です。 用語: ガマ';
    expect(isWhisperPromptHallucination('斉藤くん、どこにいますか？', prompt)).toBe(false);
    expect(isWhisperPromptHallucination('はい、了解です。', prompt)).toBe(false);
  });

  test('false: prompt と無関係な文', () => {
    const prompt = 'これは農機販売店の業務無線です。';
    expect(isWhisperPromptHallucination('全然関係ない文章', prompt)).toBe(false);
  });
});

describe('isMetaEmptyLiteral (#269 Bug 3 fix)', () => {
  const { isMetaEmptyLiteral } = require('../../src/services/transcriptionConfig');

  test('true: 空文字 / 空文字列 / メタ表現 literal', () => {
    expect(isMetaEmptyLiteral('空文字')).toBe(true);
    expect(isMetaEmptyLiteral('空文字列')).toBe(true);
    expect(isMetaEmptyLiteral('空白')).toBe(true);
    expect(isMetaEmptyLiteral('(空)')).toBe(true);
    expect(isMetaEmptyLiteral('（空）')).toBe(true);
    expect(isMetaEmptyLiteral('内容なし')).toBe(true);
    expect(isMetaEmptyLiteral('無音')).toBe(true);
    expect(isMetaEmptyLiteral('empty')).toBe(true);
    expect(isMetaEmptyLiteral('null')).toBe(true);
    expect(isMetaEmptyLiteral('none')).toBe(true);
  });

  test('true: 前後 whitespace でも trim して match', () => {
    expect(isMetaEmptyLiteral('  空文字  ')).toBe(true);
    expect(isMetaEmptyLiteral('\n空文字列\n')).toBe(true);
  });

  test('false: 空文字を含む文章は normal text', () => {
    expect(isMetaEmptyLiteral('空文字を返してください')).toBe(false);
    expect(isMetaEmptyLiteral('整形対象なし、空文字')).toBe(false);
  });

  test('false: 正常な転写', () => {
    expect(isMetaEmptyLiteral('斉藤くん、了解です。')).toBe(false);
    expect(isMetaEmptyLiteral('')).toBe(false);
    expect(isMetaEmptyLiteral(null)).toBe(false);
    expect(isMetaEmptyLiteral(undefined)).toBe(false);
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

describe('buildGlossary (#自ホストSTT: local backend の固有名詞 biasing)', () => {
  test('vocabulary が空なら空文字', () => {
    expect(configModule.buildGlossary({ vocabulary: [] })).toBe('');
    expect(configModule.buildGlossary({})).toBe('');
  });

  test('term を 、 区切りで連結する', () => {
    const g = configModule.buildGlossary({
      vocabulary: [{ term: 'JU愛知' }, { term: '畦塗機' }, { term: 'ガマ' }],
    });
    expect(g).toBe('JU愛知、畦塗機、ガマ');
  });

  test('reading があれば term（reading）形式で読みを併記する', () => {
    const g = configModule.buildGlossary({
      vocabulary: [{ term: '畦塗機', reading: 'あぜぬりき' }],
    });
    expect(g).toBe('畦塗機（あぜぬりき）');
  });

  test('重複 term と空 term を除去する', () => {
    const g = configModule.buildGlossary({
      vocabulary: [{ term: 'ガマ' }, { term: '' }, { term: 'ガマ' }, { term: null }],
    });
    expect(g).toBe('ガマ');
  });

  test('STT_GLOSSARY_MAX_TERMS で語数を上限できる (bleed 抑制)', () => {
    process.env.STT_GLOSSARY_MAX_TERMS = '2';
    const g = configModule.buildGlossary({
      vocabulary: [{ term: 'A' }, { term: 'B' }, { term: 'C' }],
    });
    expect(g).toBe('A、B');
    delete process.env.STT_GLOSSARY_MAX_TERMS;
  });
});

// TRANSCRIPTION_MODE スパイク (Day48): legacy(既定) と organon の 2 方式を env で切替。
// 既定 legacy は現行と完全同一 = 後方互換。organon は Qwen生 + organon補正。
describe('getTranscriptionMode (方式スイッチ)', () => {
  afterEach(() => { delete process.env.TRANSCRIPTION_MODE; });

  test('未設定なら legacy (後方互換)', () => {
    expect(configModule.getTranscriptionMode({})).toBe('legacy');
  });

  test('TRANSCRIPTION_MODE=organon で organon', () => {
    expect(configModule.getTranscriptionMode({ TRANSCRIPTION_MODE: 'organon' })).toBe('organon');
  });

  test('大文字小文字と前後空白を正規化する', () => {
    expect(configModule.getTranscriptionMode({ TRANSCRIPTION_MODE: ' Organon ' })).toBe('organon');
    expect(configModule.getTranscriptionMode({ TRANSCRIPTION_MODE: 'LEGACY' })).toBe('legacy');
  });

  test('未知の値は legacy にフォールバック (安全側)', () => {
    expect(configModule.getTranscriptionMode({ TRANSCRIPTION_MODE: 'foo' })).toBe('legacy');
  });

  test('引数省略時は process.env を読む', () => {
    process.env.TRANSCRIPTION_MODE = 'organon';
    expect(configModule.getTranscriptionMode()).toBe('organon');
  });
});

// mode 別 補正モデル (Exp8: gpt-4o-mini の stochastic 天井を gpt-5.4-mini で解消)。
describe('getCorrectionModel (mode 別 補正モデル)', () => {
  afterEach(() => { delete process.env.AI_MODEL; delete process.env.ORGANON_AI_MODEL; });

  test('legacy は AI_MODEL (既定 gpt-4o-mini) = 後方互換', () => {
    expect(configModule.getCorrectionModel('legacy', {})).toBe('gpt-4o-mini');
    expect(configModule.getCorrectionModel('legacy', { AI_MODEL: 'gpt-4o' })).toBe('gpt-4o');
  });

  test('organon は ORGANON_AI_MODEL (既定 gpt-5.4-mini)', () => {
    expect(configModule.getCorrectionModel('organon', {})).toBe('gpt-5.4-mini');
    expect(configModule.getCorrectionModel('organon', { ORGANON_AI_MODEL: 'gpt-5.4' })).toBe('gpt-5.4');
  });

  test('引数省略時は process.env を読む', () => {
    process.env.ORGANON_AI_MODEL = 'gpt-4.1-mini';
    expect(configModule.getCorrectionModel('organon')).toBe('gpt-4.1-mini');
  });
});

describe('completionParams (モデル世代別 API パラメータ)', () => {
  test('新世代 (gpt-5*/o*) は max_completion_tokens・temperature/max_tokens 無し', () => {
    const p = configModule.completionParams('gpt-5.4-mini');
    expect(p).toHaveProperty('max_completion_tokens');
    expect('temperature' in p).toBe(false);
    expect('max_tokens' in p).toBe(false);
    expect(configModule.completionParams('o4-mini')).toHaveProperty('max_completion_tokens');
  });

  test('旧世代 (gpt-4o-mini / gpt-4.1-mini) は temperature + max_tokens = 現行互換', () => {
    const p = configModule.completionParams('gpt-4o-mini');
    expect(p.temperature).toBe(0.3);
    expect(p.max_tokens).toBe(1000);
    expect('max_completion_tokens' in p).toBe(false);
    expect(configModule.completionParams('gpt-4.1-mini').max_tokens).toBe(1000);
  });
});

describe('buildOrganonCorrectionPrompt (organon 補正段の system prompt)', () => {
  test('vocab 空でも base 補正 prompt を返す (指示 + 過補正ガード)', () => {
    const p = configModule.buildOrganonCorrectionPrompt({ vocabulary: [] });
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(0);
    expect(p).toContain('固有名詞');       // 補正の役割
    expect(p).toContain('リストに無い');    // 未登録は変えないガード
    expect(p).toContain('フルネーム');      // 単独姓/地名をフルネーム化しないガード (Exp7: 甲野→甲野花子)
  });

  test('proper-noun term と aliases を知識ブロックに含める', () => {
    const p = configModule.buildOrganonCorrectionPrompt({
      vocabulary: [{ term: '整備長', category: 'role', aliases: ['セビ調', 'セービチョー'] }],
    });
    expect(p).toContain('整備長');
    expect(p).toContain('セビ調');
    expect(p).toContain('セービチョー');
  });

  test('reading があれば併記する (音→表記の橋渡し)', () => {
    const p = configModule.buildOrganonCorrectionPrompt({
      vocabulary: [{ term: '畦塗機', category: 'product', reading: 'あぜぬりき' }],
    });
    expect(p).toContain('畦塗機');
    expect(p).toContain('あぜぬりき');
  });

  test('description があれば併記する (何屋か = 文脈補正の知識源、Exp5 田中勤寿)', () => {
    const p = configModule.buildOrganonCorrectionPrompt({
      vocabulary: [{ term: '田中勤寿', category: 'vendor', description: 'トマト農家' }],
    });
    expect(p).toContain('田中勤寿');
    expect(p).toContain('トマト農家');
  });

  test('汎用 term カテゴリは知識ブロックから除外する (お客様/売上 等のノイズ回避)', () => {
    const p = configModule.buildOrganonCorrectionPrompt({
      vocabulary: [
        { term: 'お客様', category: 'term' },
        { term: 'ガマ', category: 'person' },
      ],
    });
    expect(p).toContain('ガマ');
    expect(p).not.toContain('お客様');
  });

  // ★ 棄権ガード (#371) は 2026-08-13 に入れて 08-14 に外した。テストも一緒に外してある。
  //   導入時の -37.5% は「1 件につき STT を 6 回引き直した raw」での測定で、本番より崩れが多かった。
  //   本番と同じ条件 (保存済み raw を 1 回整形) の 500 件 × 6 回では 人名の捏造 -8% (p=0.127) で未確立、
  //   逆に「ホタカ」→「保坂」(6/6 → 3/6) のように **正しい正規化を止める** 実例が出た。
  //   経緯と数字は buildOrganonCorrectionPrompt の doc comment と #371 に残してある。
});
