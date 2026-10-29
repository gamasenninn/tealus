/**
 * Light v2 の turn.failed を失敗として扱う (2026-10-29 改善ループ 24 回目の残り)
 *
 * ★ codex-sdk の runStreamed は turn.failed を流すだけで投げない。以前はログに書くだけで先へ進み、
 *   途中の独り言 (「これから X を読みます」) があればそれが答えとして投稿された (失敗に見えない)。
 *   案内が出たのは、たまたま Windows の taskkill の出力で SDK が投げたときだけだった
 */
import { turnFailureError } from '../../src/agents/lightV2.mts';

describe('turnFailureError', () => {
  it('★★ turn.failed が来て turn が終わっていなければ、失敗として投げる中身を返す (原因の文を含む)', () => {
    const e = turnFailureError(false, 'model_not_supported: gpt-x');
    expect(e).toBeInstanceOf(Error);
    expect(e!.message).toMatch(/model_not_supported/);
  });

  it('turn.failed が来ていなければ null', () => {
    expect(turnFailureError(false, null)).toBeNull();
  });

  it('turn が終わったあとなら null (成功の扱いのまま)', () => {
    expect(turnFailureError(true, 'late error')).toBeNull();
  });
});
