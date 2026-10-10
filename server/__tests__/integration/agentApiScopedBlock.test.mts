/**
 * #564 agent-server の中継 (/tealus-scoped/<鍵>) は同じマシンの道具のための口。本体の /agent-api からは流さない。
 * ★ テストでは agent-server が動いていないので、流した結果の失敗と区別できるよう、本体が自分で断った本文まで見る
 */
import request from 'supertest';
import { app } from '../../src/app.mts';

test('★ /agent-api/tealus-scoped/… は agent-server へ流さず、本体が 404 で断る', async () => {
  const res = await request(app).get('/agent-api/tealus-scoped/abc/api/bot/rooms');
  expect(res.status).toBe(404);
  expect(res.body.error).toMatch(/中継しません/);
});
