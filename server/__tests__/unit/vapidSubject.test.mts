/**
 * VAPID の連絡先 (subject) を起動時に点検する (2026-09-27)
 *
 * ★ 本番で Apple 宛ての通知が全部 403 {"reason":"BadJwtToken"} だった (9/26 に 47 回)。
 *   連絡先が `mailto:admin@tealus.local` (コードの既定値と同じ) で、Apple は実在しない
 *   ドメイン (.local / localhost) の連絡先を受け付けない。
 * ★★ 403 の理由をログに出すまで、だれも気づけなかった → 起動時に言う。
 */
jest.mock('../../src/utils/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
} }));
jest.mock('../../src/db/pool.mts', () => ({ pool: { query: jest.fn() } }));

import { vapidSubjectProblem } from '../../src/services/push.mts';

describe('vapidSubjectProblem', () => {
  test.each([
    'mailto:admin@tealus.local',
    'mailto:me@localhost',
    'https://localhost:3000',
    'https://tealus.local',
  ])('★★ Apple が受け付けない連絡先: %s', (s) => {
    expect(vapidSubjectProblem(s)).toMatch(/Apple/);
  });

  test('★ 設定されていない (既定値に落ちる) ときも言う', () => {
    expect(vapidSubjectProblem(undefined)).toMatch(/VAPID_SUBJECT/);
  });

  test('mailto: / https: 以外は形が違う', () => {
    expect(vapidSubjectProblem('admin@example.com')).toMatch(/mailto:|https:/);
  });

  test.each([
    'mailto:admin@example.com',
    'mailto:someone@gmail.com',
    'https://app.example.org',
  ])('問題なし: %s', (s) => {
    expect(vapidSubjectProblem(s)).toBeNull();
  });
});
