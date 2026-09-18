import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * #445 (2026-09-18): Chrome 153 は共有の POST 本体を **空**で寄越す (★ 実測: field: [])。
 * ★ 一方 `LaunchParams.files` は「POST で launch navigation に渡されたファイル」を
 *   `FileSystemHandle` として返すと定義されている。★★ 受け口をもう 1 本 置く。
 *
 * ★★★ 既存の SW 経路は残す (Chrome 141 はそちらで通っている)。
 */

type Consumer = (params: { files?: unknown[] }) => void | Promise<void>;

function installLaunchQueue(): { fire: (files: unknown[]) => Promise<void> } {
  let consumer: Consumer | null = null;
  (window as unknown as Record<string, unknown>).launchQueue = {
    setConsumer: (c: Consumer) => { consumer = c; },
  };
  return {
    fire: async (files: unknown[]) => { await consumer?.({ files }); },
  };
}

function handleOf(file: File) {
  return { getFile: async () => file };
}

describe('#445 launchQueue の受け口', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as unknown as Record<string, unknown>).launchQueue;
  });

  it('★ launchQueue が無い環境では「非対応」と分かる (★★ 0 件と言わない)', async () => {
    const m = await import('../src/services/launchFiles');
    m.initLaunchFiles();
    expect(m.getLaunchState()).toEqual({ checked: true, supported: false, fileCount: 0 });
  });

  it('★ 初期化していなければ checked=false (★★ 「見ていない」と「0 件」を分ける)', async () => {
    const m = await import('../src/services/launchFiles');
    expect(m.getLaunchState().checked).toBe(false);
  });

  it('★★★★ FileSystemHandle を File に開いて受け取る', async () => {
    const q = installLaunchQueue();
    const m = await import('../src/services/launchFiles');
    m.initLaunchFiles();
    const f = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    await q.fire([handleOf(f)]);
    expect(m.getLaunchState().fileCount).toBe(1);
    expect(m.takeLaunchFiles()).toEqual([f]);
  });

  it('★ File がそのまま来ても受け取る (★★ 実装差を吸収する)', async () => {
    const q = installLaunchQueue();
    const m = await import('../src/services/launchFiles');
    m.initLaunchFiles();
    const f = new File(['y'], 'b.mp4', { type: 'video/mp4' });
    await q.fire([f]);
    expect(m.takeLaunchFiles()).toEqual([f]);
  });

  it('★★ 取り出しても「何件来たか」は残る (★★★ 診断に出すため)', async () => {
    const q = installLaunchQueue();
    const m = await import('../src/services/launchFiles');
    m.initLaunchFiles();
    await q.fire([handleOf(new File(['z'], 'c.png', { type: 'image/png' }))]);
    m.takeLaunchFiles();
    expect(m.takeLaunchFiles()).toEqual([]);          // ★ 二度は取れない
    expect(m.getLaunchState().fileCount).toBe(1);     // ★★ 件数は消えない
  });

  it('★ getFile が失敗しても落ちない (★★ 他のファイルは拾う)', async () => {
    const q = installLaunchQueue();
    const m = await import('../src/services/launchFiles');
    m.initLaunchFiles();
    const ok = new File(['w'], 'd.jpg', { type: 'image/jpeg' });
    await q.fire([{ getFile: async () => { throw new Error('boom-ish'); } }, handleOf(ok)]);
    expect(m.takeLaunchFiles()).toEqual([ok]);
  });

  it('★★★ 後から購読した画面にも届く (★ /share が遅れて mount するため)', async () => {
    const q = installLaunchQueue();
    const m = await import('../src/services/launchFiles');
    m.initLaunchFiles();
    const seen: File[][] = [];
    m.onLaunchFiles((files) => seen.push(files));
    await q.fire([handleOf(new File(['v'], 'e.jpg', { type: 'image/jpeg' }))]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(1);
  });
});
