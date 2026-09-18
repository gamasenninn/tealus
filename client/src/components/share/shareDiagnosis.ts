/**
 * #445 共有が失敗したときに **何が起きなかったか**を名指しする。★ 純関数。
 *
 * ★★★★★ なぜ要るか (2026-09-18)
 *
 * 09-17 から「共有すると画面は開くがファイルが入らない」が続いた。★ 端末に触れないまま
 * 黒箱で 7 つ潰した (LINE / リファクタ / Cloudflare・nginx / サイズ / SW の死 / SW の状態 /
 * WebAPK) が、★★ **最後は Chrome のバージョン差** (153 で壊れ / 141 で動く) にたどり着いた。
 * ★★★ **リリースノートにも既知の記録が無い** = 次も推測で追うことになる。
 *
 * → ★★★★ **次に失敗したとき、推測ではなく 1 行の事実が残る**ようにする。
 *
 * ## ★ 判定は「記録の有無」を主にする
 *
 * ★★ 印を URL に置くと **再訪 (履歴 / 再読み込み) で残る**。SW は Cache に **一度きりの記録**を
 *   置き、画面は読んだら消す。★★★ 「何秒以内を新しいとするか」を決めずに済む。
 *
 * ## ★★★★ 行の順序は仕様である
 *
 * ★ 5 行は **排他ではない** (同時に真になれる組がある)。★★ 並べ替えのリファクタで静かに
 *   変わらないよう、順序そのものをテストで固定している。★★★ とくに:
 *   **旧 SW は live な共有でも files=N を付ける** ので、再訪を先に見ると
 *   **生きている共有の失敗を「再訪」と誤診する**。
 *
 * ## ★★★★★ 昨日の誤診 (2026-09-17 に入れたもの)
 *
 * ★ 「ファイル N 件を取り出せませんでした。端末の空き容量を確認して…」は、
 *   **成功した共有を再読み込みしただけでも出る** (★★ 画面が Cache を読んだ直後に消すため)。
 * ★★★ **沈黙を潰すと、次は誤報が出る。** ★ 空き容量を疑ってよいのは
 *   **「SW が動いて、0 バイトで届いた」ときだけ**に限る。
 */

/** SW が 1 回の共有について置く記録。★ 画面が読んだら消す (一度きり)。 */
export interface ShareRecord {
  /** 受け取った form の field 名 (★ 点呼。media が無いこと自体が情報) */
  fields: string[];
  /** media field の件数 (★ サイズで絞る **前**) */
  mediaCount: number;
  /** うち 0 バイトだったもの */
  zeroSized: number;
  /** 各サイズ (byte) */
  sizes: number[];
  /** SW が書いた時刻 (★ 二重の保険。判定の主ではない) */
  t: number;
}

/** launchQueue 側の状態。★ null = 見ていない (★★ 「非対応」「0 件」と混ぜない) */
export interface LaunchStateLike {
  checked: boolean;
  supported: boolean;
  fileCount: number;
}

export interface ShareDiagnosisInput {
  /** 一度きりの記録。★ 無ければ null */
  record: ShareRecord | null;
  /** `navigator.serviceWorker.controller` があるか */
  controlled: boolean;
  /** ★ controller が share-diag に返事したか。★★ 旧版は listener を持たないので黙る */
  swReplied: boolean;
  /** URL に共有由来のパラメータ (files / text / via) が残っているか */
  hasShareParams: boolean;
  /**
   * ★ launchQueue 側の状態。★★ null = 見ていない。
   * ★★★ **判定 (code) は変えない。点呼にだけ出す** —— 受け口がどちらだったかを
   *   次の 1 枚で確定させるための欄で、判定の筋を増やすためのものではない。
   */
  launch: LaunchStateLike | null;
}

export type ShareDiagnosisCode =
  /** SW が POST を処理した (★ 中身は detail を見る) */
  | 'sw-handled'
  /** SW が効いていない */
  | 'sw-absent'
  /** 旧版の SW が制御している */
  | 'sw-stale'
  /** 記録が無く、URL のパラメータだけが残っている */
  | 'revisit'
  /** SW は今のものだが、POST 自体が起きていない */
  | 'no-post';

