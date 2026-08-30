/**
 * 上流が落ちているとき、proxy が応答を返すか (#359 / 2026-08-30)
 *
 * ★ 何を守るテストか: **`on.error` を渡すと既定のエラー応答が外れる**という
 *   `http-proxy-middleware` の仕様に、こちらが気づかず 60 秒ハングを作っていた。
 *
 * ```
 * dist/get-plugins.js
 *   // don't load default errorResponsePlugin if user has specified their own
 *   const maybeErrorResponsePlugin = options.on?.error ? [] : [errorResponsePlugin];
 * ```
 *
 * ★★ 実害: agent-server が落ちている 4〜6 秒の窓に来た要求が、応答を返されないまま
 *   nginx の `proxy_read_timeout 60s` まで掴まれた (2026-08-30 実測 60.04s)。
 *   **ダウン 6 秒に対して罰が 60 秒**という非対称になっていた。
 *
 * ★★★ このテストは app.mts を読まない。**ライブラリの挙動を直接固定する**ので、
 *   http-proxy-middleware を上げたときに前提が変わっていれば、ここが落ちる。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import request from 'supertest';
import { createProxyMiddleware, errorResponsePlugin, type Options } from 'http-proxy-middleware';

/** 誰も listen していない port。接続すると ECONNREFUSED になる */
const DEAD_TARGET = 'http://127.0.0.1:1';

function appWith(options: Options<IncomingMessage, ServerResponse>) {
  const app = express();
  app.use('/proxied', createProxyMiddleware(options));
  return app;
}

describe('上流が落ちているときの proxy 応答', () => {
  test('既定 (on.error なし): 504 が返る', async () => {
    const res = await request(appWith({ target: DEAD_TARGET, changeOrigin: true })).get('/proxied/x');
    expect(res.status).toBe(504);
  });

  test('★ on.error を渡すと既定が外れ、応答が返らない (これが 60 秒ハングの正体)', async () => {
    const app = appWith({
      target: DEAD_TARGET,
      changeOrigin: true,
      on: { error: () => { /* 記録だけして res に触らない = 修正前の実装 */ } },
    });
    // 応答が来ないことを確かめるので、短い timeout で「来なかった」を判定する
    await expect(
      request(app).get('/proxied/x').timeout({ deadline: 800 })
    ).rejects.toThrow();
  });

  test('★★ on.error + plugins:[errorResponsePlugin] なら、記録しつつ 504 を返す', async () => {
    const seen: string[] = [];
    const app = appWith({
      target: DEAD_TARGET,
      changeOrigin: true,
      plugins: [errorResponsePlugin],
      on: { error: (err: Error) => { seen.push(err.message); } },
    });

    const res = await request(app).get('/proxied/x');

    expect(res.status).toBe(504);          // ★ ECONNREFUSED → 504 (502 ではない)
    expect(seen).toHaveLength(1);          // ★★ こちらの記録も走っている (両方走る)
  });

  test('★ 応答は即座に返る (60 秒待たされない)', async () => {
    const app = appWith({
      target: DEAD_TARGET,
      changeOrigin: true,
      plugins: [errorResponsePlugin],
      on: { error: () => {} },
    });

    const started = Date.now();
    await request(app).get('/proxied/x');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
