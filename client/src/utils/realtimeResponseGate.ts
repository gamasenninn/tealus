/**
 * #405 応答の生死と、割り込みに要る item を追う門 (docs/08 §12)。
 *
 * ★ 実測 (2026-09-05) で 2 つの形を踏んだ。どちらも**印象では分からず、計測ログで出た**:
 *
 *   1. 1 ターンで道具が **2 つ並行に**呼ばれ、それぞれの完了で `response.create` を送っていた。
 *      2 通目が `Conversation already has an active response in progress` で弾かれた。
 *      → **最後の 1 つが終わったときだけ**作る。
 *
 *   2. 割り込みで送った `response.cancel` が 5 回中 4 回
 *      `Cancellation failed: no active response found` で失敗した。
 *      ★★ **リアルタイムモデルは喋る速さより速く作る**ので、聞こえている最中には生成が終わっている。
 *      → 止めるべきは生成ではなく、**まだ聞かせていない音声**。`conversation.item.truncate` を送る。
 *      そのために item_id を覚えておく必要がある。
 *
 * ★ 押して話す (`turn_detection: null`) では**サーバの自動割り込みが働かない**
 *   (自動 truncate は発話検知が動いている場合の話)。こちらから送らないと止まらない。
 */
export interface ResponseGate {
  /** サーバからのイベントで、応答の生死と item_id を追う */
  onServerEvent: (type: string, payload?: { item?: { id?: string } }) => void;
  /** 道具の実行を始めた */
  beginTool: () => void;
  /** 道具の実行が終わった。★ 戻り値 true = これが最後なので応答を作ってよい */
  endTool: () => boolean;
  /** いま `response.create` を送ってよいか */
  canCreate: () => boolean;
  /** 応答が走っているか (= `response.cancel` を送る意味があるか) */
  isResponding: () => boolean;
  /** 出力音声が実際に鳴っているか (★ `output_audio_buffer.*` 由来 = まともな計器) */
  isOutputAudioPlaying: () => boolean;
  /** 割り込みの対象になる item_id (無ければ null) */
  activeItemId: () => string | null;
  /** truncate 用に item_id を取り出す。★ 一度取ったら消える (二度 truncate しない) */
  takeItemForTruncate: () => string | null;
  /** セッションを張り直すときに前の状態を持ち越さない */
  reset: () => void;
}

export function createResponseGate(): ResponseGate {
  let pending = 0;                       // 実行中の道具の数
  let active = false;                    // 応答が走っているか
  let itemId: string | null = null;      // いま喋っている item
  let outputAudio = false;               // 出力音声が鳴っているか

  return {
    onServerEvent(type, payload) {
      if (type === 'response.created') active = true;
      else if (type === 'response.done') active = false;
      else if (type === 'response.output_item.added' && payload?.item?.id) {
        itemId = payload.item.id;
      }
      // ★ 出力音声の生死。名前が揺れている (started / audio_started、stopped / cleared /
      //   audio_stopped) ので、前方一致で拾って**始まり以外は全部「止まった」**に寄せる。
      //   一部は公式ドキュメントに未記載 (コミュニティ報告で判明)。
      else if (type.startsWith('output_audio_buffer.')) {
        outputAudio = type.endsWith('started');
      }
    },
    beginTool() { pending += 1; },
    endTool() {
      pending = Math.max(0, pending - 1);
      return pending === 0;
    },
    canCreate() { return !active && pending === 0; },
    isResponding() { return active; },
    isOutputAudioPlaying() { return outputAudio; },
    activeItemId() { return itemId; },
    takeItemForTruncate() {
      const id = itemId;
      itemId = null;
      return id;
    },
    reset() { pending = 0; active = false; itemId = null; outputAudio = false; },
  };
}
