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
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { logger } from '../lib/logger.mts';
import { processLight as processLightV1 } from './light.mts';
import { processLight as processLightV2 } from './lightV2.mts';

// 自作 backend (絶対 path 指定) は実行時まで path が決まらない CJS module のことがあるため、
// 従来通り require() で同期解決する。ESM (.mts) 環境では グローバル require が無いので
// createRequire で明示的に用意する (= 挙動は旧 CommonJS require() と同一、CJS 専用の制約も同じ)。
const require = createRequire(import.meta.url);

export const KNOWN_BACKENDS: Record<string, string> = {
  v1: '../agents/light',
  v2: '../agents/lightV2',
};

/** 既知 alias → static import 済み処理関数 の解決 table (require の代わりに直接参照) */
const KNOWN_BACKEND_IMPLS: Record<string, LightProcessFn> = {
  v1: processLightV1,
  v2: processLightV2,
};

/**
 * Light backend の統一 contract。各 backend (light.mts / lightV2.mts / 自作) は
 * 互いに micro に異なる引数形状を持つため、method シグネチャ (bivariant) で許容する。
 */
export interface LightBackendArgs {
  roomId: string;
  prompt: string;
  workspacePath?: string;
  agentId?: string;
  sessionId?: string;
  mcpServers?: unknown[];
  suppressAutoPost?: boolean;
}

// method シグネチャとして定義し、抽出することで bivariant な引数チェックにする
// (= light.mts / lightV2.mts / 自作 backend、互いに微妙に異なる引数形状を許容するため)
interface LightProcessFnHolder {
  fn(args: LightBackendArgs): Promise<unknown>;
}
export type LightProcessFn = LightProcessFnHolder['fn'];

export interface LightBackend {
  name: string;
  processLight: LightProcessFn;
}

interface CustomBackendModule {
  processLight?: unknown;
}

let cached: LightBackend | null = null;

/**
 * Backend を解決して { name, processLight } を返す。
 * 同 spec で 2 回目以降は cache を返す (= require cost 削減)。
 *
 * @param backendSpec - 'v1' | 'v2' | absolute path | undefined
 */
export function loadLightBackend(backendSpec: string | undefined): LightBackend {
  if (cached) return cached;
  const spec = (backendSpec || 'v1').trim();

  // 1. 既知 alias
  if (KNOWN_BACKEND_IMPLS[spec]) {
    cached = { name: spec, processLight: KNOWN_BACKEND_IMPLS[spec] };
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
      const mod = require(spec) as CustomBackendModule;
      if (typeof mod.processLight !== 'function') {
        logger.error(`[LightBackend] '${spec}' missing processLight export, fallback to 'v1'`);
        return loadLightBackend('v1');
      }
      cached = { name: spec, processLight: mod.processLight as LightProcessFn };
      logger.info(`[LightBackend] resolved custom path '${spec}'`);
      return cached;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[LightBackend] require failed for '${spec}': ${message}, fallback to 'v1'`);
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
export function resetForTest(): void {
  cached = null;
}
