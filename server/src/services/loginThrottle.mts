/**
 * #362 login の総当たり抑止 — ★ 数えるのは「失敗」だけ。
 *
 * ## なぜ失敗だけなのか (ここを変えると issue の分岐に戻る)
 *
 * `POST /api/auth/login` は無制限に叩けて、毎回 `bcrypt.compare` (cost 10) を踏む。
 * 素直に「全リクエストを N 回/分」で締めると、**cc-bridge が自分で自分を締め出す** —
 * #360 で接続に最大寿命 (既定 55 分) が入ったため、SKILL の常駐ループは
 * 55 分ごとに正当に login する (1 セッション日 26 回程度)。
 *
 * そこで bot 例外を作ると、#362 の議論どおり **例外の方が恒久化する**。
 *
 * ★ 失敗だけ数えれば分岐そのものが消える:
 *   - 総当たり攻撃 = 失敗の連打        → 当たる
 *   - cc-bridge の 55 分周期 = 必ず成功 → 当たらない (例外が要らない)
 *
 * ★★ この性質は「成功でカウンタを消す」ことに依存している。消すのをやめると、
 *    長時間動く正当なクライアントが失敗 1 回ずつを溜めて、いつか塞がる。
 *
 * ## 鍵
 *
 * IP + login_id。IP だけだと NAT の内側が巻き添えになり、login_id だけだと
 * 攻撃者が ID を変えるだけで逃げられる。
 *
 * ## 保存先
 *
 * プロセス内 Map。Tealus は「1 台・1 プロセス・同一オリジン」を核にしているので
 * Redis を挟まない。再起動でカウンタが消えるが、**失効側に倒れる (= 塞ぎすぎない)**
 * ので安全側。
 *
 * ★ 口は外部から到達可能 (Cloudflare を迂回して origin に直接届くことも実測済 = #362)
 *   なので、鍵は攻撃者が自由に作れる。**際限なく溜まらないこと**が要件に入る。
 *
 * 純粋・時計注入・DB 非依存。
 */

/** 既定: 15 分の窓で 5 回失敗したら塞ぐ */
export const DEFAULT_MAX_FAILURES = 5;
export const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
/** 保持する鍵の上限。超えたら古いものから落とす (攻撃者に memory を伸ばされないため) */
export const DEFAULT_MAX_KEYS = 10_000;

export interface LoginThrottleOptions {
  maxFailures?: number;
  windowMs?: number;
  maxKeys?: number;
  /** 時計 (テストで注入) */
  now?: () => number;
}

export interface ThrottleVerdict {
  blocked: boolean;
  /** 塞いでいるとき、あと何秒待てば開くか (Retry-After 用) */
  retryAfterSec: number;
}

export interface LoginThrottle {
  check(key: string): ThrottleVerdict;
  recordFailure(key: string): void;
  recordSuccess(key: string): void;
  /** 窓を過ぎた鍵を落とす */
  prune(): void;
  size(): number;
}

/**
 * 鍵を綴じる。
 * ★ 区切りに使う文字が login_id 側に入っていても衝突しないよう、長さを前置する。
 *   ("1.2.3.4" + "a|b") と ("1.2.3.4|a" + "b") が同じ鍵になってはいけない。
 */
export function keyOf(ip: string, loginId: string): string {
  return `${ip.length}:${ip}|${loginId}`;
}

export function createLoginThrottle(options: LoginThrottleOptions = {}): LoginThrottle {
  const maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const now = options.now ?? Date.now;

  /** 鍵 → 窓の中の失敗時刻 (古い順) */
  const failures = new Map<string, number[]>();

  /** 窓の外に出た失敗を落として、残りを返す */
  function live(key: string): number[] {
    const list = failures.get(key);
    if (!list) return [];
    const cutoff = now() - windowMs;
    const kept = list.filter((t) => t > cutoff);
    if (kept.length === 0) failures.delete(key);
    else if (kept.length !== list.length) failures.set(key, kept);
    return kept;
  }

  /**
   * 鍵が上限を超えたら落とす。
   * ★ いま塞いでいる鍵は落とさない — 落とすと攻撃者が雑音で自分の枠を洗い流せてしまう。
   */
  function evictIfNeeded(): void {
    if (failures.size <= maxKeys) return;
    for (const [k, list] of failures) {
      if (failures.size <= maxKeys) break;
      if (list.length >= maxFailures) continue; // 塞いでいる鍵は残す
      failures.delete(k);
    }
  }

  return {
    check(key: string): ThrottleVerdict {
      const list = live(key);
      if (list.length < maxFailures) return { blocked: false, retryAfterSec: 0 };
      // 窓は滑るので、いちばん古い失敗が窓から出れば 1 枠空く
      const opensAt = list[0] + windowMs;
      return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((opensAt - now()) / 1000)) };
    },

    recordFailure(key: string): void {
      const list = live(key);
      list.push(now());
      failures.set(key, list);
      evictIfNeeded();
    },

    // ★ 成功で消す。これをやめると、長く動く正当なクライアントがいつか塞がる。
    recordSuccess(key: string): void {
      failures.delete(key);
    },

    prune(): void {
      for (const key of [...failures.keys()]) live(key);
    },

    size(): number {
      return failures.size;
    },
  };
}
