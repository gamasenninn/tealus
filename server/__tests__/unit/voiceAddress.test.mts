import { leadingAddress, rankAddresses } from '../../src/services/voiceAddress.mts';

// 無線の冒頭の呼びかけ (宛名)。本番の手直し (2026-10-09〜16) の実例から
describe('leadingAddress', () => {
  it.each([
    ['ガマさん、積み込み終わったよ。', 'ガマさん'],
    ['斎藤君とれますか。はい、どうぞ。', '斎藤君'],
    ['黒瀬くん、神山さん、三瓶さん、レジ内', '黒瀬くん'],
    ['お店側、取れますか？はい。', 'お店側'],
    ['整備長、整備長取れますか？', '整備長'],
    ['保坂さん、取れますか？', '保坂さん'],
    ['斎藤さんOK', '斎藤さん'],
    ['中さん', '中さん'],
  ])('%s → %s', (text, expected) => {
    expect(leadingAddress(text)).toBe(expected);
  });

  it.each([
    '業務連絡です。田部井さん、田部井さん',   // 冒頭が呼びかけではない
    'はい。ドライバーさんが会社の方に連絡',    // 「さん」が冒頭の区切りより後ろ
    '道場にさ、耕うん作業車のアイチの青い',    // 「さ」は呼びかけの印ではない
    'ガマ、お昼入りまーす。',                  // 印の無い呼び捨ては拾わない (誤って差し替えないため)
    'お客様、到着しました。',                 // ★ 「様」は印にしない (客が主語の報告。人の版の候補にも「様」は出ない)
    'お疲れ様。今、軽トラで向かってます',
    '',
  ])('呼びかけなし: %s', (text) => {
    expect(leadingAddress(text)).toBeNull();
  });

  it('長すぎる冒頭は呼びかけとみなさない', () => {
    expect(leadingAddress('鹿沼土木の方たちと打ち合わせをしている田部井さん、')).toBeNull();
  });
});

describe('rankAddresses', () => {
  it('多い順に並べ、1 回しか出ないものは外す', () => {
    const texts = [
      'ガマさん、取れますか？', 'ガマさん、お昼です', 'ガマさん、OK',
      '斎藤君とれますか', '斎藤君、さっきの',
      '一度だけさん、テスト',
      '業務連絡です。',
    ];
    expect(rankAddresses(texts)).toEqual([
      { text: 'ガマさん', count: 3 },
      { text: '斎藤君', count: 2 },
    ]);
  });

  it('同じ回数なら文字の順で決まる (並びが毎回変わらない)', () => {
    const texts = ['中さん、1', '中さん、2', '保坂さん、1', '保坂さん、2'];
    expect(rankAddresses(texts).map((x) => x.text)).toEqual(['中さん', '保坂さん']);
  });

  it('上限で切る', () => {
    const texts = Array.from({ length: 20 }, (_, i) => [`名${i}さん、a`, `名${i}さん、b`]).flat();
    expect(rankAddresses(texts, 12)).toHaveLength(12);
  });
});
