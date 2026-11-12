/**
 * lineImageSetBuffer unit test (#353)
 *
 * LINE 複数画像同時送信 (imageSet) の再構成バッファ。
 * - webhook は画像ごと別イベント + 順不同 (= LINE Messaging API 仕様)
 * - total 到達で即 flush / 未達は flushDelayMs で部分 flush (degrade)
 * - flush 時は index 昇順ソート
 * - テストは自前インスタンス生成 (= module 状態ゼロ原則、docs/05)
 */
jest.mock('../../src/utils/logger.mts', () => ({ logger: {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} }));

import { ImageSetBuffer, imageSetContent } from '../../src/services/lineImageSetBuffer.mts';
import type { BufferedImage, ImageSetFlushContext } from '../../src/services/lineImageSetBuffer.mts';
import type { SavedLineContent } from '../../src/services/lineBridge.mts';

/** mediaInfo scaffold (= saveLineContentToFile return 同型、最小 field) */
function mkMedia(name: string): SavedLineContent {
  return {
    filePath: `/tmp/media-test/line-images/${name}`,
    relativePath: `line-images/${name}`,
    fileName: name,
    mimeType: 'image/jpeg',
    fileSize: 100,
  } as SavedLineContent;
}

function mkImage(index: number, name: string): BufferedImage {
  return { index, mediaInfo: mkMedia(name) };
}

const CTX: ImageSetFlushContext = {
  roomId: 'room-X',
  sender: { id: 'bot-1', display_name: 'LINE Bridge', avatar_url: null },
  content: '[小野仙人@出品写真・動画]',
  io: null,
};

