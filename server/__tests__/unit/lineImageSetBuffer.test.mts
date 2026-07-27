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

import { ImageSetBuffer } from '../../src/services/lineImageSetBuffer.mts';
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
});
