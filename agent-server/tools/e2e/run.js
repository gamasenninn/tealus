#!/usr/bin/env node
/**
 * Light agent E2E verification harness — runner CLI (#262)
 *
 * Usage:
 *   node agent-server/tools/e2e/run.js [--filter S1,S2] [--dry-run]
 *
 * 詳細: agent-server/tools/e2e/README.md
 */
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const SCRIPT_DIR = __dirname;
const SCENARIOS_PATH = path.join(SCRIPT_DIR, 'scenarios.json');
const REPORT_DIR = path.join(__dirname, '../../../report/e2e-runs');

// ---- args ----
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const filterArg = args.find(a => a.startsWith('--filter='));
const filterIds = filterArg ? filterArg.slice('--filter='.length).split(',').map(s => s.trim()) : null;

// ---- env ----
const TEALUS_API_URL = process.env.TEALUS_API_URL || 'http://localhost:3000';
const E2E_BOT_ID = process.env.TEALUS_E2E_BOT_ID;
const E2E_BOT_PASS = process.env.TEALUS_E2E_BOT_PASS;
const E2E_ROOM_ID = process.env.TEALUS_E2E_ROOM_ID;
const AGENT_BOT_ID_DISPLAY = process.env.TEALUS_AGENT_DISPLAY_NAME || 'アシスタント';

if (!dryRun && (!E2E_BOT_ID || !E2E_BOT_PASS || !E2E_ROOM_ID)) {
  console.error('[E2E] Required env missing: TEALUS_E2E_BOT_ID / TEALUS_E2E_BOT_PASS / TEALUS_E2E_ROOM_ID');
  console.error('[E2E] See agent-server/tools/e2e/README.md for setup.');
  process.exit(1);
}

// ---- helpers ----
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function logInfo(msg) { console.log(`[E2E ${new Date().toISOString()}] ${msg}`); }
function logWarn(msg) { console.warn(`[E2E WARN ${new Date().toISOString()}] ${msg}`); }
function logErr(msg) { console.error(`[E2E ERR ${new Date().toISOString()}] ${msg}`); }

// ---- Tealus API ----
let authToken = null;
let botUserInfo = null;

async function loginAsE2EBot() {
  const res = await fetch(`${TEALUS_API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_id: E2E_BOT_ID, password: E2E_BOT_PASS }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(`E2E bot login failed: ${data.error || 'unknown'}`);
  authToken = data.token;
  botUserInfo = data.user;
  logInfo(`logged in as ${E2E_BOT_ID} (id=${botUserInfo.id})`);
}

async function postMessage(roomId, content) {
  const res = await fetch(`${TEALUS_API_URL}/api/bot/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({ room_id: roomId, content }),
  });
  return res.json();
}

async function postFile(roomId, buffer, filename, mimeType, content = '') {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('room_id', roomId);
  form.append('file', buffer, { filename, contentType: mimeType });
  if (content) form.append('content', content);
  const res = await fetch(`${TEALUS_API_URL}/api/bot/push-file`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      ...form.getHeaders(),
    },
    body: form,
  });
  return res.json();
}

async function getMessages(roomId, limit = 20) {
  const res = await fetch(
    `${TEALUS_API_URL}/api/bot/messages?room_id=${roomId}&limit=${limit}`,
    { headers: { 'Authorization': `Bearer ${authToken}` } }
  );
  return res.json();
}

// ---- Log tail helpers ----
function getCurrentLogPath() {
  const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
  return path.join(__dirname, '../../logs', `agent-${today}.log`);
}

function getLogSize(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

function readLogSlice(p, fromOffset) {
  if (!fs.existsSync(p)) return '';
  const stat = fs.statSync(p);
  if (stat.size <= fromOffset) return '';
  const fd = fs.openSync(p, 'r');
  const len = stat.size - fromOffset;
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, fromOffset);
  fs.closeSync(fd);
  return buf.toString('utf-8');
}

