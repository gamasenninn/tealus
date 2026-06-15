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
  too_many_targets: '一度に委譲できるルーム数の上限を超えています。数を減らしてください。',
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

/**
 * 複数室 fan-out + 統合 (#295 真の多重委譲)。
 * 各 target へ並列に runAgent → 成功結果を synthesize で1本化 → 委譲元のみへ post。
 * @param {{originRoomId:string, targets:[{id,name}], task:string}} param
 * @param {{runAgent:Function, synthesize:Function, postToRoom:Function}} deps
 *   synthesize(task, sections) → text  sections=[{name, text, ok}]
 * @returns {Promise<{ok:true, text:string}|{ok:false, reason:string}>}
 */
async function handleMultiDelegation({ originRoomId, targets, task }, deps) {
  const { runAgent, synthesize, postToRoom } = deps;

  // 自室 (origin) は除外 (= 自己委譲は無意味 / cycle)
  const list = targets.filter((t) => t.id !== originRoomId);
  if (list.length === 0) {
    await postToRoom(originRoomId, '⚠️ 委譲先がありません。');
    return { ok: false, reason: 'no_targets' };
  }

  // 並列 fan-out (各室は別 room queue で並行)。throw / 空応答は ok:false に正規化。
  const sections = await Promise.all(list.map(async (t) => {
    try {
      const text = await runAgent(t.id, task);
      const ok = !!(text && text.trim());
      return { name: t.name, text: ok ? text : '(応答なし)', ok };
    } catch (err) {
      logger.warn(`[delegator] multi: target ${t.id} failed: ${err.message}`);
      return { name: t.name, text: '(応答なし)', ok: false };
    }
  }));

  const okCount = sections.filter((s) => s.ok).length;
  if (okCount === 0) {
    logger.warn(`[delegator] multi: all ${list.length} targets failed (origin=${originRoomId})`);
    await postToRoom(originRoomId, '⚠️ どのルームからも応答が得られませんでした。');
    return { ok: false, reason: 'all_failed' };
  }

  let synthesized;
  try {
    synthesized = await synthesize(task, sections);
  } catch (err) {
    logger.error(`[delegator] multi: synthesize failed: ${err.message}`);
    await postToRoom(originRoomId, '⚠️ 統合中にエラーが発生しました。');
    return { ok: false, reason: 'synthesize_error' };
  }

  await postToRoom(originRoomId, synthesized);
  logger.info(`[delegator] multi relayed: ${okCount}/${list.length} rooms → ${originRoomId}`);
  return { ok: true, text: synthesized };
}

module.exports = { handleDelegation, handleMultiDelegation, blockMessage, parseErrorMessage };
