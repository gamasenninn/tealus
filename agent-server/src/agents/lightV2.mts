/**
 * Light v2 Agent — codex-sdk backed (#258)
 *
 * 現 Light v1 (`@openai/agents` SDK in-process) の並列 alternative。
 * `/light2` prefix で起動、`@openai/codex-sdk` 経由で codex CLI を spawn (SDK が hide)、
 * MCP ecosystem (tealus / filesystem / tavily 等) を共有して agent 動作。
 *
 * 設計判断:
 * - thread lifecycle: per-message 都度新規 (Light v1 の D4 哲学と同じ、session 持たない)
 * - MCP config: 動的 (Codex({ config: { mcp_servers } }) で per-request 注入)
 * - approval policy: 'never' (Tealus chat に approval UI なし、Light v1 と同方針)
 * - sandbox: 'workspace-write' (workspace 内 file 操作は許可、外部は不可)
 */
import path from 'node:path';
import fs from 'node:fs';
import type {
  Codex as CodexClass,
  CodexOptions,
  ThreadEvent,
  ThreadItem,
  McpToolCallItem,
} from '@openai/codex-sdk';
import * as config from '../config.mts';
import { logger } from '../lib/logger.mts';
import * as botApi from '../lib/botApi.mts';
import { loadMemoryForPrompt } from '../memory/fileMemory.mts';
import { loadOrganonPolysemeForPrompt } from '../lib/organonContext.mts';
import { loadVocabForPrompt } from '../lib/vocabContext.mts';
import { detectCodexAuthError, buildAuthFailUserMessage } from '../lib/codexAuthError.mts';
import * as lightRegistry from './lightRegistry.mts';

/** CodexOptions.config (mcp_servers 等) の TOML 互換値型。SDK は型を export していないため
 *  CodexOptions から indexed access で抽出する。 */
type CodexConfigObject = NonNullable<CodexOptions['config']>;

interface McpServerDef {
  command: string;
  args: string[];
  env: Record<string, string>;
}

// codex-sdk は ESM のみ。CommonJS から動的 import で読む
let CodexCtor: typeof CodexClass | null = null;
async function getCodex(): Promise<typeof CodexClass> {
  if (!CodexCtor) {
    const mod = await import('@openai/codex-sdk');
    CodexCtor = mod.Codex;
  }
  return CodexCtor;
}

// AGENT_CONFIG_DIR env で override 可能 (test isolation 用、production では unset で default)
const CONFIG_DIR = process.env.AGENT_CONFIG_DIR || path.join(import.meta.dirname, '..', '..', 'config');

const MIN_CUSTOM_PROMPT_LENGTH = 50;

function loadSystemPrompt(): string {
  const customPath = path.join(CONFIG_DIR, 'system_prompt.md');
  const defaultPath = path.join(CONFIG_DIR, 'default_system_prompt.md');
  try {
    if (fs.existsSync(customPath)) {
      const content = fs.readFileSync(customPath, 'utf8').trim();
      if (content && content.length >= MIN_CUSTOM_PROMPT_LENGTH) return content;
    }
    if (fs.existsSync(defaultPath)) {
      return fs.readFileSync(defaultPath, 'utf8').trim();
    }
  } catch {}
  return 'あなたはTealusのAIアシスタントです。';
}

/**
 * Light v2 用 MCP 設定を直接構築 (codex SDK 形式 = TOML mcp_servers)
 *
 * 注意: roomMcpManager が持つ MCPServerStdio instances (Light v1 用) からの抽出ではなく、
 * deep.js の createDeepMcpConfig と同型で **設定 source から直接** 構築する。
 * 理由: Light v1 と v2 は別 process group の MCP server を spawn するため、
 * Light v1 の instances から再利用しても意味がない (codex CLI 内部で再 spawn)。
 *
 * 構成:
 *   1. tealus MCP (Bot 認証情報があれば自動追加、Light v1 / Deep と同型)
 *   2. workspace-fs MCP (filesystem、room workspace に root)
 *   3. ルーム固有 MCP (workspace/mcp_config.json があればマージ)
 *   4. グローバル MCP (agent-server/mcp_config.json があればマージ、filesystem は除外)
 */