/** onFlush の呼び出しを待つ (= 非同期 flush handler drain 用) */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('ImageSetBuffer', () => {
  test('total 到達で即 flush、index 昇順ソート (= 順不同到着を再構成)', async () => {
    const onFlush = jest.fn();
    const buf = new ImageSetBuffer({ flushDelayMs: 60_000, onFlush });

    // ★ 順不同: index 2 が先に届く (= LINE 仕様「undefined order」)
    const first = buf.add('set-1', 2, mkImage(2, 'b.jpg'), CTX);
    expect(first).toBe(false); // まだ貯め
    expect(onFlush).not.toHaveBeenCalled();

    const second = buf.add('set-1', 2, mkImage(1, 'a.jpg'), CTX);
    expect(second).toBe(true); // total 到達 = flush
    await tick();

    expect(onFlush).toHaveBeenCalledTimes(1);
    const [ctx, images] = onFlush.mock.calls[0] as [ImageSetFlushContext, BufferedImage[]];
    expect(ctx).toEqual(CTX);
    expect(images.map((i) => i.mediaInfo.fileName)).toEqual(['a.jpg', 'b.jpg']); // sorted
    expect(buf.pendingCount()).toBe(0);
  });

  test('total 未達は flushDelayMs 経過で部分 flush (= 1枚欠けても止まらない degrade)', async () => {
    const onFlush = jest.fn();
    const buf = new ImageSetBuffer({ flushDelayMs: 30, onFlush });

    buf.add('set-2', 3, mkImage(3, 'c.jpg'), CTX);
    buf.add('set-2', 3, mkImage(1, 'a.jpg'), CTX);
    expect(onFlush).not.toHaveBeenCalled();

    await new Promise((r) => setTimeout(r, 80));

    expect(onFlush).toHaveBeenCalledTimes(1);
    const [, images] = onFlush.mock.calls[0] as [ImageSetFlushContext, BufferedImage[]];
    expect(images.map((i) => i.index)).toEqual([1, 3]); // 届いた分のみ・sorted
    expect(buf.pendingCount()).toBe(0);
  });

  test('別 setId は独立して貯まる + ctx は各 set の初回イベント基準', async () => {
    const onFlush = jest.fn();
    const buf = new ImageSetBuffer({ flushDelayMs: 60_000, onFlush });

    const ctxB: ImageSetFlushContext = { ...CTX, roomId: 'room-Y' };
    buf.add('set-a', 2, mkImage(1, 'a1.jpg'), CTX);
    buf.add('set-b', 2, mkImage(1, 'b1.jpg'), ctxB);
    expect(buf.pendingCount()).toBe(2);

    buf.add('set-b', 2, mkImage(2, 'b2.jpg'), ctxB);
    await tick();

    expect(onFlush).toHaveBeenCalledTimes(1); // set-b のみ flush
    const [ctx] = onFlush.mock.calls[0] as [ImageSetFlushContext, BufferedImage[]];
    expect(ctx.roomId).toBe('room-Y');
    expect(buf.pendingCount()).toBe(1); // set-a は残る
  });

  test('flush 後の同一 setId は新規 set として扱う (= stale state なし)', async () => {
    const onFlush = jest.fn();
    const buf = new ImageSetBuffer({ flushDelayMs: 60_000, onFlush });

    buf.add('set-r', 1, mkImage(1, 'x.jpg'), CTX);
    await tick();
    expect(onFlush).toHaveBeenCalledTimes(1);

    const flushed = buf.add('set-r', 2, mkImage(1, 'y.jpg'), CTX);
    expect(flushed).toBe(false); // 新 set として貯め直し
    expect(buf.pendingCount()).toBe(1);
  });

  test('onFlush の reject は握りつぶす (= webhook dispatch を阻害しない)', async () => {
    const onFlush = jest.fn(() => Promise.reject(new Error('post failed')));
    const buf = new ImageSetBuffer({ flushDelayMs: 60_000, onFlush });

    expect(() => buf.add('set-e', 1, mkImage(1, 'x.jpg'), CTX)).not.toThrow();
    await tick();
    expect(onFlush).toHaveBeenCalledTimes(1);
    // unhandled rejection にならないこと (= 到達すれば OK、jest が unhandled を検知したら fail する)
  });
  /**
   * #552 待ち時間は「最後の 1 枚から」。以前は最初の 1 枚から固定で、届くのが遅い日は 1 つのアルバムが 2〜7 投稿に割れた
   *   (10-04 は 10 枚が 7 投稿。本番の到着間隔は遅い日で 3〜60 秒)
   */
  test('★ #552 画像が届くたびに待ち時間を張り直す (間隔が空いても 1 投稿にまとまる)', async () => {
    const onFlush = jest.fn();
    const buf = new ImageSetBuffer({ flushDelayMs: 60, maxWaitMs: 10_000, onFlush });
    buf.add('set-slow', 3, mkImage(1, 'a.jpg'), CTX);
    await new Promise((r) => setTimeout(r, 40));
    buf.add('set-slow', 3, mkImage(2, 'b.jpg'), CTX);   // 最初から 40ms: 張り直し
    await new Promise((r) => setTimeout(r, 40));        // 最初から 80ms (> 60ms) でも、最後から 40ms
    expect(onFlush).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 60));
    expect(onFlush).toHaveBeenCalledTimes(1);
    const [, images] = onFlush.mock.calls[0] as [ImageSetFlushContext, BufferedImage[]];
    expect(images.map((i) => i.index)).toEqual([1, 2]);
  });

  test('★ #552 届き続けても、最初の 1 枚から maxWaitMs で打ち切る', async () => {
    const onFlush = jest.fn();
    const buf = new ImageSetBuffer({ flushDelayMs: 60, maxWaitMs: 120, onFlush });
    buf.add('set-drip', 10, mkImage(1, 'a.jpg'), CTX);
    for (let i = 2; i <= 4; i++) {
      await new Promise((r) => setTimeout(r, 40));
      buf.add('set-drip', 10, mkImage(i, `${i}.jpg`), CTX);
    }
    // 最初から約 120ms。最後から 0ms だが、上限で打ち切られている
    await new Promise((r) => setTimeout(r, 30));
    expect(onFlush).toHaveBeenCalledTimes(1);
  });
});

/**
 * #646 LINE の組が欠けたまま時間切れで投稿するとき、読む人に「欠けた」と分かるようにする
 * ★ 2026-11-03 11:53 に 10 枚中 9 枚で投稿された (10 枚目の webhook が本体に届いていない)。投稿を見ても欠けたと分からなかった。
 *   LINE が 9 枚の組で送ったもの (19 枚 = 10 + 9) は欠けていないので、文を添えるのは時間切れで数が足りないときだけ
 */
