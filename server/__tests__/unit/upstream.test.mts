/**
 * #556 本体が agent-server / rtc-server / MCP HTTP を呼ぶ宛先は 1 か所で決める。
 * ★ 以前はどれも http://localhost:<port> の固定で、docker-compose.full.yml (別コンテナ) では届かなかった
 * ★ 未設定なら今までどおり localhost + ポート (1 台で動かしている人は何もしなくてよい)
 */
import { agentUrl, rtcUrl, mcpHttpUrl } from '../../src/lib/upstream.mts';

const KEYS = ['AGENT_URL', 'AGENT_PORT', 'RTC_URL', 'RTC_PORT', 'MCP_HTTP_URL', 'MCP_HTTP_PORT'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

test('未設定なら今までどおり localhost の既定のポート', () => {
  expect(agentUrl()).toBe('http://localhost:4000');
  expect(rtcUrl()).toBe('http://localhost:3100');
  expect(mcpHttpUrl()).toBe('http://localhost:3200');
});

test('ポートだけ変えたら localhost + そのポート (今までの AGENT_PORT などと同じ)', () => {
  process.env.AGENT_PORT = '4100';
  process.env.RTC_PORT = '3101';
  expect(agentUrl()).toBe('http://localhost:4100');
  expect(rtcUrl()).toBe('http://localhost:3101');
});

test('★ URL を設定したらそれを使う (別コンテナの名前を書ける)。末尾の / は落とす', () => {
  process.env.AGENT_URL = 'http://agent-server:4000/';
  process.env.RTC_URL = 'http://rtc:3100';
  process.env.MCP_HTTP_URL = 'http://mcp:3200';
  expect(agentUrl()).toBe('http://agent-server:4000');
  expect(rtcUrl()).toBe('http://rtc:3100');
  expect(mcpHttpUrl()).toBe('http://mcp:3200');
});
