/**
 * LINE imageSet 再構成バッファ (#353)
 *
 * LINE で複数画像を同時送信すると、画像ごとに別々の webhook イベントが★ 順不同で届く
 * (= LINE Messaging API 仕様。各イベントに imageSet { id, index, total } が付く)。
 * 本バッファは imageSet.id 単位で画像を貯め、1 メッセージに束ねて flush する。
 *
 * 設計:
 * - ★ in-memory Map (= Redis 不使用)。「1台・1プロセス・同一オリジン」構成の前提に沿い、
 *   アルバムの webhook 群は数秒内に届くため短命 state で足りる (プロセス再起動で消えても
 *   最悪「バラバラ投影に degrade」であり事故にならない)
 * - flush 条件: total 枚そろったら即 / そろわなくても最後の 1 枚から flushDelayMs (最初から maxWaitMs で打ち切り) で部分 flush (#552)
 *   (= 1 枚の fetch 失敗や webhook 欠落でも止まらない)
 * - flush 時は imageSet.index 昇順にソート (= 順不同到着の再構成)
 * - onFlush の失敗は握りつぶして warn (= webhook dispatch を阻害しない、lineBridge 系の作法)
 * - ★ class 化し flushDelayMs / onFlush を注入可能に (= テストは自前インスタンス生成、
 *   module 状態ゼロ原則 docs/05 と両立。本番は routes/line.mts が 1 個だけ生成)
 *
 * @module services/lineImageSetBuffer
 */
import type { Server } from 'socket.io';
import { logger } from '../utils/logger.mts';
import type { SavedLineContent } from './lineBridge.mts';
import type { LineSenderContext } from './lineMessageBridge.mts';

/** バッファに積む 1 画像 (= index は imageSet.index) */
export interface BufferedImage {
  index: number;
  mediaInfo: SavedLineContent;
  /** ★ #490 LINE の便の ID (束の全部を 1 投稿へ記録して、どの 1 枚が引用されても引き当てる) */
  lineMessageId?: string;
}

/** flush 時に投稿へ引き渡す文脈 (= set 内の初回イベント基準で確定) */
export interface ImageSetFlushContext {
  roomId: string;
  sender: LineSenderContext;
  content?: string;
  io?: Server | null;
}

export type ImageSetFlushHandler = (
  ctx: ImageSetFlushContext,
  images: BufferedImage[]
) => void | Promise<void>;

/** 貯まり中の 1 set */
interface PendingSet {
  ctx: ImageSetFlushContext;
  total: number;
  images: BufferedImage[];
  timer: NodeJS.Timeout;
  firstAt: number;
}

/**
 * ★ #552 待ち時間は「最後の 1 枚から」。以前は最初の 1 枚から 15 秒の固定で、届くのが遅い日は
 *   1 つのアルバムが 2〜7 投稿に割れた (本番の到着間隔: ふだん 1 秒前後、遅いアルバムで 3〜60 秒)。
 *   届き続けても最初の 1 枚から DEFAULT_MAX_WAIT_MS で打ち切る (欠けた束を待ち続けない)
 */
export const DEFAULT_FLUSH_DELAY_MS = 60_000;
export const DEFAULT_MAX_WAIT_MS = 300_000;

export class ImageSetBuffer {
  private pending = new Map<string, PendingSet>();
  private flushDelayMs: number;
  private maxWaitMs: number;
  private onFlush: ImageSetFlushHandler;

  constructor(options: { flushDelayMs?: number; maxWaitMs?: number; onFlush: ImageSetFlushHandler }) {
    this.flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.onFlush = options.onFlush;
  }

  /** 最後の 1 枚から flushDelayMs、ただし最初の 1 枚から maxWaitMs を超えない */
  private arm(setId: string, firstAt: number): NodeJS.Timeout {
    const left = Math.max(0, this.maxWaitMs - (Date.now() - firstAt));
    const timer = setTimeout(() => this.flush(setId, 'timeout'), Math.min(this.flushDelayMs, left));
    timer.unref?.();   // プロセス終了を妨げない
    return timer;
  }

  /**
   * 画像を set に積む。total 到達なら即 flush。
   *
   * @param setId - imageSet.id
   * @param total - imageSet.total
   * @param image - index + 保存済み mediaInfo
   * @param ctx - 投稿文脈 (★ set の初回イベントのものが flush まで保持される)
   * @returns true = この add で flush された / false = まだ貯め (or timeout 待ち)
   */
  add(setId: string, total: number, image: BufferedImage, ctx: ImageSetFlushContext): boolean {
    let set = this.pending.get(setId);
    if (!set) {
      const firstAt = Date.now();
      set = { ctx, total, images: [], firstAt, timer: this.arm(setId, firstAt) };
      this.pending.set(setId, set);
    } else {
      clearTimeout(set.timer);                       // ★ #552 届くたびに張り直す
      set.timer = this.arm(setId, set.firstAt);
    }
    set.images.push(image);

    if (set.images.length >= set.total) {
      this.flush(setId, 'complete');
      return true;
    }
    return false;
  }

  /** 貯まり中 set 数 (= テスト/観測用) */
  pendingCount(): number {
    return this.pending.size;
  }

  private flush(setId: string, reason: 'complete' | 'timeout'): void {
    const set = this.pending.get(setId);
    if (!set) return; // 既に flush 済 (= complete と timeout の race 防御)
    this.pending.delete(setId);
    clearTimeout(set.timer);

    const images = [...set.images].sort((a, b) => a.index - b.index);
    if (reason === 'timeout') {
      logger.warn(
        `[lineImageSetBuffer] timeout flush: set=${setId} arrived=${images.length}/${set.total} (= 部分 flush degrade)`
      );
    }
    // onFlush 失敗は webhook dispatch を阻害しない
    Promise.resolve(this.onFlush(set.ctx, images)).catch((err: unknown) => {
      logger.error(
        `[lineImageSetBuffer] flush post failed: set=${setId} ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }
}
