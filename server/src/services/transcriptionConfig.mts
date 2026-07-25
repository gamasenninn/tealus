import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.mts';
import * as dictionaryRepo from './dictionaryRepo.mts';
import { writeLocalTtl, DEFAULT_LOCAL_TTL_PATH } from './dictionaryTtl.mts';

/** guideline の vocabulary 1 エントリ (file JSON / テーブルオーバーレイ共通の形) */
export interface VocabularyEntry {
  term: string;
  category?: string;
  aliases?: string[];
  reading?: string | null;
  description?: string | null;
}

/** transcription_guideline.json / loadGuideline() の形 */
export interface TranscriptionGuideline {
  version: number;
  whisper_context: string;
  vocabulary: VocabularyEntry[];
  guidelines: string[];
}

const CONFIG_PATH = process.env.TRANSCRIPTION_GUIDELINE_PATH
  || path.join(import.meta.dirname, '../../config/transcription_guideline.json');

const EMPTY: TranscriptionGuideline = { version: 1, whisper_context: '', vocabulary: [], guidelines: [] };

let cached: TranscriptionGuideline | null = null;
// #286 follow-up: ファイル mtime を保持し、変化時のみ再読込 (= admin token / reload endpoint
// なしでファイル更新を自動反映。7 日ごとの JWT 失効 + curl 不可の運用摩擦を構造的に解消)。
let cachedMtimeMs: number | null = null;

// #327: 実行時 source of truth は dictionary テーブル。ただし loadGuideline() は同期契約
// (buildSystemPrompt 等の同期関数から呼ばれる) なので、テーブル vocab は「非同期で更新する
// in-memory オーバーレイ」で持つ。null / 空 のときは file の vocabulary にフォールバック
// (= 未 seed / DB 不達でも従来どおり動く非破壊)。whisper_context / guidelines は file 継続。
let tableVocab: VocabularyEntry[] | null = null;

function loadFileGuideline(): TranscriptionGuideline {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      cached = EMPTY;
      cachedMtimeMs = null;
      return cached;
    }
    const mtimeMs = fs.statSync(CONFIG_PATH).mtimeMs;
    // cache 済 かつ mtime 不変 → そのまま返す (1 文字起こしあたり statSync 1 回のみ)
    if (cached && cachedMtimeMs === mtimeMs) return cached;

    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<TranscriptionGuideline>;
    cached = {
      version: parsed.version || 1,
      whisper_context: typeof parsed.whisper_context === 'string' ? parsed.whisper_context : '',
      vocabulary: Array.isArray(parsed.vocabulary) ? parsed.vocabulary : [],
      guidelines: Array.isArray(parsed.guidelines) ? parsed.guidelines : [],
    };
    cachedMtimeMs = mtimeMs;
    logger.info(`Loaded transcription guideline: ${cached.vocabulary.length} vocab, ${cached.guidelines.length} rules`);
    return cached;
  } catch (err) {
    logger.error('Failed to load transcription guideline, using empty:', err instanceof Error ? err.message : String(err));
    cached = EMPTY;
    cachedMtimeMs = null;
    return cached;
  }
}

export function resetCache(): void {
  cached = null;
  cachedMtimeMs = null;
}

/**
 * #348 (a): overlay を local.ttl に書き出す (非致命)。書き込み失敗は warn のみで
 * refresh を壊さない (organon inject と同じく、辞書供給は best-effort の副作用)。
 */
