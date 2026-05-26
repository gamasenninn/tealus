#!/usr/bin/env node
/**
 * mine_transcription_aliases.js — voice_transcriptions の編集履歴から alias 候補を mining する
 *
 * 🛑 **DEPRECATED (2026-05-26 Day 10、正式 deprecation)**:
 * 本 script は `tealus-mcp v0.14.0` の `get_message_edit_history` MCP tool により
 * **organon daily cycle 内 direct fetch** に代替された (= 「1 instrument 主義」5/24 user 提案起源)。
 * Day 9-10 の parallel observation で Path A operational evidence N=2 達成 (= organon Day 9 + Day 10
 * 連続で edit pair fetch 成功、「クボタ / ビレッジ / イセキ」を ground-truth で再現 + false positive 解消)。
 * これを trigger に、Day 8 の暫定 candidate note を正式 deprecation に確定。
 *
 * 現行運用: organon class が daily cycle 内で MCP tool 経由 edit pair を direct fetch し、
 *   context-based reasoning で alias / hazard 候補を抽出 (= 本 script の GPT-4o-mini structured
 *   extraction より sophisticated、false positive ~50% を解消)。
 *
 * 本 script の位置付け:
 *   - **定期実行なし** (= 元々 cron 未設定の手動 CLI、regular cycle から外れた)。
 *   - 残置理由 = safety net (= organon が見落とした pair の retroactive audit 用、必要時のみ手動 run)。
 *   - **Day 14+ で完全 archive 候補** (= server/scripts/archive/ 移動)。
 *   - mining script v2 (= prompt 改善で false positive 解消) work は **不要と判断** (= Path A の
 *     context-based reasoning が prompt extraction より優れるため)。
 *
 * 構築背景: Issue #206 (5/4 起源) + #208 (by-term モード追加) で構築、両 CLOSED。
 * 関連: tealus-mcp v0.14.0 release (= commit `b514a83`)、tealus #281 follow-up (= commit `c8afcb4`)、
 * Path A N=2 達成 = organon Day 10 報告 (2026-05-26、AI班連絡)。
 *
 * ---
 *
 * AI が生成した formatted_text と人間が訂正した formatted_text のペアを GPT-4o-mini に投げ、
 * 固有名詞・専門用語の (誤転写, 正解) ペアを抽出する。
 *
 * 既存の transcription_guideline.json は **書き換えない**。出力は report ファイル
 * (デフォルト server/config/mining_report.json) に書き出される。人間がレビューして手動 merge。
 *
 * 使い方:
 *   node scripts/mine_transcription_aliases.js [options]
 *
 * Node 20+ の --env-file で .env を読み込む例:
 *   node --env-file=.env scripts/mine_transcription_aliases.js --threshold=2
 *
 * Options:
 *   --threshold=N             最低出現回数 (default 2)
 *   --since=YYYY-MM-DD        この日時以降の編集のみ対象
 *   --limit=N                 GPT 呼び出し回数を制限 (試運転用)
 *   --guideline-path=PATH     既存 guideline JSON のパス
 *   --report-path=PATH        出力 report のパス
 *   --mode=pair|by-term       集計モード (default 'pair')。by-term は同じ to に集まる
 *                             散発 alias を救う (#208)
 *   --require-high-confidence by-term モード時、high 1 件以上含む term のみ採用
 *   --model=MODEL             OpenAI model 指定 (default 'gpt-4o-mini'、gpt-5* 系も可)
 *
 * 必要な環境変数:
 *   OPENAI_API_KEY (必須)
 *   DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD (default は src/db/pool.js と同じ)
 *
 * 安全性:
 *   - read-only スクリプト (DB の voice_transcriptions に書き込まない)
 *   - 既存 guideline JSON も書き換えない (report のみ書き出し)
 *   - 失敗しても DB 状態は変わらない
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const OpenAI = require('openai');
const aliasMiner = require('../src/services/aliasMiner');

function parseArgs(argv) {
  const args = {
    threshold: 2,
    since: null,
    limit: null,
    guidelinePath: path.join(__dirname, '../config/transcription_guideline.json'),
    reportPath: path.join(__dirname, '../config/mining_report.json'),
    mode: 'pair',
    requireHighConfidence: false,
    model: null,
  };
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([\w-]+)(?:=(.*))?$/);
    if (!m) continue;
    const [, key, value] = m;
    switch (key) {
      case 'threshold':
        args.threshold = parseInt(value, 10) || 2;
        break;
      case 'since':
        args.since = value;
        break;
      case 'limit':
        args.limit = parseInt(value, 10) || null;
        break;
      case 'guideline-path':
        args.guidelinePath = value;
        break;
      case 'report-path':
        args.reportPath = value;
        break;
      case 'mode':
        if (value === 'pair' || value === 'by-term') {
          args.mode = value;
        } else {
          console.error(`[mine] WARN: unknown mode "${value}", using default 'pair'`);
        }
        break;
      case 'model':
        args.model = value;
        break;
      case 'require-high-confidence':
        args.requireHighConfidence = true;
        break;
      case 'help':
        printHelp();
        process.exit(0);
        break;
    }
  }
  return args;
}

function printHelp() {
  console.log(`mine_transcription_aliases.js — voice_transcriptions 編集履歴から alias 候補を mining

Options:
  --threshold=N             最低出現回数 (default 2)
  --since=YYYY-MM-DD        この日時以降の編集のみ対象
  --limit=N                 GPT 呼び出し回数を制限 (試運転用)
  --guideline-path=PATH     既存 guideline JSON のパス
  --report-path=PATH        出力 report のパス
  --mode=pair|by-term       集計モード (default 'pair')
  --require-high-confidence by-term モード時、high 信頼度を含む term のみ採用
  --model=MODEL             OpenAI model 指定 (default gpt-4o-mini、gpt-5* 系も可)
  --help                    このメッセージ

集計モードの違い:
  pair (default): (from, to) ペア単位で出現回数を集計、threshold 判定
  by-term:        to (= 正規表記の term) 単位で集計、頻出 term の長尾誤認も救う
                  例: 「ガマ」関連 4 通りの誤認が個別 1 件ずつでも合計 4 で採用される`);
}

function loadExistingVocabulary(guidelinePath) {
  if (!fs.existsSync(guidelinePath)) return [];
  try {
    const raw = fs.readFileSync(guidelinePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.vocabulary) ? parsed.vocabulary : [];
  } catch (err) {
    console.warn(`[mine] WARN: failed to parse ${guidelinePath}, treating as empty`);
    return [];
  }
}

async function main() {
  const args = parseArgs(process.argv);
  console.log('[mine] Starting transcription alias mining');
  console.log(`[mine]   threshold: ${args.threshold}`);
  console.log(`[mine]   since: ${args.since || '(all)'}`);
  console.log(`[mine]   limit: ${args.limit || '(unlimited)'}`);
  console.log(`[mine]   guideline-path: ${args.guidelinePath}`);
  console.log(`[mine]   report-path: ${args.reportPath}`);

  if (!process.env.OPENAI_API_KEY) {
    console.error('[mine] ERROR: OPENAI_API_KEY is required');
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'tealus',
    user: process.env.DB_USER || 'tealus',
    password: process.env.DB_PASSWORD || 'tealus_dev',
  });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    let query = `
      SELECT message_id, version, formatted_text, edited_by, created_at
      FROM voice_transcriptions
      WHERE formatted_text IS NOT NULL
    `;
    const params = [];
    if (args.since) {
      params.push(args.since);
      query += ` AND created_at >= $${params.length}`;
    }
    query += ' ORDER BY message_id, version';

    const result = await pool.query(query, params);
    console.log(`[mine] Fetched ${result.rows.length} transcription rows`);

    const pairs = aliasMiner.buildPairsFromRows(result.rows);
    console.log(`[mine] Built ${pairs.length} (AI vs user) pairs`);

    if (pairs.length === 0) {
      console.log('[mine] No pairs to analyze. Exiting.');
      writeReport(args.reportPath, args, result.rows.length, 0, 0, 0, { newTerms: [], aliasAdditions: [] }, []);
      return;
    }

    const targetPairs = args.limit ? pairs.slice(0, args.limit) : pairs;
    if (args.limit && pairs.length > args.limit) {
      console.log(`[mine] Limiting to first ${args.limit} pairs (of ${pairs.length})`);
    }

    const allAliases = [];
    for (let i = 0; i < targetPairs.length; i++) {
      const pair = targetPairs[i];
      console.log(`[mine] [${i + 1}/${targetPairs.length}] Analyzing ${pair.messageId}...`);
      const aliases = await aliasMiner.extractAliases(pair, openai, args.model ? { model: args.model } : {});
      if (aliases.length > 0) {
        const summary = aliases.map(a => `${a.from}→${a.to}`).join(', ');
        console.log(`[mine]   → ${aliases.length} alias(es): ${summary}`);
      }
      allAliases.push(...aliases);
    }
    console.log(`[mine] Total raw aliases extracted: ${allAliases.length}`);

    const aggregated = aliasMiner.aggregateAliases(allAliases, {
      mode: args.mode,
      threshold: args.threshold,
      requireHighConfidence: args.requireHighConfidence,
    });
    const modeDesc = args.mode === 'by-term'
      ? `by-term${args.requireHighConfidence ? ' + require-high-confidence' : ''}`
      : 'pair';
    console.log(`[mine] After threshold (>=${args.threshold}, mode=${modeDesc}): ${aggregated.length} alias(es)`);

    // 閾値未満は常に pair モードで参考表示 (mode に依存しない比較対象として)
    const belowThreshold = aliasMiner.aggregateAliases(allAliases, 1).filter(a => a.count < args.threshold);

    const existingVocab = loadExistingVocabulary(args.guidelinePath);
    const candidates = aliasMiner.buildMergeCandidates(aggregated, existingVocab);

    writeReport(
      args.reportPath,
      args,
      result.rows.length,
      targetPairs.length,
      allAliases.length,
      aggregated.length,
      candidates,
      belowThreshold
    );
    console.log(`[mine] Report written to ${args.reportPath}`);

    console.log('\n=== Summary ===');
    console.log(`新規 term 候補: ${candidates.newTerms.length}`);
    candidates.newTerms.slice(0, 5).forEach(t => {
      console.log(`  - ${t.term} (${t.category}) ← ${t.aliases.join(', ')}`);
    });
    console.log(`既存 term への alias 追加候補: ${candidates.aliasAdditions.length}`);
    candidates.aliasAdditions.slice(0, 5).forEach(a => {
      console.log(`  - ${a.term} += ${a.new_aliases.join(', ')}`);
    });
    if (belowThreshold.length > 0) {
      console.log(`\n閾値未満 (参考、${belowThreshold.length} 件): 上位 5 件`);
      belowThreshold.slice(0, 5).forEach(a => {
        console.log(`  - ${a.from} → ${a.to} (count: ${a.count})`);
      });
    }
  } catch (err) {
    console.error('[mine] FATAL:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

function writeReport(reportPath, args, rowsFetched, pairsAnalyzed, aliasesRaw, aliasesAboveThreshold, candidates, belowThreshold) {
  const report = {
    generated_at: new Date().toISOString(),
    args: {
      threshold: args.threshold,
      since: args.since,
      limit: args.limit,
      guidelinePath: args.guidelinePath,
      mode: args.mode,
      requireHighConfidence: args.requireHighConfidence,
    },
    stats: {
      rows_fetched: rowsFetched,
      pairs_analyzed: pairsAnalyzed,
      aliases_total_raw: aliasesRaw,
      aliases_above_threshold: aliasesAboveThreshold,
    },
    merge_candidates: candidates,
    below_threshold_aliases: belowThreshold,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
}

if (require.main === module) {
  main().catch(err => {
    console.error('[mine] FATAL:', err);
    process.exit(1);
  });
}

module.exports = { parseArgs, loadExistingVocabulary };
