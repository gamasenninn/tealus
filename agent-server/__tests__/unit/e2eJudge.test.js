/**
 * Unit tests for E2E LLM-as-judge layer (#262 Phase 2.b)
 *
 * judge.js は外部 API (OpenAI) を叩くので fetch を mock する。env は call-time
 * に読まれる設計のため、test 中で process.env を直接書き換えれば良い。
 */

jest.mock('node-fetch', () => jest.fn());
const fetch = require('node-fetch');
const { runJudge, normalizeJudgement, DEFAULT_MIN_SCORE } = require('../../tools/e2e/judge');

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  fetch.mockReset();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('e2e judge', () => {
  test('returns null when scenario has no llm_judge config', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const out = await runJudge({ id: 'X', prompt: 'hi' }, { bot_response_text: 'hello' });
    expect(out).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('returns error object when no API key is set', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.E2E_JUDGE_API_KEY;
    const scenario = { id: 'X', prompt: 'hi', llm_judge: { criteria: 'foo' } };
    const out = await runJudge(scenario, { bot_response_text: 'x' });
    expect(out).toEqual(expect.objectContaining({
      error: expect.stringMatching(/no E2E_JUDGE_API_KEY/),
    }));
  });

  test('parses score and pass=true when score >= min_score', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ score: 85, reasoning: 'looks good' }) } }],
      }),
    });
    const scenario = { id: 'X', prompt: 'hi', llm_judge: { criteria: 'foo', min_score: 70 } };
    const out = await runJudge(scenario, { bot_response_text: 'x', tool_calls: [] });
    expect(out.score).toBe(85);
    expect(out.pass).toBe(true);
    expect(out.reasoning).toBe('looks good');
    expect(out.min_score).toBe(70);
  });

  test('pass=false when score < min_score (warn but no fail)', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ score: 40, reasoning: 'missed criteria' }) } }],
      }),
    });
    const scenario = { id: 'X', prompt: 'hi', llm_judge: { criteria: 'foo', min_score: 70 } };
    const out = await runJudge(scenario, { bot_response_text: 'x', tool_calls: [] });
    expect(out.score).toBe(40);
    expect(out.pass).toBe(false);
  });

  test('returns error when API responds non-ok', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    });
    const scenario = { id: 'X', prompt: 'hi', llm_judge: { criteria: 'foo' } };
    const out = await runJudge(scenario, { bot_response_text: 'x', tool_calls: [] });
    expect(out.error).toMatch(/judge API 429/);
  });

  test('clamps score outside 0-100 range', () => {
    expect(normalizeJudgement({ score: 150, reasoning: 'r' }, 70).score).toBe(100);
    expect(normalizeJudgement({ score: -10, reasoning: 'r' }, 70).score).toBe(0);
  });

  test('handles invalid judge output gracefully', () => {
    const out = normalizeJudgement({ not_a_score: 'x' }, 70);
    expect(out.score).toBeNull();
    expect(out.pass).toBe(false);
    expect(out.reasoning).toMatch(/invalid judge output/);
  });

  test('uses DEFAULT_MIN_SCORE when min_score not provided', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ score: 75, reasoning: 'ok' }) } }],
      }),
    });
    const scenario = { id: 'X', prompt: 'hi', llm_judge: { criteria: 'foo' } }; // no min_score
    const out = await runJudge(scenario, { bot_response_text: 'x', tool_calls: [] });
    expect(out.min_score).toBe(DEFAULT_MIN_SCORE);
    expect(out.pass).toBe(75 >= DEFAULT_MIN_SCORE);
  });

  test('respects E2E_JUDGE_MODEL env override', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.E2E_JUDGE_MODEL = 'gpt-5.4-mini';
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ score: 90, reasoning: 'r' }) } }],
      }),
    });
    const scenario = { id: 'X', prompt: 'hi', llm_judge: { criteria: 'foo' } };
    const out = await runJudge(scenario, { bot_response_text: 'x', tool_calls: [] });
    expect(out.model).toBe('gpt-5.4-mini');
    const call = fetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.model).toBe('gpt-5.4-mini');
  });
});
