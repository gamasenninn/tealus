/**
 * Light v2 の使用量の記録 (改善ループ 15 回目、2026-10-24)
 * ★ 以前は input / output だけで、キャッシュの効いた分と考えた分を捨てていた。1 便 100 万超は warn
 */
jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));
const { lightV2UsageLine, describeToolCall } = require('../../src/agents/lightV2.mts') as typeof import('../../src/agents/lightV2.mts');

test('cached と reasoning も残す', () => {
  expect(lightV2UsageLine({ input_tokens: 120000, cached_input_tokens: 90000, output_tokens: 800, reasoning_output_tokens: 300 }))
    .toEqual({ level: 'info', line: '[LightV2] turn completed, usage: input=120000 cached=90000 output=800 reasoning=300' });
});

test('★ 1 便で 100 万を超えたら warn', () => {
  expect(lightV2UsageLine({ input_tokens: 2_697_599, output_tokens: 1 }).level).toBe('warn');
});

test('★ 道具の結果の大きさ (bytes) を残す', () => {
  const r = describeToolCall({ status: 'completed', server: 'tealus', tool: 'get_messages', result: { content: [{ type: 'text', text: 'あ'.repeat(10) }] } });
  expect(r.line).toMatch(/bytes=\d+/);
});
