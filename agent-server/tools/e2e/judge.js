/**
 * LLM-as-judge layer for E2E scenarios (#262 Phase 2.b)
 *
 * 観察層 (warn-only) として、bot 応答を LLM に評価させて semantic correctness を採点する。
 * 決定論 layer (must_contain 等) で覆えない「内容として要件を満たしているか」を扱う。
 *
 * 設計方針:
 *   - 出力は { score: 0-100, pass: bool, reasoning: string }
 *   - score < min_score (default 70) → warn (fail にはしない、LLM 採点は variance あり)
 *   - judge 自体の失敗 (network / API key 等) → warn (`llm_judge: error: ...`)、scenario fail にはしない
 *   - cost cap: judge call は 1 scenario あたり 1 回、gpt-4o-mini で 1c 以下を想定
 */
const fetch = require('node-fetch');

// env は call-time に読む (test での mock + production での hot-swap 両対応)
function getJudgeModel() { return process.env.E2E_JUDGE_MODEL || 'gpt-4o-mini'; }
function getJudgeApiKey() { return process.env.E2E_JUDGE_API_KEY || process.env.OPENAI_API_KEY; }
const DEFAULT_MIN_SCORE = 70;

const SYSTEM_PROMPT = `You are an objective evaluator of an AI agent's response in an end-to-end test.
You will receive (1) the user's prompt, (2) the agent's actual response, (3) the tool chain the agent used, and (4) success criteria.
Score the response 0-100 based ONLY on whether it satisfies the criteria.

Output strict JSON only, in this exact shape:
{"score": <int 0-100>, "reasoning": "<one sentence explaining the score>"}

Scoring guidance:
- 90-100: fully satisfies all criteria, no notable gaps
- 70-89: satisfies the core ask but has minor gaps or imperfect coverage
- 50-69: partial — addresses some criteria but misses important parts
- 0-49: fails to address the ask, irrelevant, or self-reports inability ("見つかりませんでした" 等)

Be strict but fair. The agent has access to tools; if the response omits content the criteria require, that is a real gap.`;

function buildJudgePrompt(scenario, observed) {
  const tools = (observed.tool_calls || []).map(t => t.tool).join(' → ') || '(none)';
  const response = observed.bot_response_text || '(empty)';
  const criteria = scenario.llm_judge?.criteria || '(no criteria specified)';
  return `## User prompt
${scenario.prompt}

## Agent response
${response}

## Tool chain observed
${tools}

## Success criteria (judge against this)
${criteria}

Output strict JSON only: {"score": <int 0-100>, "reasoning": "<one sentence>"}`;
}

async function callJudgeApi(prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getJudgeApiKey()}`,
    },
    body: JSON.stringify({
      model: getJudgeModel(),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`judge API ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('judge API returned no content');
  return JSON.parse(content);
}

function normalizeJudgement(raw, minScore) {
  const score = Number.isFinite(raw?.score) ? Math.round(raw.score) : null;
  const reasoning = typeof raw?.reasoning === 'string' ? raw.reasoning : '(no reasoning)';
  if (score === null) {
    return { score: null, pass: false, reasoning: `invalid judge output: ${JSON.stringify(raw).slice(0, 120)}` };
  }
  return {
    score: Math.max(0, Math.min(100, score)),
    pass: score >= minScore,
    reasoning,
  };
}

/**
 * Run LLM-as-judge for one scenario. Returns null if scenario has no llm_judge config.
 * On any error, returns { error: '...' } instead of throwing — judge failures are warns, not fails.
 */
async function runJudge(scenario, observed) {
  if (!scenario.llm_judge) return null;
  if (!getJudgeApiKey()) {
    return { error: 'no E2E_JUDGE_API_KEY / OPENAI_API_KEY set, skipping LLM judge' };
  }
  const minScore = Number.isFinite(scenario.llm_judge.min_score)
    ? scenario.llm_judge.min_score
    : DEFAULT_MIN_SCORE;
  try {
    const prompt = buildJudgePrompt(scenario, observed);
    const raw = await callJudgeApi(prompt);
    return { ...normalizeJudgement(raw, minScore), min_score: minScore, model: getJudgeModel() };
  } catch (err) {
    return { error: err.message, min_score: minScore };
  }
}

module.exports = {
  runJudge,
  buildJudgePrompt,    // exported for tests
  normalizeJudgement,  // exported for tests
  DEFAULT_MIN_SCORE,
};
