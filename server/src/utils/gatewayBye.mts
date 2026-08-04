/**
 * #368 停止時に agent-server へ「中継が落ちる」を伝える (段 2 の本体サーバ側)。
 *
 * ★ なぜ本体サーバが直接 cc-queue の購読者に予告できないか:
 *   本体サーバは「自分が落ちる」を知っているが**購読者を知らない**。agent-server は
 *   購読者を知っているが「本体が落ちる」を知らない。**情報と、配る能力が別プロセスに
 *   ある**ので、一段渡す必要がある (docs/05「片側から配る」の、初めて 1 ホップで
 *   済まない形)。
 *
 * ★ 認可に共有 JWT を使う理由:
 *   agent-server から見ると、本体サーバの `/agent-api` proxy 経由で来た**外部リクエストも
 *   loopback から届く**。したがって「送信元が localhost なら許可」は成立しない
 *   (`https://<host>/agent-api/cc-queue/gateway-bye` で破れる)。agent-server の
 *   他の口と同じ共有 JWT で守る。
 *
 * secret / fetch を引数で受け取るのは、`middleware/auth.mts` を import すると
 * `db/pool.mts` が芋づるで読み込まれるため (テストを DB から切り離す)。
 *
 * @module utils/gatewayBye
 */
import jwt from 'jsonwebtoken';

/** 停止処理の中でしか使わないので、トークンは短命にする。 */
const TOKEN_TTL_SEC = 60;

/** 応答が返らないときに停止処理を人質に取らせないための上限。 */
const DEFAULT_TIMEOUT_MS = 1000;

export interface GatewayByeOptions {
  /** agent-server の待ち受けポート (本番は process.env.AGENT_PORT || 4000)。 */
  port: number | string;
  /** server と agent-server で共有している JWT_SECRET。 */
  secret: string;
  /** 「戻ってくるまでの見込み」。★ 値を知っているのは停止する側なので、こちらから渡す。 */
  expectBackMs: number;
  /** 応答待ちの上限 (既定 1000ms)。 */
  timeoutMs?: number;
  /** テスト用の差し替え。 */
  fetchImpl?: typeof fetch;
}

/**
 * agent-server に停止を伝え、cc-queue の購読者へ `reason: "gateway_restart"` を配らせる。
 *
 * ★ 失敗は throw する。停止処理側 (`utils/shutdown.mts`) が warn に落として続行する契約
 *   (agent-server が既に落ちている、まだ起動していない、等は普通に起こりうる)。
 *
 * @returns 予告が届いた購読者数 (0 なら誰も繋いでいない)
 */
export async function notifyGatewayBye(opts: GatewayByeOptions): Promise<number> {
  const { port, secret, expectBackMs } = opts;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  const token = jwt.sign({ id: 'tealus-server', login_id: 'SYSTEM' }, secret, { expiresIn: TOKEN_TTL_SEC });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`http://localhost:${port}/cc-queue/gateway-bye`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ expect_back_ms: expectBackMs }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`agent-server が ${res.status} を返しました`);
    const body = await res.json() as { notified?: number };
    return typeof body?.notified === 'number' ? body.notified : 0;
  } finally {
    clearTimeout(timer);
  }
}
