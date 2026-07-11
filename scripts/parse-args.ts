/**
 * CLI引数パース処理
 * tealus-cli.ts から分離してテスト可能にする
 */

export interface SendModeArgs {
  mode: 'send';
  target: string;
  text?: string;
  image?: string;
  voice?: string;
}

export interface WatchModeArgs {
  mode: 'watch';
  target: string;
  watchDir: string;
  extensions: string[];
  catchUp: boolean;
}

export type ParsedSendArgs = SendModeArgs | WatchModeArgs;

export function parseSendArgs(args: string[]): ParsedSendArgs {
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

  // --voice
  if (hasVoice) {
    const nextArg = args[voiceIdx + 1];

    if (nextArg && !nextArg.startsWith('--')) {
      // --voice の直後にファイルパス → 単発送信（下の send モード組み立てへ）
    } else if (hasWatch) {
      // 監視モード
      const watchDir = args[watchIdx + 1];
      if (!watchDir || watchDir.startsWith('--')) {
        throw new Error('--watch の後に監視ディレクトリを指定してください');
      }

      // --ext
      let extensions: string[];
      if (extIdx !== -1) {
        const extStr = args[extIdx + 1];
        extensions = extStr ? extStr.split(',').map(e => e.trim()) : ['.wav'];
      } else {
        extensions = ['.wav'];
      }

      return { mode: 'watch', target, watchDir, extensions, catchUp: catchUpIdx !== -1 };
    } else {
      // --voice 単体でファイルも --watch もなし
      throw new Error('--voice にはファイルパスまたは --watch を指定してください');
    }
  }

  const result: SendModeArgs = { mode: 'send', target };

  // --text
  if (hasText) {
    result.text = args[textIdx + 1];
  }

  // --image
  if (hasImage) {
    result.image = args[imageIdx + 1];
  }

  // --voice（到達時は直後がファイルパスと確定済み）
  if (hasVoice) {
    result.voice = args[voiceIdx + 1];
  }

  return result;
}

/**
 * グローバルオプション（--env, --bot-id, --bot-pass）を抽出し、残りの引数を返す
 * 全コマンド共通で使用
 */
export interface GlobalArgs {
  envFile?: string;
  botId?: string;
  botPass?: string;
  rest: string[];
}

export function parseGlobalArgs(args: string[]): GlobalArgs {
  const result: GlobalArgs = { rest: [] };
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
