/**
 * Light backend dynamic loader (#292)
 *
 * AGENT_LIGHT_BACKEND env (= config.AGENT_LIGHT_BACKEND) で指定された backend を
 * dynamic require し、統一 processLight contract で返す。
 *
 * 既知 alias: 'v1' (= @openai/agents SDK) / 'v2' (= codex-sdk)
 * 自作 backend: 絶対 path で指定、processLight export 義務 (= contract)
 *
 * 不正値 / file 不在 / export なし は silent fallback to 'v1' + log warn/error。
 * agent-server 起動を止めない (= production stability 担保、Deep agent DEEP_CODEX_AVAILABLE
 * detect + fallback pattern と整合)。
 */
const path = require('path');
const fs = require('fs');
const logger = require('../lib/logger');

const KNOWN_BACKENDS = {
  v1: '../agents/light',
  v2: '../agents/lightV2',
};

let cached = null;

/**
 * Backend を解決して { name, processLight } を返す。
 * 同 spec で 2 回目以降は cache を返す (= require cost 削減)。
 *
 * @param {string|undefined} backendSpec - 'v1' | 'v2' | absolute path | undefined
 * @returns {{ name: string, processLight: Function }}
 */
function loadLightBackend(backendSpec) {
  if (cached) return cached;
  const spec = (backendSpec || 'v1').trim();

  // 1. 既知 alias
  if (KNOWN_BACKENDS[spec]) {
    const mod = require(KNOWN_BACKENDS[spec]);
    if (typeof mod.processLight !== 'function') {
      throw new Error(`[LightBackend] backend '${spec}' (${KNOWN_BACKENDS[spec]}) does not export processLight()`);
    }
    cached = { name: spec, processLight: mod.processLight };
    logger.info(`[LightBackend] resolved alias '${spec}' → ${KNOWN_BACKENDS[spec]}`);
    return cached;
  }

  // 2. 絶対 path (自作 agent)
  if (path.isAbsolute(spec)) {
    if (!fs.existsSync(spec)) {
      logger.error(`[LightBackend] file not found: '${spec}', fallback to 'v1'`);
      return loadLightBackend('v1');
    }
    try {
      const mod = require(spec);
      if (typeof mod.processLight !== 'function') {
        logger.error(`[LightBackend] '${spec}' missing processLight export, fallback to 'v1'`);
        return loadLightBackend('v1');
      }
      cached = { name: spec, processLight: mod.processLight };
      logger.info(`[LightBackend] resolved custom path '${spec}'`);
      return cached;
    } catch (err) {
      logger.error(`[LightBackend] require failed for '${spec}': ${err.message}, fallback to 'v1'`);
      return loadLightBackend('v1');
    }
  }

  // 3. 不正値 silent fallback
  logger.warn(`[LightBackend] unknown spec '${spec}', fallback to 'v1' (known: ${Object.keys(KNOWN_BACKENDS).join(',')})`);
  return loadLightBackend('v1');
}

/**
 * Test 用 cache reset (= jest.resetModules() と組み合わせて使用)
 */
function resetForTest() {
  cached = null;
}

module.exports = { loadLightBackend, resetForTest, KNOWN_BACKENDS };
