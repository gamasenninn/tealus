/**
 * Light Agent（OpenAI Agents SDK版）
 * Agent + run() パターンで MCP・ツール・セッション管理に対応
 */
const fs = require('fs');
const path = require('path');
const { Agent, run, codeInterpreterTool } = require('@openai/agents');
const OpenAI = require('openai');
const config = require('../config');
const logger = require('../lib/logger');
const botApi = require('../lib/botApi');
const { loadMemoryForPrompt } = require('../memory/fileMemory');
const { loadOrganonPolysemeForPrompt } = require('../lib/organonContext');
const { loadVocabForPrompt } = require('../lib/vocabContext');
const { createTools } = require('./lightTools');
const { getSetting } = require('../context/settingsManager');

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// AGENT_CONFIG_DIR env で override 可能 (test isolation 用、production では unset で default)
const CONFIG_DIR = process.env.AGENT_CONFIG_DIR || path.join(__dirname, '..', '..', 'config');

// admin UI が「カスタムプロンプト」のような placeholder text を保存することがあり、
// 短すぎる custom は default に fallback (D4 哲学の MCP-first 指示が消えるのを防ぐ)
const MIN_CUSTOM_PROMPT_LENGTH = 50;

/**
 * システムプロンプトを取得
 * 1. config/system_prompt.md があればそれを使う（カスタム、ただし MIN_CUSTOM_PROMPT_LENGTH 以上）
 * 2. なければ config/default_system_prompt.md を使う（デフォルト）
 */
