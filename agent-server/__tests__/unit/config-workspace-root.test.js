/**
 * config.js WORKSPACE_ROOT normalize test (= #292 follow-up、藤井さん環境 Deep Codex bug fix)
 *
 * codex CLI は CODEX_HOME に絶対 path 要求、相対 path で渡すと
 * 「CODEX_HOME points to "agent-workspaces/..." but that path...」 エラー。
 * config.js で path.resolve normalize して全 consumer に絶対 path 伝播することを検証。
 */
const path = require('path');

describe('config.WORKSPACE_ROOT path.resolve normalize', () => {
  const ORIGINAL_ENV = process.env.AGENT_WORKSPACE_ROOT;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.AGENT_WORKSPACE_ROOT;
    } else {
      process.env.AGENT_WORKSPACE_ROOT = ORIGINAL_ENV;
    }
  });

  test('default (= AGENT_WORKSPACE_ROOT unset 想定) で絶対 path に normalize される', () => {
    delete process.env.AGENT_WORKSPACE_ROOT;
    const config = require('../../src/config');
    // .env file で AGENT_WORKSPACE_ROOT が pre-set されている可能性があるため、
    // 具体値 assert は避け 「絶対 path に normalize される」 invariant のみ verify。
    // これが fix の本質 (= 藤井さん環境 Deep Codex CODEX_HOME 絶対 path 要求 への対応)。
    expect(path.isAbsolute(config.WORKSPACE_ROOT)).toBe(true);
  });

  test('相対 path (= ./custom/workspaces) を env で渡しても絶対 path に normalize される', () => {
    process.env.AGENT_WORKSPACE_ROOT = './custom/workspaces';
    const config = require('../../src/config');
    expect(path.isAbsolute(config.WORKSPACE_ROOT)).toBe(true);
    expect(config.WORKSPACE_ROOT).toBe(path.resolve('./custom/workspaces'));
  });

  test('絶対 path (= 既に絶対) を env で渡すとそのまま保持される', () => {
    const absPath = process.platform === 'win32'
      ? 'C:\\tealus\\agent-workspaces'
      : '/var/lib/tealus/agent-workspaces';
    process.env.AGENT_WORKSPACE_ROOT = absPath;
    const config = require('../../src/config');
    expect(path.isAbsolute(config.WORKSPACE_ROOT)).toBe(true);
    expect(config.WORKSPACE_ROOT).toBe(path.resolve(absPath));
  });
});