export function buildLightV2McpConfig(workspacePath: string | undefined): Record<string, CodexConfigObject> {
  const mcp_servers: Record<string, CodexConfigObject> = {};

  // 1. Tealus MCP
  if (config.TEALUS_BOT_ID && config.TEALUS_BOT_PASS) {
    const tealusDef: McpServerDef = {
      command: 'npx',
      args: ['-y', 'github:gamasenninn/tealus-mcp#v0.14.7'],
      env: {
        TEALUS_API_URL: config.TEALUS_API_URL,
        TEALUS_USER_ID: config.TEALUS_BOT_ID,
        TEALUS_PASSWORD: config.TEALUS_BOT_PASS,
        // generate_and_send_image (#260) で DALL-E 3 を呼ぶため必要
        // (Light v2 が subscription mode でも image gen は API key 必須、別 cost path)
        ...(config.OPENAI_API_KEY ? { OPENAI_API_KEY: config.OPENAI_API_KEY } : {}),
        // read_document の vision fallback (Gemini) で必要
        ...(process.env.GOOGLE_API_KEY ? { GOOGLE_API_KEY: process.env.GOOGLE_API_KEY } : {}),
        ...(process.env.DOCUMENT_VISION_PROVIDER ? { DOCUMENT_VISION_PROVIDER: process.env.DOCUMENT_VISION_PROVIDER } : {}),
        ...(process.env.DOCUMENT_VISION_MODEL ? { DOCUMENT_VISION_MODEL: process.env.DOCUMENT_VISION_MODEL } : {}),
        ...(process.env.DOCUMENT_VISION_MAX_PAGES ? { DOCUMENT_VISION_MAX_PAGES: process.env.DOCUMENT_VISION_MAX_PAGES } : {}),
      },
    };
    mcp_servers.tealus = tealusDef as unknown as CodexConfigObject;
  }

  // 2. workspace-fs MCP
  if (workspacePath) {
    const normalizedPath = workspacePath.replace(/\\/g, '/');
    const fsDef: McpServerDef = {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', normalizedPath],
      env: {},
    };
    mcp_servers['workspace-fs'] = fsDef as unknown as CodexConfigObject;
  }

  // 3. ルーム固有 MCP
  if (workspacePath) {
    const roomMcpPath = path.join(workspacePath, 'mcp_config.json');
    if (fs.existsSync(roomMcpPath)) {
      try {
        const roomMcp = JSON.parse(fs.readFileSync(roomMcpPath, 'utf8')) as { mcpServers?: Record<string, CodexConfigObject> };
        Object.assign(mcp_servers, roomMcp.mcpServers || {});
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[LightV2] Failed to load room MCP config: ${message}`);
      }
    }
  }

  // 4. グローバル MCP (filesystem 重複を避けて除外)
  const globalConfigPath = path.join(import.meta.dirname, '..', '..', 'mcp_config.json');
  if (fs.existsSync(globalConfigPath)) {
    try {
      const globalMcp = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8')) as { mcpServers?: Record<string, CodexConfigObject> };
      if (globalMcp.mcpServers) {
        for (const [name, def] of Object.entries(globalMcp.mcpServers)) {
          if (name === 'filesystem') continue;
          if (!mcp_servers[name]) mcp_servers[name] = def;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[LightV2] Failed to load global MCP config: ${message}`);
    }
  }

  return mcp_servers;
}

interface ToolStatusMapping {
  status: string;
  message: string;
}

/**
 * codex event の tool name → Tealus status mapping (Light v1 TOOL_STATUS_MAP の v2 版)
 */
