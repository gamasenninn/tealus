/**
 * 写真の保存 (2026-11-05 小野さん、iPhone の Safari)
 *
 * ★ 写真を開いて ⬇ を押すと、Safari は画像ファイルそのものの画面 (「"プレビュー" で開く」) へ移ってしまい、
 *   Tealus に戻る道が無かった (<a download> を押しただけ)。共有シートが使える端末 (iPhone・Android) では
 *   ファイルを取ってきて共有シートを開く (「画像を保存」が出る)。使えない端末 (PC) は今までどおりダウンロード
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveMediaFile, saveMediaFiles } from '../src/utils/saveMedia';

describe('saveMediaFiles (まとめて保存)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['x'], { type: 'image/jpeg' }), { status: 200 })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('★ 共有シートでファイルを渡せる端末では、全部を 1 回の共有シートで渡す', async () => {
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });
    await saveMediaFiles([{ path: 'images/a.jpg', name: 'a.jpg' }, { path: 'images/b.jpg', name: 'b.jpg' }]);
    expect(share).toHaveBeenCalledTimes(1);
    expect((share.mock.calls[0] as unknown as [{ files: File[] }])[0].files.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg']);
  });
});

describe('saveMediaFile', () => {
  const blob = new Blob(['x'], { type: 'image/jpeg' });
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(blob, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('★ 共有シートでファイルを渡せる端末では、画面を移らず共有シートを開く', async () => {
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    await saveMediaFile('images/a.jpg', 'a.jpg');
    expect(share).toHaveBeenCalledTimes(1);
    const arg = (share.mock.calls[0] as unknown as [{ files: File[] }])[0];
    expect(arg.files[0].name).toBe('a.jpg');
    expect(click).not.toHaveBeenCalled();
  });

  it('共有をやめた (キャンセル) ときは何もしない (ダウンロードに切り替えない)', async () => {
    const share = vi.fn(async () => { throw new DOMException('cancel', 'AbortError'); });
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    await saveMediaFile('images/a.jpg', 'a.jpg');
    expect(click).not.toHaveBeenCalled();
  });

  it('共有シートが無い端末 (PC) は、今までどおりダウンロード (★ 新しいタブで。同じタブだと iPhone で戻れない)', async () => {
    vi.stubGlobal('navigator', { ...navigator, canShare: undefined, share: undefined });
    let target = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { target = this.target; });
    await saveMediaFile('images/a.jpg', 'a.jpg');
    expect(click).toHaveBeenCalledTimes(1);
    expect(target).toBe('_blank');
  });

  it('★ 共有を断られた (押した直後の扱いが切れた) ときは、新しいタブのダウンロードに切り替える', async () => {
    const share = vi.fn(async () => { throw new DOMException('no gesture', 'NotAllowedError'); });
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await saveMediaFile('images/a.jpg', 'a.jpg');
    expect(click).toHaveBeenCalledTimes(1);
  });
});
