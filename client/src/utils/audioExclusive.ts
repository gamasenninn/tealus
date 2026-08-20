/**
 * 音声の同時再生を抑制する「合図」の規約 (#380)。
 *
 * ★ これは再生バーの機能ではない。**window に流れるイベントの規約**で、
 *   規約さえ守れば 手作りの再生バーでも 標準の <audio controls> でも参加できる。
 *   #376 で標準バーを足したとき、参加させることを考えていなかったのが元の穴。
 *
 * 既存の受け手 (名前を変えない):
 *   - `VoiceBubble`            … `voice:started` で自分以外なら停止
 *   - `useVoiceContinuousPlay` … `voice:started` で Wake Lock 取得 /
 *                                `voice:stop-continuous` で解放
 *
 * ★★ したがって「参加する」= Wake Lock の取得/解放にも参加するということ。
 *   音が鳴っている間だけ画面を保つ、という既存の振る舞いに乗る。
 */

/** 再生開始の合図。detail.messageId は **再生単位で一意** なら何でもよい (media id 可) */
export const VOICE_STARTED = 'voice:started';
/** 連続再生の終了 = Wake Lock 解放の合図 */
export const VOICE_STOP_CONTINUOUS = 'voice:stop-continuous';

/** 自分が再生を始めたことを知らせる (他の再生は止まる / Wake Lock が取られる) */
export function notifyAudioStarted(id: string): void {
  window.dispatchEvent(new CustomEvent(VOICE_STARTED, { detail: { messageId: id } }));
}

/**
 * 自分の意思で止めたことを知らせる (Wake Lock 解放)。
 *
 * ★ 「他に止められた」ときに呼んではいけない —— 直前に相手が取った Wake Lock を
 *   解放してしまう。呼び出し側は理由を区別すること (useExclusiveAudio が担当)。
 */
export function notifyAudioStopped(): void {
  window.dispatchEvent(new CustomEvent(VOICE_STOP_CONTINUOUS));
}

/**
 * 他の音声が始まったら通知を受ける。
 * @returns 購読解除関数
 */
export function subscribeAudioStarted(selfId: string, onOtherStarted: () => void): () => void {
  const handler = (e: Event) => {
    const id = (e as CustomEvent<{ messageId?: string }>).detail?.messageId;
    if (id !== selfId) onOtherStarted();
  };
  window.addEventListener(VOICE_STARTED, handler);
  return () => window.removeEventListener(VOICE_STARTED, handler);
}
