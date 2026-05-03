/**
 * Startup env validation (#228)
 * 採用者切り分け改善: 起動時に必要な env が空 / 未設定なら loud warn で
 * 採用者を解決手順に誘導する。fail-fast はせず、起動は継続。
 */

function isEmpty(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function checkOpenAIApiKey(logger, env = process.env) {
  if (!isEmpty(env.OPENAI_API_KEY)) return false;
  logger.warn('=================================================');
  logger.warn('OPENAI_API_KEY is not set in server/.env');
  logger.warn('=================================================');
  logger.warn('以下の機能が動作しません:');
  logger.warn('  - voice transcription (Whisper / gpt-4o-transcribe)');
  logger.warn('  - voice formatting (AI 整形)');
  logger.warn('  - stamp generation (OpenAI text + DALL-E)');
  logger.warn('  - その他 OpenAI API を呼ぶ機能');
  logger.warn('');
  logger.warn('解決方法:');
  logger.warn('  1. server/.env を編集');
  logger.warn('  2. OPENAI_API_KEY=sk-xxxx... を有効な値で設定');
  logger.warn('  3. server を再起動');
  logger.warn('');
  logger.warn('OpenAI dashboard: https://platform.openai.com/account/api-keys');
  logger.warn('=================================================');
  return true;
}

function runStartupEnvCheck(logger, env = process.env) {
  const warnings = [];
  if (checkOpenAIApiKey(logger, env)) warnings.push('OPENAI_API_KEY');
  return warnings;
}

module.exports = { runStartupEnvCheck, checkOpenAIApiKey, isEmpty };
