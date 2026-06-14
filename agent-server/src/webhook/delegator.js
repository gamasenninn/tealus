/**
 * デリゲーター: `%` 委譲のオーケストレーション (#295)
 *
 * 委譲 1 件を実行する責務:
 *   1. delegationChain.startChain で chain 起動 (4 段ガード)。blocked なら委譲元へ理由通知。
 *   2. 委譲先 agent を runAgent(targetRoomId, task) で実行し最終本文を得る。
 *      → 委譲先 agent は「委譲されている」ことを知らない。普段どおり自室の質問として答え、
 *        本文を return するだけ。戻すのはデリゲーターの仕事 (= 責務分離、Test 2 の脆さ解消)。
 *   3. 結果は **委譲元のみ** へ postToRoom する (委譲先には残さない = 計算ノードに徹する)。
 *
 * 副作用 (agent 実行 / room 投稿) は deps で注入する (実 SDK 非依存で test 可能)。
 *   deps.runAgent(roomId, task) → Promise<string>  委譲先 agent の最終本文
 *   deps.postToRoom(roomId, text) → Promise<void>   room へ投稿
 *
 * 注: agent 起点の `%` 連鎖 (extendChain による再帰) は本 MVP では未実装。
 *     delegationChain は対応済のため follow-up で接続する。
 */
const logger = require('../lib/logger');
const { startChain } = require('./delegationChain');

const BLOCK_MESSAGE = {
  cycle: 'ループになるため委譲できませんでした。',
  max_depth: '委譲の段数が深すぎるため委譲できませんでした。',
  fanout_exceeded: '一度に多くの委譲を要求したため委譲できませんでした。',
  budget_exhausted: '委譲が多すぎるため委譲を打ち切りました。',
  unknown_chain: '委譲チェーンが無効なため委譲できませんでした。',
};

function blockMessage(reason) {
  return `⚠️ ${BLOCK_MESSAGE[reason] || '委譲できませんでした。'}`;
}

// parseDelegation の {ok:false} (構文解決失敗) を委譲元へ返す日本語通知 (#295)
const PARSE_ERROR_MESSAGE = {
  room_not_found: '指定したルームが見つかりませんでした。ルーム名を確認してください。',
  empty_task: '委譲する内容が空です。`%ルーム名 依頼内容` の形式で指定してください。',
  ambiguous: '同名のルームが複数あり特定できませんでした。',
};

function parseErrorMessage(reason) {
  return `⚠️ ${PARSE_ERROR_MESSAGE[reason] || '委譲先を解決できませんでした。'}`;
}

/**
 * 委譲 1 件を実行する。
 * @param {{originRoomId:string, targetRoom:{id:string,name:string}, task:string}} param
 * @param {{runAgent:Function, postToRoom:Function}} deps
 * @returns {Promise<{ok:true, text:string}|{ok:false, reason:string}>}
 */
async function handleDelegation({ originRoomId, targetRoom, task }, deps) {
  const { runAgent, postToRoom } = deps;

  // 1. chain 起動 (4 段ガード)
  const start = startChain({ originRoomId, targetRoomId: targetRoom.id, task });
  if (!start.ok) {
    logger.info(`[delegator] blocked: reason=${start.reason} origin=${originRoomId} target=${targetRoom.id}`);
    await postToRoom(originRoomId, blockMessage(start.reason));
    return { ok: false, reason: start.reason };
  }

  // 2. 委譲先 agent 実行 (agent は委譲を意識しない)
  let text;
  try {
    text = await runAgent(targetRoom.id, task);
  } catch (err) {
    logger.error(`[delegator] target agent error in ${targetRoom.id}: ${err.message}`);
    await postToRoom(originRoomId, `⚠️ 委譲先「${targetRoom.name}」でエラーが発生しました。`);
    return { ok: false, reason: 'agent_error' };
  }

  if (!text || !text.trim()) {
    logger.warn(`[delegator] empty response from target ${targetRoom.id}`);
    await postToRoom(originRoomId, `⚠️ 委譲先「${targetRoom.name}」から応答が得られませんでした。`);
    return { ok: false, reason: 'empty_response' };
  }

  // 3. 委譲元のみへ返却 (出所を明示)
  const relayed = `（${targetRoom.name} より）\n${text}`;
  await postToRoom(originRoomId, relayed);
  logger.info(`[delegator] relayed ${text.length} chars: ${targetRoom.name} → ${originRoomId}`);
  return { ok: true, text };
}

module.exports = { handleDelegation, blockMessage, parseErrorMessage };