function loadSystemPrompt() {
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
 * Light Agent を作成
 */
function createLightAgent(workspacePath, mcpServers = [], roomId = null) {
  const tools = [...createTools(workspacePath, roomId)];
  if (getSetting('tool_code_interpreter', true)) {
    tools.unshift(codeInterpreterTool());
  }

  const agent = new Agent({
    name: 'TealusAssistant',
    instructions: () => {
      let prompt = loadSystemPrompt();
      // ルーム固有 Light プロンプト
      if (workspacePath) {
        const lightPromptPath = path.join(workspacePath, 'light_prompt.md');
        if (fs.existsSync(lightPromptPath)) {
          const roomPrompt = fs.readFileSync(lightPromptPath, 'utf8').trim();
          if (roomPrompt) prompt += `\n\n## ルーム固有の指示\n${roomPrompt}`;
        }
      }
      if (workspacePath && mcpServers.length > 0) {
        const normalizedPath = workspacePath.replace(/\\/g, '/');
        prompt += `\n\n## ワークスペース\nファイル操作ツールを使う際は、以下のワークスペースパスを使ってください:\n${normalizedPath}\n例: ${normalizedPath}/hello.txt`;
      }
      const memory = loadMemoryForPrompt(workspacePath);
      if (memory) {
        prompt += `\n\n## 記憶\n${memory}`;
      }
      // #276 follow-up: organon polyseme.sql_mapping を DB 検索精度向上のため inject
      prompt += loadOrganonPolysemeForPrompt();
      // vocab inject: STT vocab (別名→正規名) を OCR/文章読みの正規化用に inject (opt-in)
      prompt += loadVocabForPrompt();
      logger.debug(`[Light] System prompt: ${prompt.length} chars`);
      return prompt;
    },
    model: config.AGENT_LIGHT_MODEL,
    tools,
    mcpServers,
  });

  // ツール実行時の log + ステータス通知フック
  // log は Max turns exceeded 時にも残るため (run() throw → newItems 経由の log は消失) 必須 visibility
  // #249: agent_tool_end hook + generic fallback で tool chain 全 step を visualize
  const TOOL_STATUS_MAP = {
    // 基本 tool
    tavily_search: { status: 'searching', message: '検索中...' },
    code_interpreter: { status: 'calculating', message: '計算中...' },
    generate_image: { status: 'generating', message: '画像生成中...' },
    read_text_file: { status: 'reading', message: 'ファイル読み込み中...' },
    write_text_file: { status: 'writing', message: 'ファイル書き込み中...' },
    list_directory: { status: 'reading', message: 'ディレクトリ読み込み中...' },
    // 主要 MCP tool (Tealus 体験で頻発、#249)
    get_messages: { status: 'reading', message: 'メッセージ確認中...' },
    search_messages: { status: 'searching', message: 'メッセージ検索中...' },
    get_message_media: { status: 'reading', message: 'メディア取得中...' },
    read_document: { status: 'reading', message: '文書を読み込み中...' },
    share_text_as_file: { status: 'writing', message: 'ファイル送信中...' },
    send_message: { status: 'sending', message: 'メッセージ送信中...' },
  };
  agent.on('agent_tool_start', (ctx, tool, details) => {
    const args = details?.toolCall?.arguments;
    const argsStr = args
      ? ` args=${typeof args === 'string' ? args.slice(0, 200) : JSON.stringify(args).slice(0, 200)}`
      : '';
    logger.info(`[Tool] start: ${tool?.name || '?'}${argsStr}`);
    if (roomId) {
      const mapped = TOOL_STATUS_MAP[tool?.name];
      if (mapped) {
        botApi.pushStatus(roomId, mapped.status, mapped.message).catch(() => {});
      } else {
        // #249 generic fallback: mapping 漏れ tool も「動いてる感」を表示
        botApi.pushStatus(roomId, 'processing', `${tool?.name || 'ツール'} を実行中...`).catch(() => {});
      }
    }
  });

  // #249: tool 終了時に「考え中」に戻す (次 step decision 待ち state を可視化)
  // 既存 agent_tool_start のみだと tool 終了 → 次 tool 開始 の間で status が凍結していた
  //
  // 5/12 fix: 旧 heuristic (resultStr.includes('error'|'failed'|'失敗'|'タイムアウト'|'エラー:'))
  // を撤廃。get_messages 等が return した room の過去メッセージ内容に「失敗」「エラー」等の
  // 文字列が含まれているだけで false positive 発火し、UI に「${tool}: 失敗、別アプローチを
  // 検討中...」status が出て user に「assistant が失敗した」誤印象を与えていた。実際は
  // tool は正常 return、agent も正常応答していた。
  //
  // 真の tool error は (1) tool 自体が throw した時 SDK が error 文字列を tool result に
  // 詰めて agent に渡す → agent の判断で最終応答に error 内容が反映される、(2) MCP tool
  // wrapper が 'エラー:' prefix の text を return する → 同じく agent 判断で fallback。
  // どちらも最終的に agent 応答に表れるので、tool_end 時点で status='error' を出す価値は薄い。
  agent.on('agent_tool_end', (ctx, tool, result, details) => {
    logger.info(`[Tool] end: ${tool?.name || '?'}`);
    if (!roomId) return;
    // 「考え中」に戻す (次 step decision まで)
    botApi.pushStatus(roomId, 'thinking', '考え中...').catch(() => {});
  });

  return agent;
}

/**
 * annotations から container_file_citation を抽出して画像を送信
 */
async function sendGeneratedImages(result, roomId) {
  if (!result.newItems) return;

  for (const item of result.newItems) {
    if (item.type !== 'message_output_item') continue;
    const contents = item.rawItem?.content || [];
    for (const c of contents) {
      const annotations = c.providerData?.annotations || c.annotations || [];
      for (const ann of annotations) {
        if (ann.type !== 'container_file_citation') continue;
        try {
          logger.info(`[Image] Downloading: file_id=${ann.file_id}, container_id=${ann.container_id}`);
          const fileResponse = await openai.containers.files.content.retrieve(
            ann.file_id, { container_id: ann.container_id }
          );
          const buffer = Buffer.from(await fileResponse.arrayBuffer());
          const filename = ann.filename || `chart_${Date.now()}.png`;
          await botApi.pushImage(roomId, buffer, filename);
          logger.info(`[Image] Sent to room ${roomId} (${buffer.length} bytes)`);
        } catch (err) {
          logger.error(`[Image] Download/send failed: ${err.message}`);
        }
      }
    }
  }
}

/**
 * Light Agent でメッセージを処理
 */
async function processLight({ roomId, prompt, workspacePath, mcpServers }) {
  try {
    const agent = createLightAgent(workspacePath, mcpServers, roomId);

    // Diagnostic: agent に渡される tools 一覧と MCP servers の状況を log
    try {
      const customToolNames = (agent.tools || []).map(t => t.name || '(unnamed)');
      const mcpInfos = await Promise.all(
        (mcpServers || []).map(async (s) => {
          try {
            const tools = await s.listTools();
            const names = (tools || []).map(t => t.name);
            return `${s.name || '?'}=[${names.join(', ')}]`;
          } catch (e) {
            return `${s.name || '?'}=ERROR(${e.message})`;
          }
        })
      );
      logger.info(`[Light] custom tools: [${customToolNames.join(', ')}], MCP tools: ${mcpInfos.join(' | ')}`);
    } catch (e) {
      logger.warn(`[Light] tool diagnostic failed: ${e.message}`);
    }
    // #230: TealusSession 削除済 (D4 哲学: agent が get_messages で自分で context 取得)
    // session 渡さない = SDK 内部で turn loop は維持、過去 dispatch との連続性は messaging 側で担保

    await botApi.pushStatus(roomId, 'thinking', '考え中...').catch(() => {});

    const result = await run(agent, prompt, {
      maxTurns: getSetting('max_turns', config.LIGHT_MAX_TURNS || 3),
    });

    // #258: Light v1 vs v2 比較用、token usage を log
    // @openai/agents の result から usage を抽出する path は SDK version で異なるので
    // 多 path で fallback (rawResponses / responses / lastResponse)
    try {
      let totalInput = 0;
      let totalOutput = 0;
      const responses = result.rawResponses || result.responses || (result.lastResponse ? [result.lastResponse] : []);
      for (const r of responses) {
        const u = r.usage || r.responseUsage || {};
        totalInput += u.inputTokens || u.input_tokens || u.promptTokens || u.prompt_tokens || 0;
        totalOutput += u.outputTokens || u.output_tokens || u.completionTokens || u.completion_tokens || 0;
      }
      if (totalInput > 0 || totalOutput > 0) {
        logger.info(`[Light] turn completed, usage: input=${totalInput} output=${totalOutput} (responses=${responses.length})`);
      } else {
        logger.debug(`[Light] usage extraction returned 0; result keys=${Object.keys(result).join(',')}`);
      }
    } catch (usageErr) {
      logger.debug(`[Light] usage extract error: ${usageErr.message}`);
    }

    // 使用されたツールをログ
    if (result.newItems) {
      logger.debug(`[Run] newItems: ${result.newItems.length}件`);
      for (const item of result.newItems) {
        const rawType = item.rawItem?.type || '';
        const rawName = item.rawItem?.name || item.rawItem?.call_id || '';
        logger.debug(`[Run] item.type=${item.type}, rawType=${rawType}, rawName=${rawName}`);
        if (item.type === 'tool_call_item') {
          logger.info(`[Tool] 使用: ${rawName || rawType || item.type}`);
        }
      }
    }

    // 生成画像を送信
    await sendGeneratedImages(result, roomId);

    // テキスト応答を送信
    const content = result.finalOutput;
    if (content) {
      if (content.length > 4000) {
        const chunks = splitMessage(content, 4000);
        for (const chunk of chunks) {
          await botApi.pushMessage(roomId, chunk);
        }
      } else {
        await botApi.pushMessage(roomId, content);
      }
      logger.info(`Light response sent to room ${roomId} (${content.length} chars)`);
    }
    await botApi.pushStatus(roomId, 'idle').catch(() => {});
  } catch (err) {
    logger.error(`Light Agent error: ${err.message}`);
    await botApi.pushStatus(roomId, 'idle').catch(() => {});
    try {
      await botApi.pushMessage(roomId, `申し訳ございません。エラーが発生しました: ${err.message}`);
    } catch (pushErr) {
      logger.error(`Failed to send error message: ${pushErr.message}`);
    }
  }
}

/**
 * 長いメッセージを分割
 */
function splitMessage(text, maxLength) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }
  return chunks;
}

module.exports = { processLight, createLightAgent, splitMessage };