export interface ShareDiagnosis {
  code: ShareDiagnosisCode;
  /** 利用者に見せる 1 行 */
  message: string;
  /** 点呼 (★ 開発者向け。画面にも小さく出す) */
  detail: string;
}

/** launchQueue 側を 1 語にする。★ 4 つを書き分ける (見ていない / 非対応 / 0 件 / N 件)。 */
function launchNote(l: LaunchStateLike | null): string {
  if (!l || !l.checked) return 'launchQueue: 見ていません';
  if (!l.supported) return 'launchQueue: 非対応';
  return `launchQueue: ファイル ${l.fileCount} 件`;
}

/** 記録を 1 行の点呼にする。★ 「media が 0 件」と「media が無い」を分けて書く。 */
function census(r: ShareRecord | null, l: LaunchStateLike | null): string {
  const tail = launchNote(l);
  if (!r) return `記録なし（SW からの受け取り記録がありません） / ${tail}`;
  const hasMediaField = r.fields.includes('media');
  return [
    `field: [${r.fields.join(', ')}]`,
    hasMediaField ? `media ${r.mediaCount} 件` : 'media フィールド自体が来ていません',
    `うち 0 バイト ${r.zeroSized} 件`,
    r.sizes.length > 0 ? `サイズ: ${r.sizes.join(', ')}` : 'サイズ: なし',
    tail,
  ].join(' / ');
}

/**
 * 共有画面の状態から、何が起きなかったかを決める。
 *
 * ★★★★ **判定の順序は仕様**。上から順に、最初に当たったものを返す。
 */
export function diagnoseShare(input: ShareDiagnosisInput): ShareDiagnosis {
  const detail = census(input.record, input.launch);

  // ① 記録がある = SW が POST を処理した。★ 他が何であれこれが勝つ (いちばん強い事実)
  if (input.record) {
    const r = input.record;
    if (r.mediaCount === 0) {
      return {
        code: 'sw-handled',
        // ★ ここで空き容量を持ち出さない。**渡ってきていない**のであって、置けなかったのではない
        message: 'ファイルが 1 件も渡ってきていません（共有元からアプリへの受け渡しで止まっています）。',
        detail,
      };
    }
    if (r.zeroSized > 0) {
      return {
        code: 'sw-handled',
        // ★ 空き容量を疑ってよいのは ここだけ
        message: `ファイルは ${r.mediaCount} 件届きましたが、${r.zeroSized} 件が 0 バイトでした。端末の空き容量を確認して、もう一度お試しください。`,
        detail,
      };
    }
    return { code: 'sw-handled', message: `ファイルを ${r.mediaCount} 件 受け取りました。`, detail };
  }

  // ② SW が効いていない。★ 再訪と同時に真になれるが、**打てる手がある方**を先に返す
  if (!input.controlled) {
    return {
      code: 'sw-absent',
      message: 'アプリの受け取り部分が動いていません。アプリを開き直してからもう一度お試しください。',
      detail,
    };
  }

  // ③ 旧版の SW が制御している。★ 再訪より先 —— ★★ 旧 SW は live な共有でも
  //    files=N を付けるので、順序を入れ替えると **生きている失敗を再訪と誤診する**
  if (!input.swReplied) {
    return {
      code: 'sw-stale',
      message: 'アプリの古い版が動いています。アプリを開き直してからもう一度お試しください。',
      detail,
    };
  }

  // ④ 記録が無く、URL のパラメータだけが残っている = 履歴 / 再読み込み
  if (input.hasShareParams) {
    return {
      code: 'revisit',
      // ★ ここで空き容量を疑わせない (★★ 2026-09-17 に入れた誤診の修正)
      message: 'この画面は前回の共有の再表示です。共有し直してください。',
      detail,
    };
  }

  // ⑤ SW は今のものだが、共有そのものが届いていない
  return {
    code: 'no-post',
    message: '共有の内容が届いていません（テキストもファイルも受け取れていません）。',
    detail,
  };
}
