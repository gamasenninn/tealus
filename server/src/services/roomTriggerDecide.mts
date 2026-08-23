/**
 * ルームトリガー: 撃つ / 撃たない の判定 (#382 第 1 段)
 *
 * ★ 純関数。時計も「前回発火」も「直近の該当投稿」も引数で受ける。
 *   DB も now() も触らないので、時刻依存の分岐をテストで固定できる (docs/06 §6)。
 *
 * ★★ **必ず reason を返す。** fire=false の理由が残らないと、
 *   「議事録が来ていない」が「動画が無かった」なのか「壊れて動いていない」なのか
 *   区別できない。docs/06 §6 が「この機能でいちばん忘れられやすい」と名指ししている部分。
 */
import type { RoomTrigger } from './roomTriggers.mts';

export interface DecideContext {
  now: Date;
  /** このトリガーが最後に投稿した時刻。まだ無ければ null (§3.1.1 でルームから引く) */
  lastFiredAt: Date | null;
  /** 該当種別の直近の投稿時刻。無ければ null */
  latestMatchAt: Date | null;
  /**
   * ★ 初回の基準 = 設定ファイルの mtime (= このトリガーを有効にした時刻)。
   *
   * 一度も撃っていないと lastFiredAt が null で、「前回以降」が**部屋の全履歴**になる。
   * 2026-08-23 の dogfood で、有効化した瞬間に **4 週間前の画像**で発火した。
   * 本番の朝礼で同じことをすると、既に議事録がある動画にもう一度撃つ。
   *
   * ★★ これは状態ではない。**起点**なので §3.1.1 (状態を持たない) と矛盾しない ——
   *   一度撃てば lastFiredAt が優先され、以後 mtime は使われない。
   *   だから設定ファイルを触っても、既に動いているトリガーには影響しない。
   */
  bootstrapAt?: Date | null;
}

export interface Decision {
  fire: boolean;
  /** 撃つ / 撃たない のどちらでも埋まる。そのままログに出せる文にする */
  reason: string;
}

/** JST の暦日 (YYYY-MM-DD)。★ 時刻はすべて JST、UTC と混ぜない (docs/06 §6) */
export function jstDateKey(d: Date): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** JST のその日の 00:00 からの分 */
function jstMinutes(d: Date): number {
  const shifted = new Date(d.getTime() + 9 * 3600_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

export function decide(t: RoomTrigger, ctx: DecideContext): Decision {
  if (!t.enabled) return { fire: false, reason: '無効 (enabled: false)' };

  const { now, lastFiredAt, latestMatchAt } = ctx;
  const bootstrapAt = ctx.bootstrapAt ?? null;

  if (t.when === 'schedule') {
    const [h, m] = (t.at ?? '00:00').split(':').map(Number);
    const target = h * 60 + m;
    const nowMin = jstMinutes(now);
    if (nowMin < target) {
      return { fire: false, reason: `時刻前 (JST ${t.at} まで待ちます)` };
    }
    // ★ 同じ JST 暦日に撃っていれば終わり。大きく遅れて復帰しても 1 回だけ (§3.2)
    if (lastFiredAt && jstDateKey(lastFiredAt) === jstDateKey(now)) {
      return { fire: false, reason: `発火済み (JST ${jstDateKey(now)} 分は投稿済み)` };
    }
    // ★ 有効化より前の時刻は、その日ぶんを撃たない (§3.2「過ぎた時刻は撃たない」と同じ理屈)
    if (!lastFiredAt && bootstrapAt
        && jstDateKey(bootstrapAt) === jstDateKey(now) && jstMinutes(bootstrapAt) > target) {
      return { fire: false, reason: `有効化前 (JST ${t.at} は有効化より前なので本日分は撃ちません)` };
    }
    return { fire: true, reason: `JST ${t.at} を過ぎ、本日分は未投稿` };
  }

  // immediate / every はどちらも「該当種別の投稿があるか」が要る
  if (!latestMatchAt) {
    return { fire: false, reason: `投稿なし (${t.types.join('/')} が 1 件もありません)` };
  }

  // ★ 初回は「有効化より後の投稿」だけを見る。無いと部屋の全履歴が対象になる
  if (!lastFiredAt && bootstrapAt && latestMatchAt <= bootstrapAt) {
    return { fire: false, reason: '有効化前 (直近の該当投稿は設定を置くより前のものです)' };
  }

  if (t.when === 'immediate') {
    if (lastFiredAt && latestMatchAt <= lastFiredAt) {
      return { fire: false, reason: '発火済み (前回発火より後の投稿がありません)' };
    }
    return { fire: true, reason: '前回発火より後に該当投稿があります' };
  }

  // every: 間隔を過ぎ、かつ前回発火以降に投稿があること。
  // ★ 何周期ぶん溜まっていても 1 回しか撃たない —— 判定が真偽しか返さないので
  //   連射する余地が構造的に無い (§3.1 の「再起動の取りこぼしが自動的に片付く」)。
  if (lastFiredAt) {
    const elapsedMin = (now.getTime() - lastFiredAt.getTime()) / 60_000;
    if (elapsedMin < (t.interval_minutes ?? 0)) {
      return { fire: false, reason: `間隔 (前回発火から ${elapsedMin.toFixed(1)} 分 / ${t.interval_minutes} 分)` };
    }
    if (latestMatchAt <= lastFiredAt) {
      return { fire: false, reason: '投稿なし (前回発火より後の該当投稿がありません)' };
    }
  }
  return { fire: true, reason: '間隔を過ぎ、前回発火より後に該当投稿があります' };
}
