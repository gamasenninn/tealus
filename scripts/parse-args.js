/**
 * CLI引数パース処理
 * tealus-cli.js から分離してテスト可能にする
 */

function parseSendArgs(args) {
  const target = args[0];
  if (!target) {
    throw new Error('送信先を指定してください');
  }

  const textIdx = args.indexOf('--text');
  const imageIdx = args.indexOf('--image');
  const voiceIdx = args.indexOf('--voice');
  const watchIdx = args.indexOf('--watch');
  const extIdx = args.indexOf('--ext');
  const catchUpIdx = args.indexOf('--catch-up');

  const hasText = textIdx !== -1;
  const hasImage = imageIdx !== -1;
  const hasVoice = voiceIdx !== -1;
  const hasWatch = watchIdx !== -1;

  // --text, --image, --voice いずれも指定なし
  if (!hasText && !hasImage && !hasVoice) {
    throw new Error('--text, --image, --voice のいずれかを指定してください');
  }

  // --watch と --text/--image の相互排除
  if (hasWatch && hasText) {
    throw new Error('--watch と --text は同時に指定できません');
  }
  if (hasWatch && hasImage) {
    throw new Error('--watch と --image は同時に指定できません');
  }

  const result = { target, mode: 'send' };

  // --text
  if (hasText) {
    result.text = args[textIdx + 1];
  }

  // --image
  if (hasImage) {
    result.image = args[imageIdx + 1];
  }

  // --voice
  if (hasVoice) {
    const nextArg = args[voiceIdx + 1];

    if (nextArg && !nextArg.startsWith('--')) {
      // --voice の直後にファイルパス → 単発送信
      result.voice = nextArg;
    } else if (hasWatch) {
      // 監視モード
      result.mode = 'watch';
      const watchDir = args[watchIdx + 1];
      if (!watchDir || watchDir.startsWith('--')) {
        throw new Error('--watch の後に監視ディレクトリを指定してください');
      }
      result.watchDir = watchDir;

      // --ext
      if (extIdx !== -1) {
        const extStr = args[extIdx + 1];
        result.extensions = extStr ? extStr.split(',').map(e => e.trim()) : ['.wav'];
      } else {
        result.extensions = ['.wav'];
      }
      result.catchUp = catchUpIdx !== -1;
    } else {
      // --voice 単体でファイルも --watch もなし
      throw new Error('--voice にはファイルパスまたは --watch を指定してください');
    }
  }

  return result;
}

/**
 * グローバルオプション（--bot-id, --bot-pass）を抽出し、残りの引数を返す
 * 全コマンド共通で使用
 *
 * @param {string[]} args - process.argv.slice(2) 相当
 * @returns {{ botId?: string, botPass?: string, rest: string[] }}
 */
function parseGlobalArgs(args) {
  const result = { rest: [] };
  let i = 0;
  while (i < args.length) {
    if (args[i] === '--env' && i + 1 < args.length) {
      result.envFile = args[i + 1];
      i += 2;
    } else if (args[i] === '--bot-id' && i + 1 < args.length) {
      result.botId = args[i + 1];
      i += 2;
    } else if (args[i] === '--bot-pass' && i + 1 < args.length) {
      result.botPass = args[i + 1];
      i += 2;
    } else {
      result.rest.push(args[i]);
      i++;
    }
  }
  return result;
}

module.exports = { parseSendArgs, parseGlobalArgs };
