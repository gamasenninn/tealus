/**
 * #645 Deep が時間切れになったとき、その回に作った画像を拾う
 *
 * ★ 2026-11-05: 16 枚の依頼で codex の内蔵の画像生成が 9 枚を `<CODEX_HOME>/generated_images/<thread>/` に作ったところで
 *   8 分で打ち切られ、投稿 0 枚だった (全部作ってから確認して投稿する計画だった)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listGeneratedImagesSince, postLeftoverImages, isImagePostToolCall } from '../../src/lib/leftoverImages.mts';

describe('listGeneratedImagesSince', () => {
  let home: string;
  const T0 = Date.parse('2026-11-05T09:29:14Z');

  function img(rel: string, at: number): string {
    const p = path.join(home, 'generated_images', rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x');
    fs.utimesSync(p, new Date(at), new Date(at));
    return p;
  }

  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'leftover-')); });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  test('★ 始めた時刻より後の画像を、できた順に返す', () => {
    const a = img('t1/exec-2.png', T0 + 2000);
    const b = img('t1/exec-1.png', T0 + 1000);
    expect(listGeneratedImagesSince(home, T0)).toEqual([b, a]);
  });

  test('前の回の画像は返さない', () => {
    img('old/exec-0.png', T0 - 60_000);
    const n = img('t1/exec-1.png', T0 + 1000);
    expect(listGeneratedImagesSince(home, T0)).toEqual([n]);
  });

  test('画像でないファイルは返さない', () => {
    img('t1/notes.txt', T0 + 1000);
    expect(listGeneratedImagesSince(home, T0)).toEqual([]);
  });

  test('★ 上限で切る (できた順の先頭から)', () => {
    const files = Array.from({ length: 5 }, (_, i) => img(`t1/exec-${i}.png`, T0 + (i + 1) * 1000));
    expect(listGeneratedImagesSince(home, T0, 3)).toEqual(files.slice(0, 3));
  });

  test('置き場が無ければ空 (投げない)', () => {
    expect(listGeneratedImagesSince(path.join(home, 'none'), T0)).toEqual([]);
  });
});

describe('postLeftoverImages', () => {
  let home: string;
  const T0 = Date.parse('2026-11-05T09:29:14Z');
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'leftover-')); });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  test('★ できた分を 1 枚ずつ投稿し、投稿できた枚数を返す', async () => {

    for (let i = 0; i < 3; i++) {
      const p = path.join(home, 'generated_images', 't1', `exec-${i}.png`);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `img${i}`);
      fs.utimesSync(p, new Date(T0 + (i + 1) * 1000), new Date(T0 + (i + 1) * 1000));
    }
    const sent: string[] = [];
    const n = await postLeftoverImages(home, T0, async (buf, name) => { sent.push(`${name}:${buf.toString()}`); });
    expect(n).toBe(3);
    expect(sent).toEqual(['exec-0.png:img0', 'exec-1.png:img1', 'exec-2.png:img2']);
  });

  test('1 枚の投稿に失敗しても残りは送り、送れた枚数だけ数える', async () => {

    for (let i = 0; i < 2; i++) {
      const p = path.join(home, 'generated_images', 't1', `exec-${i}.png`);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, 'x');
      fs.utimesSync(p, new Date(T0 + (i + 1) * 1000), new Date(T0 + (i + 1) * 1000));
    }
    let calls = 0;
    const n = await postLeftoverImages(home, T0, async () => { calls++; if (calls === 1) throw new Error('boom'); });
    expect(calls).toBe(2);
    expect(n).toBe(1);
  });
});

describe('isImagePostToolCall', () => {
  test('★ send_image / generate_and_send_image の完了は「投稿した」', async () => {

    for (const tool of ['send_image', 'generate_and_send_image']) {
      expect(isImagePostToolCall({ type: 'item.completed', item: { type: 'mcp_tool_call', tool, status: 'completed' } })).toBe(true);
    }
  });
  test('ほかの道具・失敗・途中の印は数えない', async () => {

    expect(isImagePostToolCall({ type: 'item.completed', item: { type: 'mcp_tool_call', tool: 'send_message', status: 'completed' } })).toBe(false);
    expect(isImagePostToolCall({ type: 'item.completed', item: { type: 'mcp_tool_call', tool: 'send_image', status: 'failed' } })).toBe(false);
    expect(isImagePostToolCall({ type: 'item.started', item: { type: 'mcp_tool_call', tool: 'send_image' } })).toBe(false);
    expect(isImagePostToolCall(null)).toBe(false);
  });
});

/**
 * 配線の見張り: Deep (codex) の時間切れの処理が、作った画像を拾っているか (イベントハンドラの中なのでソースで見る。
 * deepCodexNoticeCatchGuard.test.mts と同じ作法)
 */
describe('#645 deepCodex の時間切れの配線', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'agents', 'deepCodex.mts'), 'utf8');
  const timeoutBlock = src.slice(src.indexOf('const timer = setTimeout(async () => {'), src.indexOf('proc._tealusTimer = timer;'));

  test('★ 時間切れの処理の中で postLeftoverImages を呼ぶ (この回の開始時刻と CODEX_HOME で)', () => {
    expect(timeoutBlock).toMatch(/postLeftoverImages\(codexHome, startedAt,/);
  });

  test('★ この回で既に画像を出していれば拾い直さない・委譲 (自動投稿を止めている経路) では出さない', () => {
    expect(timeoutBlock).toMatch(/!suppressAutoPost && imagesPosted === 0/);
    expect(src).toMatch(/if \(isImagePostToolCall\(event\)\) imagesPosted\+\+;/);
  });
});