describe('#646 欠けた組の知らせ', () => {
  test('★ flush に組の枚数と理由を渡す', async () => {
    const onFlush = jest.fn();
    const buf = new ImageSetBuffer({ flushDelayMs: 30, onFlush });
    buf.add('set-m', 3, mkImage(1, 'a.jpg'), CTX);
    await new Promise((r) => setTimeout(r, 80));
    expect(onFlush.mock.calls[0][2]).toEqual({ total: 3, reason: 'timeout' });

    buf.add('set-n', 1 + 1, mkImage(1, 'a.jpg'), CTX);
    buf.add('set-n', 2, mkImage(2, 'b.jpg'), CTX);
    expect(onFlush.mock.calls[1][2]).toEqual({ total: 2, reason: 'complete' });
  });

  test('★ 時間切れで足りないときだけ、本文に「N 枚中 M 枚だけ」を添える', () => {
    expect(imageSetContent('[LINE: 小野]', 9, { total: 10, reason: 'timeout' }))
      .toBe('[LINE: 小野]\n(LINE から 10 枚中 9 枚だけ届きました。残りの 1 枚はこちらに届いていません)');
    expect(imageSetContent(undefined, 9, { total: 10, reason: 'timeout' }))
      .toBe('(LINE から 10 枚中 9 枚だけ届きました。残りの 1 枚はこちらに届いていません)');
    expect(imageSetContent('[LINE: 小野]', 9, { total: 9, reason: 'complete' })).toBe('[LINE: 小野]');
    expect(imageSetContent(undefined, 10, { total: 10, reason: 'complete' })).toBeUndefined();
  });
});

/**
 * 改善ループ 46 (2026-11-12) 本体を止めるとき、貯まり中の束を投稿してから止める。
 * ★ 束はメモリの中だけにあり、LINE には 200 を返し済み (再送されない)。以前は停止で投稿 0 のまま消えていた
 *   (先頭のコメントの「バラバラ投影に degrade」は誤り。onFlush が呼ばれないので 1 枚も投稿されない)
 */
describe('停止のときの flushAll', () => {
  test('★ 貯まり中の束をすべて時間切れ扱いで投稿し、投稿が終わるまで待つ', async () => {
    const done: string[] = [];
    const onFlush = jest.fn(async (_ctx: ImageSetFlushContext, images: BufferedImage[], _meta?: unknown) => {
      await new Promise((r) => setTimeout(r, 10));
      done.push(images.map((i) => i.mediaInfo.fileName).join(','));
    });
    const buf = new ImageSetBuffer({ flushDelayMs: 60_000, onFlush });
    buf.add('set-s1', 3, mkImage(2, 'b.jpg'), CTX);
    buf.add('set-s1', 3, mkImage(1, 'a.jpg'), CTX);
    buf.add('set-s2', 2, mkImage(1, 'c.jpg'), CTX);

    const n = await buf.flushAll();

    expect(n).toBe(2);
    expect(done.sort()).toEqual(['a.jpg,b.jpg', 'c.jpg']);   // ★ 待っている (await の後に全部終わっている)・順に並べ直す
    expect(onFlush.mock.calls.map((c) => c[2])).toEqual([
      { total: 3, reason: 'shutdown' },
      { total: 2, reason: 'shutdown' },
    ]);
    expect(buf.pendingCount()).toBe(0);
  });

  test('★ 改善ループ 47: 停止で先に投稿した束には「届いていません」でなく「再起動で先に投稿した」と添える (残りは再起動後に別の投稿で届く)', () => {
    expect(imageSetContent(undefined, 4, { total: 10, reason: 'shutdown' }))
      .toBe('(本体の再起動のため、LINE の 10 枚中 4 枚を先に投稿しました。残りは別の投稿になることがあります)');
    expect(imageSetContent('[LINE: 小野]', 4, { total: 10, reason: 'shutdown' }))
      .toBe('[LINE: 小野]\n(本体の再起動のため、LINE の 10 枚中 4 枚を先に投稿しました。残りは別の投稿になることがあります)');
    expect(imageSetContent(undefined, 3, { total: 3, reason: 'shutdown' })).toBeUndefined();
  });

  test('貯まり中が無ければ 0 を返し、何も投稿しない', async () => {
    const onFlush = jest.fn();
    const buf = new ImageSetBuffer({ flushDelayMs: 60_000, onFlush });
    expect(await buf.flushAll()).toBe(0);
    expect(onFlush).not.toHaveBeenCalled();
  });

  test('投稿に失敗しても投げない (停止を止めない)', async () => {
    const onFlush = jest.fn(() => Promise.reject(new Error('db down')));
    const buf = new ImageSetBuffer({ flushDelayMs: 60_000, onFlush });
    buf.add('set-f', 2, mkImage(1, 'a.jpg'), CTX);
    await expect(buf.flushAll()).resolves.toBe(1);
  });
});