async function emitLocalTtl(vocab: VocabularyEntry[]): Promise<void> {
  try {
    await writeLocalTtl(DEFAULT_LOCAL_TTL_PATH, vocab);
  } catch (err) {
    logger.warn(`[dictionary] local.ttl write failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * #327: dictionary テーブルの active vocabulary を in-memory オーバーレイに読み込む (非同期)。
 * 起動時・admin reload・辞書書込 (hook/UI/import) 後に呼ぶ。テーブルが空 / DB 不達なら
 * tableVocab を null に落とし、loadGuideline() は file にフォールバックする (非破壊)。
 * @returns オーバーレイに載った term 数 (0 = file フォールバック)
 */
export async function refreshVocabFromTable(): Promise<number> {
  try {
    const rows = await dictionaryRepo.listActiveVocabulary();
    if (Array.isArray(rows) && rows.length) {
      // 消費側 (buildFormattingExtension / buildOrganonCorrectionPrompt / buildGlossary) は
      // term / category / aliases を使う。reading / description は superset として温存。
      tableVocab = rows.map((r) => ({
        term: r.term,
        category: r.category,
        aliases: Array.isArray(r.aliases) ? r.aliases : [],
        reading: r.reading || null,
        description: r.description || null,
      }));
      logger.info(`[dictionary] vocab overlay from table: ${tableVocab.length} terms`);
      // #348 (a): agent-server (別プロセス) が読む local.ttl を発行 (5 field)。非致命 —
      // 書き込み失敗で refresh を壊さない (overlay は既に更新済)。空/DB不達時は書かず、
      // 前回の good な local.ttl を温存する (= file fallback 最後の砦 の思想)。
      await emitLocalTtl(tableVocab);
      return tableVocab.length;
    }
    tableVocab = null; // 空テーブル → file フォールバック
    return 0;
  } catch (err) {
    tableVocab = null; // DB 不達 → file フォールバック (非破壊)
    logger.warn(`[dictionary] table vocab refresh failed, falling back to file: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

/**
 * 整形/文字起こしが参照する guideline。whisper_context / guidelines は file、vocabulary は
 * テーブルオーバーレイ (あれば) → 無ければ file。同期契約を維持 (呼び出し側は同期のまま)。
 */
export function loadGuideline(): TranscriptionGuideline {
  const fileConfig = loadFileGuideline();
  if (tableVocab && tableVocab.length) {
    return { ...fileConfig, vocabulary: tableVocab };
  }
  return fileConfig;
}

export function buildWhisperPrompt(config: TranscriptionGuideline, model: string | null = null): string | null {
  // Whisper の prompt parameter は style/spelling bias であって辞書ではない。
  // vocabulary を強く渡すと隣接音が歪む (例: 「ビレッジ側」→「ビレッジガン」)、
  // この特性は **model 依存** で、whisper-1 / gpt-4o-transcribe では bias 観測されたが、
  // gpt-4o-mini-transcribe では vocabulary を渡すと「業務連絡 / 冷蔵コンテナ / アシストさん」等の
  // 固有名詞認識が改善することが 5/9 検証で確認された (#269 Phase 1 finding)。
  //
  // Phase 2 実装: model-aware vocab inject。WHISPER_VOCAB_INJECT_MODELS env で list 指定、
  // 該当 model のとき vocabulary を whisper_context に追加。non-該当 model は従来通り
  // whisper_context のみ (vocab は AI 整形段階で正規化)。
  //
  // 安全層:
  // - default WHISPER_VOCAB_INJECT_MODELS は 'gpt-4o-mini-transcribe' のみ (5/9 verify 済)
  // - 200 char 上限 (Whisper prompt token budget)
  // - 議事録など gpt-4o-transcribe 用途は無変更 (default 維持)
  const { whisper_context, vocabulary } = config;

  // default は新世代 transcribe 2 model (5/12 dogfood で gpt-4o-mini-transcribe 完璧、
  // gpt-4o-transcribe も同世代兄弟で bias なしと期待、whisper-1 は legacy で除外)
  const VOCAB_INJECT_MODELS = (process.env.WHISPER_VOCAB_INJECT_MODELS
    || 'gpt-4o-mini-transcribe,gpt-4o-transcribe').split(',').map((s) => s.trim()).filter(Boolean);
  const shouldInjectVocab = model && VOCAB_INJECT_MODELS.includes(model)
    && Array.isArray(vocabulary) && vocabulary.length > 0;

  let prompt = whisper_context || '';
  if (shouldInjectVocab) {
    const terms = vocabulary.map((v) => v.term).filter(Boolean).join('、');
    prompt = prompt ? `${prompt} 用語: ${terms}` : `用語: ${terms}`;
  }

  if (!prompt) return null;

  // Model-aware truncation (#269 Phase 2 follow-up、5/12 user dogfood で判明):
  // - whisper-1: 224 token (最終 224 のみ参照、それ以前は無視されるという legacy 仕様)
  // - gpt-4o-transcribe / gpt-4o-mini-transcribe: 16,000 token (新世代、whisper-1 の 74 倍)
  //
  // 日本語 1 char ≈ 1-1.5 token、安全側で:
  //   legacy (whisper-1 or unknown model) → 200 char (~140-200 token)
  //   new gen (gpt-4o-* transcribe)        → 2000 char (~1400-2000 token、16000 token の 1/8)
  //
  // truncate 方向は slice(0, N) で先頭保持に変更 (旧 slice(-N) は末尾保持で whisper_context
  // 冒頭が削れる問題あり、辞書 inject 順序的に先頭 = whisper_context + 重要 term の方が自然)。
  const isLegacyModel = !model || model === 'whisper-1';
  const MAX_CHARS = isLegacyModel ? 200 : 2000;
  return prompt.length > MAX_CHARS ? prompt.slice(0, MAX_CHARS) : prompt;
}

export function buildFormattingExtension(config: TranscriptionGuideline): string {
  const { vocabulary, guidelines } = config;
  if (!vocabulary.length && !guidelines.length) return '';

  const lines: string[] = [];
  if (vocabulary.length) {
    lines.push('');
    lines.push('組織固有語彙 (正規表記、転写ブレがあれば置き換える):');
    for (const v of vocabulary) {
      const aliases = Array.isArray(v.aliases) && v.aliases.length
        ? ` (転写ブレ例: ${v.aliases.join(', ')})`
        : '';
      const cat = v.category ? `[${v.category}] ` : '';
      lines.push(`- ${cat}${v.term}${aliases}`);
    }
  }
  if (guidelines.length) {
    lines.push('');
    lines.push('追加ガイドライン:');
    for (const g of guidelines) {
      lines.push(`- ${g}`);
    }
  }
  return lines.join('\n');
}

/**
 * local STT backend (Qwen3-ASR 常駐ワーカー) 用の固有名詞 glossary を構築 (#自ホストSTT)。
 *
 * Whisper の prompt bias (buildWhisperPrompt) とは別軸で、audio-LLM ASR の system prompt に
 * 固有名詞を渡して decode 時に canonical 表記へ snap させる (2026-07-03 実験で miss 4/4 回収)。
 * organon 由来の vocabulary が「ASR glossary」という新しい下流用途を持つ。
 *
 * - term を 、 区切りで連結。reading があれば「term（reading）」で読みを併記 (音→表記の橋渡し)。
 * - 重複 / 空 term は除去。
 * - glossary の soft-bias は非対象 span へ bleed する副作用があるため (memory 既知)、
 *   STT_GLOSSARY_MAX_TERMS で語数上限を掛けられる (default 無制限)。
 *
 * @param config - loadGuideline() の戻り (vocabulary を参照)
 * @returns glossary (空なら '')
 */
export function buildGlossary(config: TranscriptionGuideline | null | undefined): string {
  const vocabulary = (config && Array.isArray(config.vocabulary)) ? config.vocabulary : [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const v of vocabulary) {
    const term = v && typeof v.term === 'string' ? v.term.trim() : '';
    if (!term || seen.has(term)) continue;
    seen.add(term);
    const reading = v.reading && typeof v.reading === 'string' ? v.reading.trim() : '';
    terms.push(reading ? `${term}（${reading}）` : term);
  }
  const max = Number(process.env.STT_GLOSSARY_MAX_TERMS || 0);
  const limited = max > 0 ? terms.slice(0, max) : terms;
  return limited.join('、');
}

/**
 * Whisper prompt hallucination 検出
 *
 * Whisper API は音声内容が薄い (無音 / ノイズ / 短すぎる発話) 場合、
 * prompt として渡した文字列を **そのまま echo して返す** known issue がある。
 * vocab inject で prompt が太くなったため、leak が surface しやすくなった。
 *
 * 検出: rawText が whisperPrompt 全体、または whisperPrompt の冒頭 (whisper_context 部分)
 * と完全一致する場合、prompt hallucination と判定。
 *
 * @param rawText - Whisper API の出力
 * @param whisperPrompt - Whisper に渡した prompt
 */
export function isWhisperPromptHallucination(rawText: string | null | undefined, whisperPrompt: string | null | undefined): boolean {
  if (!rawText || !whisperPrompt) return false;
  const raw = rawText.trim();
  const prompt = whisperPrompt.trim();
  if (raw === prompt) return true;
  // whisper_context 部分のみ (vocab inject 前の文脈) と一致するか
  const contextOnly = prompt.split(' 用語:')[0].trim();
  if (contextOnly && raw === contextOnly) return true;
  // raw が prompt の冒頭部分と一致 (prompt の prefix を echo)
  if (prompt.startsWith(raw) && raw.length >= 10) return true;
  return false;
}

/**
 * AI 整形が返してしまう「空文字を意味する Japanese literal」の検出。
 *
 * gpt-4o-mini が短い / 内容が薄い raw_text を整形する時、空文字を返す代わりに
 * 「空文字」「空文字列」「(空)」等のメタ description を返してしまう挙動が観測された。
 * これを検出して raw_text に fallback する。
 */
export const META_EMPTY_LITERALS: string[] = [
  '空文字', '空文字列', '空白', '空',
  '(空)', '（空）', '(空文字)', '（空文字）',
  '内容なし', '内容無し', '無音', '(無音)', '（無音）',
  '(none)', 'none', 'null', 'empty',
];

export function isMetaEmptyLiteral(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  return META_EMPTY_LITERALS.includes(trimmed);
}

/**
 * 文字起こし方式スイッチ (TRANSCRIPTION_MODE スパイク、Day48)
 *
 *   legacy (既定) : 現行 = Whisper(openai) + vocab-inject prompt + 現行 AI 整形。出力完全同一 = 後方互換。
 *   organon       : Qwen生(local, 障害時 openai へ fail-open) + vocab-inject 無し + organon 補正段。
 *
 * 未設定 / 未知値は安全側で legacy にフォールバック。
 */
export type TranscriptionMode = 'legacy' | 'organon';
const TRANSCRIPTION_MODES: readonly string[] = ['legacy', 'organon'];
export function getTranscriptionMode(env: NodeJS.ProcessEnv = process.env): TranscriptionMode {
  const raw = env && env.TRANSCRIPTION_MODE ? String(env.TRANSCRIPTION_MODE).trim().toLowerCase() : '';
  return TRANSCRIPTION_MODES.includes(raw) ? (raw as TranscriptionMode) : 'legacy';
}

/**
 * mode 別の補正モデルを返す (Exp8 2026-07-04):
 *   legacy  : AI_MODEL (既定 gpt-4o-mini)。現行と同一 = 後方互換。
 *   organon : ORGANON_AI_MODEL (既定 gpt-5.4-mini)。gpt-4o-mini の stochastic 天井
 *             (整理室長→整備長 / 田中勤寿 flicker) を上位 mini で堅牢化 (4/5、しかも現行より速い)。
 */
export function getCorrectionModel(mode: string, env: NodeJS.ProcessEnv = process.env): string {
  if (mode === 'organon') return (env && env.ORGANON_AI_MODEL) || 'gpt-5.4-mini';
  return (env && env.AI_MODEL) || 'gpt-4o-mini';
}

/**
 * モデル世代別の Chat Completions パラメータ。
 * 新世代 (gpt-5* / o*) は max_completion_tokens 必須・temperature 非対応 (default のみ)。
 * 旧世代 (gpt-4o* / gpt-4.1*) は従来どおり temperature + max_tokens = 現行互換。
 */
export function completionParams(model: string | null | undefined): { max_completion_tokens: number } | { temperature: number; max_tokens: number } {
  const newGen = /^(gpt-5|o\d)/.test(model || '');
  return newGen ? { max_completion_tokens: 4000 } : { temperature: 0.3, max_tokens: 1000 };
}

/**
 * organon 補正段 (AI 整形の代替) の system prompt を構築する (TRANSCRIPTION_MODE=organon 用)。
 *
 * Day48 実験の勝ち筋: vocab-inject(音響stageのbias)でなく、organon を「補正stageの知識源」として
 * 渡す。term/aliases に加え、reading(音→表記の橋渡し) / description(何屋か=文脈補正の手がかり) を併記。
 * garble を alias 登録すると役職語崩れ等を lookup で拾える (Exp5 V4)。ただし短/曖昧 surface の
 * フルネーム過補正 (Exp7: 小川→小川朱美) を防ぐガード指示を入れる。
 *
 * 汎用語 (category='term': お客様/売上 等) は distractor になるので知識ブロックから除外し、
 * 固有名詞カテゴリ (person/organization/vendor/place/product/role) のみを載せる。
 *
 * @param config - loadGuideline() の戻り (vocabulary を参照)
 * @returns system prompt (vocab 空でも base 補正 prompt を返す)
 */
const CORRECTION_CATEGORIES: string[] = ['person', 'organization', 'vendor', 'place', 'product', 'role'];
const ORGANON_CORRECTION_BASE = `あなたは業務用トランシーバー等の音声認識(生テキスト)を整形し、組織の固有名詞を文脈から正しい表記に直すアシスタントです。
以下のルールに従ってください：
- 意味を変えず読みやすく整える。句読点を補い、フィラー(えーと、あのー等)を除去する。
- 下記「組織固有名詞リスト」を参照し、音は近いが表記が崩れた固有名詞を正規表記に直す。別名(転写ブレ例)・読み・説明も手がかりにする。
- リストに無い固有名詞(未知の顧客名・場所・人名)は勝手に変えない。推測で新しい名前を作らない。
- 単独の一般的な姓・地名を、文脈が明確に支持しない限りフルネーム(人物の正式名)へ展開しない。
- 文脈(誰への呼びかけか・何屋か・何の作業か)から固有名詞を推論する。役職語の聞き崩れも文脈で戻す。
- 整形後のテキストのみを返す。説明や注釈は不要。質問文はそのまま質問文として整形する(質問に回答しない)。
- **絶対禁止**: 空文字やメタ表現(「空文字」「内容なし」「無音」「empty」「null」「none」等)を返さない。content があれば必ず整形して返す。`;

export function buildOrganonCorrectionPrompt(config: TranscriptionGuideline | null | undefined): string {
  const vocabulary = (config && Array.isArray(config.vocabulary)) ? config.vocabulary : [];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const v of vocabulary) {
    const term = v && typeof v.term === 'string' ? v.term.trim() : '';
    if (!term || seen.has(term)) continue;
    if (!v.category || !CORRECTION_CATEGORIES.includes(v.category)) continue; // 汎用 term 等は除外
    seen.add(term);
    let line = `- [${v.category}] ${term}`;
    if (Array.isArray(v.aliases) && v.aliases.length) {
      line += `（転写ブレ例: ${v.aliases.join('、')}）`;
    }
    if (v.reading && typeof v.reading === 'string' && v.reading.trim()) {
      line += `〔読み: ${v.reading.trim()}〕`;
    }
    if (v.description && typeof v.description === 'string' && v.description.trim()) {
      line += ` … ${v.description.trim()}`;
    }
    lines.push(line);
  }
  if (!lines.length) return ORGANON_CORRECTION_BASE;
  return `${ORGANON_CORRECTION_BASE}\n\n# 組織固有名詞リスト\n${lines.join('\n')}`;
}