function mapToolToStatus(item: ThreadItem): ToolStatusMapping | null {
  if (item.type === 'mcp_tool_call') {
    const tool = item.tool;
    const TOOL_MAP: Record<string, ToolStatusMapping> = {
      tavily_search: { status: 'searching', message: '検索中...' },
      get_messages: { status: 'reading', message: 'メッセージ確認中...' },
      search_messages: { status: 'searching', message: 'メッセージ検索中...' },
      get_message_media: { status: 'reading', message: 'メディア取得中...' },
      read_document: { status: 'reading', message: '文書を読み込み中...' },
      send_message: { status: 'sending', message: 'メッセージ送信中...' },
      send_image: { status: 'sending', message: '画像送信中...' },
      list_tags: { status: 'reading', message: 'タグ確認中...' },
      mark_tag_done: { status: 'writing', message: 'タグ更新中...' },
      read_file: { status: 'reading', message: 'ファイル読み込み中...' },
      read_text_file: { status: 'reading', message: 'ファイル読み込み中...' },
      write_file: { status: 'writing', message: 'ファイル書き込み中...' },
      list_directory: { status: 'reading', message: 'ディレクトリ読み込み中...' },
    };
    return TOOL_MAP[tool] || { status: 'processing', message: `${tool} を実行中...` };
  }
  if (item.type === 'command_execution') {
    return { status: 'processing', message: 'コマンド実行中...' };
  }
  if (item.type === 'web_search') {
    return { status: 'searching', message: '検索中...' };
  }
  if (item.type === 'file_change') {
    return { status: 'writing', message: 'ファイル変更中...' };
  }
  return null;
}

export interface ProcessLightV2Args {
  roomId: string;
  prompt: string;
  workspacePath: string;
  suppressAutoPost?: boolean;
}

/**
 * Light v2 でメッセージを処理
 */