// ---- Log parser ----
function extractToolCalls(logSlice) {
  const tools = [];
  const lines = logSlice.split('\n');
  for (const line of lines) {
    // Light v1: '[Tool] start: <name> args=...' or '[Tool] 使用: <name>'
    let m = line.match(/\[Tool\] (?:start|使用): ([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (m) { tools.push({ tool: m[1], agent: 'light' }); continue; }
    // Light v2: '[LightV2] mcp_tool_call OK: server=X tool=Y' or 'tool start: mcp_tool_call (Y)'
    m = line.match(/\[LightV2\] mcp_tool_call OK: server=\S+ tool=([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (m) { tools.push({ tool: m[1], agent: 'light2' }); continue; }
    m = line.match(/\[LightV2\] tool start: command_execution/);
    if (m) { tools.push({ tool: 'command_execution', agent: 'light2' }); continue; }
  }
  // dedupe consecutive duplicates (start + 使用 とかで重複)
  const uniq = [];
  for (const t of tools) {
    if (!uniq.length || uniq[uniq.length - 1].tool !== t.tool) uniq.push(t);
  }
  return uniq;
}

function findLogLines(logSlice, substrings) {
  const found = [];
  for (const sub of substrings) {
    if (logSlice.includes(sub)) found.push(sub);
  }
  return found;
}

function extractTokenUsage(logSlice) {
  // Light v1: '[Light] turn completed, usage: input=X output=Y'
  // Light v2: '[LightV2] turn completed, usage: input=X output=Y'
  const m = logSlice.match(/turn completed,?\s*usage:\s*input=(\d+)\s*output=(\d+)/);
  if (m) return { input: parseInt(m[1]), output: parseInt(m[2]) };
  return null;
}

// ---- Scenario evaluator ----
function evaluateScenario(scenario, observed) {
  const fails = [];
  const warns = [];
  const tc = scenario.expected_tool_chain || {};
  const er = scenario.expected_response || {};
  const ell = scenario.expected_log_lines || [];
  const metrics = scenario.metrics || {};

  const usedTools = observed.tool_calls.map(t => t.tool);

  // tool chain — must_include
  if (Array.isArray(tc.must_include)) {
    for (const t of tc.must_include) {
      if (!usedTools.includes(t)) fails.push(`tool '${t}' missing (must_include)`);
    }
  }
  // tool chain — must_include_any_of
  if (Array.isArray(tc.must_include_any_of) && tc.must_include_any_of.length > 0) {
    const anyOk = tc.must_include_any_of.some(t => usedTools.includes(t));
    if (!anyOk) fails.push(`none of ${JSON.stringify(tc.must_include_any_of)} called (must_include_any_of)`);
  }
  // tool chain — must_not_include_any
  if (Array.isArray(tc.must_not_include_any)) {
    for (const t of tc.must_not_include_any) {
      if (usedTools.includes(t)) fails.push(`tool '${t}' called but forbidden (must_not_include_any)`);
    }
  }
  // tool chain — should_include (warn only)
  if (Array.isArray(tc.should_include)) {
    for (const t of tc.should_include) {
      if (!usedTools.includes(t)) warns.push(`tool '${t}' missing (should_include)`);
    }
  }

  // response — must_contain
  const resp = (observed.bot_response_text || '').toLowerCase();
  if (Array.isArray(er.must_contain)) {
    for (const sub of er.must_contain) {
      if (!resp.includes(sub.toLowerCase())) fails.push(`response missing '${sub}' (must_contain)`);
    }
  }
  if (Array.isArray(er.must_not_contain)) {
    for (const sub of er.must_not_contain) {
      if (resp.includes(sub.toLowerCase())) fails.push(`response contains forbidden '${sub}' (must_not_contain)`);
    }
  }
  if (typeof er.min_chars === 'number' && (observed.bot_response_text?.length || 0) < er.min_chars) {
    fails.push(`response too short: ${observed.bot_response_text?.length || 0} < ${er.min_chars}`);
  }
  if (typeof er.max_chars === 'number' && (observed.bot_response_text?.length || 0) > er.max_chars) {
    warns.push(`response too long: ${observed.bot_response_text.length} > ${er.max_chars}`);
  }

  // log lines
  for (const sub of ell) {
    if (!observed.log_slice.includes(sub)) fails.push(`log line missing: '${sub}'`);
  }

  // metrics (warn only)
  if (typeof metrics.max_latency_ms === 'number' && observed.latency_ms > metrics.max_latency_ms) {
    warns.push(`latency too high: ${observed.latency_ms}ms > ${metrics.max_latency_ms}ms`);
  }
  if (observed.token_usage) {
    if (typeof metrics.max_input_tokens === 'number' && observed.token_usage.input > metrics.max_input_tokens) {
      warns.push(`input tokens high: ${observed.token_usage.input} > ${metrics.max_input_tokens}`);
    }
    if (typeof metrics.max_output_tokens === 'number' && observed.token_usage.output > metrics.max_output_tokens) {
      warns.push(`output tokens high: ${observed.token_usage.output} > ${metrics.max_output_tokens}`);
    }
  }

  return { fails, warns };
}

// ---- Bot response detection ----
async function waitForBotResponse(roomId, sinceTime, timeoutMs) {
  const start = Date.now();
  const myUserId = botUserInfo.id;
  const pollInterval = 2000;

  while (Date.now() - start < timeoutMs) {
    await sleep(pollInterval);
    const data = await getMessages(roomId, 20);
    const messages = data.messages || [];
    // sender != myself, created_at > sinceTime
    const newBotMsg = messages.find(m =>
      m.sender_id !== myUserId &&
      new Date(m.created_at).getTime() > sinceTime &&
      m.content && m.content.length > 0 &&
      m.type !== 'system'
    );
    if (newBotMsg) return newBotMsg;
  }
  return null;
}

// ---- Preconditions handler (#262 Phase 2) ----
// scenario.preconditions に従って、prompt 投下前に test room に file 等を attach する。
// 現状は attach_pdf のみ対応、将来 attach_image / attach_text も拡張可。
async function applyPreconditions(scenario) {
  const pre = scenario.preconditions;
  if (!pre) return null;

  if (pre.attach_pdf) {
    const pdfPath = path.isAbsolute(pre.attach_pdf)
      ? pre.attach_pdf
      : path.join(SCRIPT_DIR, pre.attach_pdf);
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`fixture not found: ${pdfPath}`);
    }
    const buffer = fs.readFileSync(pdfPath);
    const filename = path.basename(pdfPath);
    const result = await postFile(E2E_ROOM_ID, buffer, filename, 'application/pdf');
    if (!result.message) {
      throw new Error(`postFile failed: ${JSON.stringify(result).slice(0, 200)}`);
    }
    logInfo(`[preconditions] attached PDF: ${filename} (${buffer.length} bytes, msg_id=${result.message.id})`);
    // bot に file message を認識させるため少し待つ (websocket 配信 + index 等)
    await sleep(2000);
    return { attached_message_id: result.message.id, type: 'pdf', filename };
  }
  // 将来: attach_image / attach_text 等の拡張は scenario-schema.md と同期で追加
  return null;
}

// ---- Run single scenario ----
async function runScenario(scenario) {
  logInfo(`[${scenario.id}] start: ${scenario.description}`);
  const logPath = getCurrentLogPath();
  const logOffsetBefore = getLogSize(logPath);
  const tStart = Date.now();

  // resolve placeholders
  const prompt = scenario.prompt.replaceAll('<TEST_BOT_NAME>', AGENT_BOT_ID_DISPLAY);

  let postedMsg, botResponse, latencyMs, preconditionResult = null;
  try {
    // preconditions (e.g., attach_pdf for S3) を実行してから prompt 投下
    preconditionResult = await applyPreconditions(scenario);
    postedMsg = await postMessage(E2E_ROOM_ID, prompt);
    if (!postedMsg.message) {
      throw new Error(`post failed: ${JSON.stringify(postedMsg)}`);
    }
    const sinceTime = new Date(postedMsg.message.created_at).getTime();
    const timeout = scenario.metrics?.max_latency_ms || 120000;
    botResponse = await waitForBotResponse(E2E_ROOM_ID, sinceTime, timeout + 30000);
    latencyMs = Date.now() - tStart;
  } catch (err) {
    return {
      scenario,
      observed: { error: err.message, latency_ms: Date.now() - tStart },
      result: { fails: [`scenario execution error: ${err.message}`], warns: [] },
    };
  }

  // collect log slice + parse
  await sleep(2000);  // give log a moment to flush after final response
  const logSlice = readLogSlice(logPath, logOffsetBefore);
  const observed = {
    posted_message_id: postedMsg.message?.id,
    bot_response_id: botResponse?.id,
    bot_response_text: botResponse?.content || null,
    bot_response_type: botResponse?.type,
    latency_ms: latencyMs,
    tool_calls: extractToolCalls(logSlice),
    log_slice: logSlice,
    log_lines_found: findLogLines(logSlice, scenario.expected_log_lines || []),
    token_usage: extractTokenUsage(logSlice),
    precondition: preconditionResult,
  };

  if (!botResponse) {
    return {
      scenario,
      observed,
      result: { fails: ['no bot response within timeout'], warns: [] },
    };
  }

  const result = evaluateScenario(scenario, observed);
  const status = result.fails.length === 0 ? 'PASS' : 'FAIL';
  logInfo(`[${scenario.id}] ${status} (${result.fails.length} fails, ${result.warns.length} warns, ${latencyMs}ms)`);
  return { scenario, observed, result };
}

// ---- Main ----
async function main() {
  const scenariosFile = JSON.parse(fs.readFileSync(SCENARIOS_PATH, 'utf-8'));
  let scenarios = scenariosFile.scenarios;

  if (filterIds) {
    scenarios = scenarios.filter(s => filterIds.some(f => s.id.startsWith(f)));
    logInfo(`filtered to ${scenarios.length} scenarios: ${scenarios.map(s => s.id).join(', ')}`);
  }

  if (dryRun) {
    logInfo(`[DRY RUN] would execute ${scenarios.length} scenarios:`);
    for (const s of scenarios) {
      console.log(`  - ${s.id}: ${s.description}`);
      console.log(`    target=${s.target_agent} prompt="${s.prompt.slice(0, 60)}..."`);
    }
    return;
  }

  await loginAsE2EBot();

  const results = [];
  for (const scenario of scenarios) {
    if (scenario.skip_if_not_available) {
      // TODO: check actual availability via API
      logInfo(`[${scenario.id}] check skip_if_not_available — assuming available, run`);
    }
    try {
      const r = await runScenario(scenario);
      results.push(r);
    } catch (err) {
      logErr(`scenario ${scenario.id} crashed: ${err.message}`);
      results.push({
        scenario,
        observed: { error: err.message },
        result: { fails: [`runner crash: ${err.message}`], warns: [] },
      });
    }
    // small gap between scenarios
    await sleep(3000);
  }

  // Generate report
  const { generateReport } = require('./report');
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportName = `${new Date().toISOString().slice(0, 10)}-${String(Date.now()).slice(-6)}.md`;
  const reportPath = path.join(REPORT_DIR, reportName);
  fs.writeFileSync(reportPath, generateReport(results));
  logInfo(`report: ${reportPath}`);

  // summary
  const totalPass = results.filter(r => r.result.fails.length === 0).length;
  const totalFail = results.length - totalPass;
  const totalWarns = results.reduce((acc, r) => acc + r.result.warns.length, 0);
  console.log(`\n[E2E SUMMARY] ${totalPass}/${results.length} pass, ${totalFail} fail, ${totalWarns} warns`);
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(err => {
  logErr(err.stack || err.message);
  process.exit(2);
});
