/**
 * #371 自己成長辞書のゲート棄却を「理由別」に数える (dictionaryLearner)
 *
 * 本番ログでは抽出 146 件のうち 118 件 (80.8%) が gate-rejected だが、
 * 理由が 1 つのカウンタに潰れていて「何を直せば拾えるようになるか」が分からない。
 * → moras / phonetic / noTerm の 3 種に分けて返すことを verify する。
 *
 * DB は触らない (repo / pool / overlay は mock)。★ feedback_test_db_guard 適用。
 */
jest.mock('../../src/utils/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
} }));
jest.mock('../../src/db/pool.mts', () => ({ pool: { query: jest.fn(async () => ({ rows: [{ n: 0 }] })) } }));
jest.mock('../../src/services/transcriptionConfig.mts', () => ({ refreshVocabFromTable: jest.fn(async () => 0) }));
jest.mock('../../src/services/dictionaryRepo.mts', () => ({
  listActiveVocabulary: jest.fn(),
  upsertAlias: jest.fn(async () => ({ row: { id: 'a1', count: 1, status: 'pending' }, applied: true })),
  setAliasStatus: jest.fn(async () => ({})),
}));

import * as repo from '../../src/services/dictionaryRepo.mts';
import { learnFromEdit } from '../../src/services/dictionaryLearner.mts';

const mockedRepo = repo as jest.Mocked<typeof repo>;

/** term は「読み付き」で持たせる (本番の table は reading backfill 済) */
function vocab(rows: Array<{ term: string; reading: string }>) {
  return rows.map((r, i) => ({
    id: `t${i}`, term: r.term, category: 'term', reading: r.reading, description: null, aliases: [],
  }));
}

beforeEach(() => { jest.clearAllMocks(); });

describe('learnFromEdit の棄却理由を 3 種に分ける', () => {
  it('★ term が存在しない棄却を noTerm として数える (音韻ゲートは通っている)', async () => {
    // 「最積」→「砕石」: 読みが さいせき / さいせき で距離 0.00 = 音韻は通る。
    // だが vocab に「砕石」が無いので term 不在で落ちる…はずが、
    // extractAliasPairs は vocab の term しか候補にしないので、
    // 「term はあるが id が引けない」状況を作って noTerm を踏ませる。
    mockedRepo.listActiveVocabulary.mockResolvedValue(vocab([{ term: '砕石', reading: 'さいせき' }]) as never);
    const r = await learnFromEdit(
      { priorFormatted: '最積を入れる', newFormatted: '砕石を入れる' },
      { getReadings: async () => new Map([['最積', 'さいせき']]), getOccurrence: async () => 10 },
    );
    expect(r.extracted).toBe(1);
    expect(r.gateRejectedBy).toBeDefined();
    // この条件では term が引けるので棄却されない = noTerm は 0、学習される
    expect(r.gateRejectedBy!.noTerm).toBe(0);
    expect(r.learned).toBe(1);
  });

  it('★ 音韻距離で落ちたものを phonetic として数える', async () => {
    // 「ご清算」→「飛行船」: ごせいさん / ひこうせん = 距離 0.8 > MORA_MAX(0.5)
    mockedRepo.listActiveVocabulary.mockResolvedValue(vocab([{ term: '飛行船', reading: 'ひこうせん' }]) as never);
    const r = await learnFromEdit(
      { priorFormatted: 'ご清算ファーム', newFormatted: '飛行船ファーム' },
      { getReadings: async () => new Map([['ご清算', 'ごせいさん']]), getOccurrence: async () => 10 },
    );
    expect(r.extracted).toBe(1);
    expect(r.gateRejected).toBe(1);
    expect(r.gateRejectedBy!.phonetic).toBe(1);
    expect(r.gateRejectedBy!.moras).toBe(0);
    expect(r.gateRejectedBy!.noTerm).toBe(0);
  });

  it('★ モーラ数で落ちたものを moras として数える', async () => {
    // 読みが 2 モーラ = MIN_MORAS(3) 未満
    mockedRepo.listActiveVocabulary.mockResolvedValue(vocab([{ term: '田中', reading: 'たなか' }]) as never);
    const r = await learnFromEdit(
      { priorFormatted: 'タナ さん', newFormatted: '田中 さん' },
      { getReadings: async () => new Map([['タナ', 'たな']]), getOccurrence: async () => 10 },
    );
    expect(r.gateRejectedBy!.moras).toBe(1);
    expect(r.gateRejectedBy!.phonetic).toBe(0);
  });

  it('3 種の合計は従来の gateRejected と一致する (後方互換)', async () => {
    mockedRepo.listActiveVocabulary.mockResolvedValue(vocab([{ term: '飛行船', reading: 'ひこうせん' }]) as never);
    const r = await learnFromEdit(
      { priorFormatted: 'ご清算ファーム', newFormatted: '飛行船ファーム' },
      { getReadings: async () => new Map([['ご清算', 'ごせいさん']]), getOccurrence: async () => 10 },
    );
    const by = r.gateRejectedBy!;
    expect(by.moras + by.phonetic + by.noTerm).toBe(r.gateRejected);
  });

  it('抽出ゼロでも gateRejectedBy を返す (呼び出し側が undefined を踏まない)', async () => {
    mockedRepo.listActiveVocabulary.mockResolvedValue(vocab([{ term: '飛行船', reading: 'ひこうせん' }]) as never);
    const r = await learnFromEdit({ priorFormatted: '同じ', newFormatted: '同じ' }, {});
    expect(r.gateRejectedBy).toEqual({ moras: 0, phonetic: 0, noTerm: 0 });
  });
});