export async function processLightV2({ roomId, prompt, workspacePath, suppressAutoPost = false }: ProcessLightV2Args): Promise<string | null> {
  let lastAgentMessage: string | null = null;
  // #292 follow-up: LLM が同 room へ send_message tool を call した場合は、
  // 最終 response auto-post を skip (= cross-room delegation の「2 件返信」防止、
  // 6/13 12:40 業務メモ dogfood で観察)
  let llmSentToOwnRoom = false;
  // 中断 (#250 の Light 版): /agent/cancel が isCancelled を立てて codex を sweep kill する。
  // 後始末は必ず finally で行う (loop 内 return もあるため)。
  lightRegistry.register(roomId, { workspacePath });
  try {
    const Codex = await getCodex();

    // codex SDK 初期化
    // 認証 path 2 通り:
    //   1. OPENAI_API_KEY 設定済 + LIGHTV2_AUTH != 'subscription' → API key 認証
    //      (usage-based billing、production 向き、default)
    //   2. LIGHTV2_AUTH='subscription' → apiKey 渡さず ~/.codex/auth.json で
    //      ChatGPT subscription 認証 (Plus/Pro/Team 持ち、API cost 0、dogfood 向き)
    //
    // Light v1 / Router は依然 OPENAI_API_KEY を使うため、env 自体は unset しない。
    // Light v2 だけ subscription に向けるには LIGHTV2_AUTH=subscription を設定。
    const mcp_servers = buildLightV2McpConfig(workspacePath);
    const codexOpts: CodexOptions = { config: { mcp_servers } };
    const useSubscription = config.LIGHTV2_AUTH === 'subscription';
    if (!useSubscription && config.OPENAI_API_KEY) {
      codexOpts.apiKey = config.OPENAI_API_KEY;
    }
    const codex = new Codex(codexOpts);
    logger.info(`[LightV2] auth=${codexOpts.apiKey ? 'API key' : 'subscription'} mcp_servers=${Object.keys(mcp_servers).join(',')}`);

    // memory + system prompt 構築
    let systemPrompt = loadSystemPrompt();
    // ルーム固有 Light プロンプト (Light v1 と parity、#258 follow-up)
    if (workspacePath) {
      const lightPromptPath = path.join(workspacePath, 'light_prompt.md');
      if (fs.existsSync(lightPromptPath)) {
        const roomPrompt = fs.readFileSync(lightPromptPath, 'utf8').trim();
        if (roomPrompt) systemPrompt += `\n\n## ルーム固有の指示\n${roomPrompt}`;
      }
    }
    const memory = loadMemoryForPrompt(workspacePath);
    if (memory) systemPrompt += `\n\n## 記憶\n${memory}`;
    // #276 follow-up: organon polyseme.sql_mapping を DB 検索精度向上のため inject
    systemPrompt += loadOrganonPolysemeForPrompt();
    // vocab inject: STT vocab (別名→正規名) を OCR/文章読みの正規化用に inject (opt-in)
    systemPrompt += loadVocabForPrompt();
    if (workspacePath) {
      const normalizedPath = workspacePath.replace(/\\/g, '/');
      systemPrompt += `\n\n## ワークスペース\nファイル操作ツールを使う際は、以下のパスを使ってください:\n${normalizedPath}`;
    }

    // thread 開始 (per-message 都度新規)
    // sandboxMode='danger-full-access' を試行: workspace-write + networkAccessEnabled=true
    // でも tealus MCP (network 必要) が「user cancelled」で fail し、workspace-fs MCP
    // (network 不要) のみ動作する症状を観測 (5/7 14:30 verify)。sandbox restriction が
    // localhost への HTTP call を依然 block している可能性。
    // danger-full-access で fix すれば sandbox 確定 → 後で fine-grained config 探求。
    // Tealus は agent-server 上で trusted execution context なので、最終的にも
    // この sandboxMode で問題ない (codex の本来用途は untrusted code execution、
    // Tealus AI agent は trusted code path)。
    const thread = codex.startThread({
      model: config.AGENT_LIGHT_MODEL,
      workingDirectory: workspacePath,
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
      skipGitRepoCheck: true,
    });

    await botApi.pushStatus(roomId, 'thinking', '考え中...').catch(() => {});

    // codex は system prompt を thread option で取らないので、user prompt 先頭に注入
    const fullPrompt = `${systemPrompt}\n\n---\n\nユーザーの質問: ${prompt}`;

    const { events } = await thread.runStreamed(fullPrompt);

    // turn completed 後に MCP child process cleanup 等で発生する parse error は
    // 応答自体に影響しないため、turn 完了フラグで判定して warn に格下げする
    let turnCompleted = false;
    try {
      for await (const event of events as AsyncGenerator<ThreadEvent>) {
        // 中断されていたら以降の event を捨てる。tool 実行の合間に必ず通るので、
        // sweep kill が届く前でも「これ以上部屋に書かない」ところまでは即座に効く。
        if (lightRegistry.isCancelled(roomId)) {
          logger.info(`[LightV2] cancelled room=${roomId}: stream 消費を打ち切り`);
          break;
        }
        try {
          if (event.type === 'item.started') {
            const mapped = mapToolToStatus(event.item);
            if (mapped) {
              await botApi.pushStatus(roomId, mapped.status, mapped.message).catch(() => {});
              const startedItem = event.item as ThreadItem & { tool?: string; command?: string };
              logger.info(`[LightV2] tool start: ${event.item.type} (${startedItem.tool || startedItem.command || ''})`);
            }
          } else if (event.type === 'item.completed') {
            if (event.item.type === 'agent_message') {
              // codex は agent_message を 1 turn で複数回 emit する (#260 dogfood で判明):
              //   - 最初/中間: 「これから X します」「次は Y を読みます」(thinking aloud、tool 呼び前後の narration)
              //   - 最後の非空: 実際の user 向け回答 (要約 / 結論 等)
              //   - 最後: 空文字列 ("" turn 終了 signal、新 codex SDK の behavior)
              //
              // 旧実装 (accumulate) は thinking aloud 全部 concat → user が最初に
              // 「直近の room メッセージを確認して...」等の前置きを見て「要約されてない」
              // と誤認する UX bug が発生 (5/8 dogfood)。
              //
              // **「最後の非空 agent_message を採用」**が正しい (空文字列で上書きしない、
              // ただし非空が来たら overwrite で前の thinking aloud を捨てる)。
              if (event.item.text && event.item.text.trim()) {
                lastAgentMessage = event.item.text;
              }
              await botApi.pushStatus(roomId, 'thinking', '考え中...').catch(() => {});
            } else if (event.item.type === 'mcp_tool_call') {
              // MCP tool call の result/error 詳細を log (debug 用)
              const mcpItem: McpToolCallItem = event.item;
              const status = mcpItem.status || '?';
              const server = mcpItem.server || '?';
              const tool = mcpItem.tool || '?';
              if (mcpItem.error) {
                logger.warn(`[LightV2] mcp_tool_call FAILED: server=${server} tool=${tool} status=${status} error=${mcpItem.error.message || JSON.stringify(mcpItem.error).slice(0, 300)}`);
              } else if (status === 'failed') {
                logger.warn(`[LightV2] mcp_tool_call status=failed: server=${server} tool=${tool} (no error field) item=${JSON.stringify(mcpItem).slice(0, 400)}`);
              } else {
                const resultPreview = mcpItem.result
                  ? JSON.stringify(mcpItem.result).slice(0, 200)
                  : '(no result)';
                logger.info(`[LightV2] mcp_tool_call OK: server=${server} tool=${tool} status=${status} result=${resultPreview}`);
              }
              // #292 follow-up: LLM が send_message tool で自 room へ投函していたら、
              // 最終 response auto-post の重複を skip するため flag を立てる
              if (tool === 'send_message' && status === 'completed' && mcpItem.result) {
                try {
                  const firstContent = mcpItem.result.content?.[0] as { text?: string } | undefined;
                  const text = firstContent?.text;
                  if (text) {
                    const parsed = JSON.parse(text) as { message?: { room_id?: string } };
                    const sentRoomId = parsed?.message?.room_id;
                    if (sentRoomId === roomId) {
                      llmSentToOwnRoom = true;
                      logger.info(`[LightV2] LLM sent_message to own room ${roomId} (= 2 件返信防止 flag、最終 auto-post skip)`);
                    }
                  }
                } catch (parseErr) {
                  const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
                  logger.debug(`[LightV2] send_message result parse skipped: ${message}`);
                }
              }
              await botApi.pushStatus(roomId, 'thinking', '考え中...').catch(() => {});
            } else {
              const mapped = mapToolToStatus(event.item);
              if (mapped) {
                await botApi.pushStatus(roomId, 'thinking', '考え中...').catch(() => {});
                logger.info(`[LightV2] tool end: ${event.item.type}`);
              }
            }
          } else if (event.type === 'turn.completed') {
            turnCompleted = true;
            logger.info(`[LightV2] turn completed, usage: input=${event.usage?.input_tokens} output=${event.usage?.output_tokens}`);
          } else if (event.type === 'turn.failed') {
            logger.error(`[LightV2] turn failed: ${event.error?.message || 'unknown'}`);
          } else if (event.type === 'error') {
            // pre-α (#292 follow-up): ChatGPT subscription auth 切れを検出し user に案内
            const authResult = detectCodexAuthError(event.message);
            if (authResult.isAuth) {
              logger.error(`[LightV2] auth failed (${authResult.kind}): ${event.message}`);
              await botApi.pushMessage(roomId, buildAuthFailUserMessage()).catch(() => {});
              await botApi.pushStatus(roomId, 'idle').catch(() => {});
              return null;
            }
            logger.error(`[LightV2] stream error: ${event.message}`);
          }
        } catch (eventErr) {
          const message = eventErr instanceof Error ? eventErr.message : String(eventErr);
          logger.warn(`[LightV2] event handler error: ${message}`);
        }
      }
    } catch (streamErr) {
      // turn completed 後の cleanup parse error (Windows 日本語環境で taskkill
      // 出力が JSONL stream に混入する codex SDK の既知の挙動) は応答に影響なし、
      // warn に格下げして flow 継続。turn 未完了で error 出た場合は throw する。
      const message = streamErr instanceof Error ? streamErr.message : String(streamErr);
      if (turnCompleted) {
        // pre-α (#292 follow-up): post-turn の parse error は cleanup phase、auth check skip 明示
        logger.warn(`[LightV2] post-turn stream error (ignored, response captured, auth check skipped): ${message}`);
      } else {
        throw streamErr;
      }
    }

    // 中断されていたら応答は捨てる。status idle と「⏹ 応答を中断しました。」は
    // /agent/cancel 側が出すので、ここでは投稿しない (二重に出さない)。
    if (lightRegistry.isCancelled(roomId)) {
      logger.info(`[LightV2] cancelled room=${roomId}: 応答を破棄 (${lastAgentMessage?.length || 0} chars)`);
      return null;
    }

    // 最終 response 送信
    if (lastAgentMessage) {
      // #295: 委譲 (runAgent) からの呼出は suppressAutoPost=true。自室投稿せず本文を return し、
      //       デリゲーターが委譲元へ機械配送する (委譲先には残さない)。
      if (suppressAutoPost) {
        logger.info(`[LightV2] suppressAutoPost: return ${lastAgentMessage.length} chars without posting to room ${roomId} (delegation)`);
      } else if (llmSentToOwnRoom) {
        // #292 follow-up: LLM が tool で自 room へ既に投函済の場合 auto-post を skip (= 2 件返信防止)
        logger.info(`[LightV2] skip auto-post: LLM already sent_message to own room ${roomId} (final response ${lastAgentMessage.length} chars skipped)`);
      } else {
        const content = lastAgentMessage;
        if (content.length > 4000) {
          const chunks = splitMessage(content, 4000);
          for (const chunk of chunks) await botApi.pushMessage(roomId, chunk);
        } else {
          await botApi.pushMessage(roomId, content);
        }
        logger.info(`Light v2 response sent to room ${roomId} (${content.length} chars)`);
      }
    } else {
      logger.warn(`[LightV2] no final agent message captured for room ${roomId}`);
      if (!suppressAutoPost) {
        await botApi.pushMessage(roomId, '応答が取得できませんでした。再度お試しください。');
      }
    }
    await botApi.pushStatus(roomId, 'idle').catch(() => {});
    return lastAgentMessage || null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 中断由来の例外 (sweep kill で stream が途中で壊れる) はエラーとして扱わない。
    // ★ auth 判定より先に置く — kill 由来の壊れ方を auth 切れと誤読しないため。
    if (lightRegistry.isCancelled(roomId)) {
      // ★ 全文を出さない。codex を kill すると models JSON を丸ごと含む 16 万字級の
      //   エラーが返り、1 行でその日のログの過半を占める (2026-08-30 実測: 164,976 文字 = 62%)。
      //   意図的に捨てるエラーなので、頭 300 字と全長だけ残す。
      logger.info(`[LightV2] cancelled room=${roomId}: 中断由来の stream error を無視 (${message.slice(0, 300)}… 全長 ${message.length} 文字)`);
      return null;
    }
    // pre-α (#292 follow-up): 外側 catch でも auth 切れを検出
    const authResult = detectCodexAuthError(message);
    if (authResult.isAuth) {
      logger.error(`[LightV2] auth failed (${authResult.kind}): ${message}`);
      await botApi.pushStatus(roomId, 'idle').catch(() => {});
      try {
        await botApi.pushMessage(roomId, buildAuthFailUserMessage());
      } catch (pushErr) {
        const pushMessage = pushErr instanceof Error ? pushErr.message : String(pushErr);
        logger.error(`Failed to send auth error message: ${pushMessage}`);
      }
      return null;
    }
    logger.error(`Light v2 Agent error: ${message}`);
    await botApi.pushStatus(roomId, 'idle').catch(() => {});
    // #295: 委譲経由 (suppressAutoPost) の時はエラー文を委譲先に残さない。デリゲーターが
    //       runAgent の throw として捕捉し委譲元へ通知する。throw して呼出元に伝える。
    if (suppressAutoPost) {
      throw err;
    }
    try {
      await botApi.pushMessage(roomId, `Light v2 でエラーが発生しました: ${message}`);
    } catch (pushErr) {
      const pushMessage = pushErr instanceof Error ? pushErr.message : String(pushErr);
      logger.error(`Failed to send error message: ${pushMessage}`);
    }
    return null;
  } finally {
    lightRegistry.unregister(roomId);
  }
}

export function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }
  return chunks;
}

// #292 plug interface contract (= 統一 processLight 名で export、processLightV2 alias 維持で後方互換)
export const processLight = processLightV2;
