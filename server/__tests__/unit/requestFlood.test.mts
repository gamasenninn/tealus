/**
 * 1 つの相手が同じ口を 1 分に何十回も叩いたら、warn に 1 行残す (改善ループ 41)
 *
 * ★ 2026-11-04 10〜13 時、1 台の端末が読み込みを繰り返し、本体へ 3 時間で約 11 万回 (GET /api/config 最大 652 回/分)。
 *   全部 debug 行だったので、ログを数えるまで誰も気づかなかった。他の日の最大は 27 回/分 (ビルド直後の一斉の読み込み)
 * ★ 止めない (429 にしない)。まず見えるようにする
 */
import { noteRequestForFlood, floodKey, resetRequestFlood } from '../../src/middleware/requestFlood.mts';

const T0 = Date.parse('2026-11-04T01:00:00Z');

beforeEach(() => resetRequestFlood());

test('★ 1 分に 60 回を超えたら 1 行返す (誰が・どの口・何回)', () => {
  let line: string | null = null;
  for (let i = 0; i < 61; i++) line = noteRequestForFlood('user=beaf2468', 'GET /api/config', T0 + i * 100) ?? line;
  expect(line).toContain('[http-flood]');
  expect(line).toContain('GET /api/config');
  expect(line).toContain('user=beaf2468');
});

test('60 回までは何も返さない (ビルド直後の一斉の読み込みは 27 回/分)', () => {
  const lines = Array.from({ length: 60 }, (_, i) => noteRequestForFlood('user=a', 'GET /api/config', T0 + i * 100)).filter(Boolean);
  expect(lines).toEqual([]);
});

test('★ 続いても 10 分に 1 回だけ (ログを埋めない)', () => {
  const lines: string[] = [];
  for (let m = 0; m < 12; m++) {
    for (let i = 0; i < 100; i++) {
      const l = noteRequestForFlood('user=a', 'GET /api/config', T0 + m * 60_000 + i * 100);
      if (l) lines.push(l);
    }
  }
  expect(lines.length).toBe(2);   // 0 分目と 10 分目
});

test('相手が違えば別に数える', () => {
  for (let i = 0; i < 40; i++) noteRequestForFlood('user=a', 'GET /api/config', T0 + i);
  const lines = Array.from({ length: 40 }, (_, i) => noteRequestForFlood('user=b', 'GET /api/config', T0 + i)).filter(Boolean);
  expect(lines).toEqual([]);
});

test('★ 部屋ごとの口は ID をまとめて数える (部屋を開き直す繰り返しも拾う)', () => {
  let line: string | null = null;
  for (let i = 0; i < 61; i++) {
    line = noteRequestForFlood('user=a', `GET /api/rooms/1ff5064f-cf66-4353-a9da-1376277fcabd/messages`, T0 + i) ?? line;
  }
  expect(line).toContain('GET /api/rooms/:id/messages');
});

describe('floodKey', () => {
  it('ログインしていれば利用者、していなければ Cloudflare が付ける元の IP', () => {
    expect(floodKey({ user: { id: 'beaf2468-0000-0000-0000-000000000000' } } as never)).toBe('user=beaf2468');
    // ★ req.ip は Cloudflare の中継の IP になり、外の全員が 1 つに束なる
    expect(floodKey({ get: (h: string) => (h === 'cf-connecting-ip' ? '203.0.113.5' : undefined), ip: '172.71.24.85' } as never)).toBe('ip=203.0.113.5');
    expect(floodKey({ get: () => undefined, ip: '127.0.0.1' } as never)).toBe('ip=127.0.0.1');
  });
});
