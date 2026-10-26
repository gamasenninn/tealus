jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));
import { sendServerError } from '../../src/lib/serverError.mts';
import { logger } from '../../src/lib/logger.mts';

test('中の場所は記録にだけ残し、返事は決まった文', () => {
  const json = jest.fn();
  const res = { status: jest.fn(() => ({ json })) } as unknown as import('express').Response;
  const req = { method: 'PUT', baseUrl: '/config', path: '/x' } as unknown as import('express').Request;
  sendServerError(req, res, new Error("ENOENT: no such file, open '/srv/app/secret/x.json'"));
  expect((res.status as jest.Mock).mock.calls[0][0]).toBe(500);
  expect(JSON.stringify(json.mock.calls[0][0])).not.toMatch(/ENOENT|secret/);
  expect((logger.error as jest.Mock).mock.calls[0][0]).toContain('ENOENT');
});

test('settings / logs のルートは err.message を返さない', () => {
  const fs = require('node:fs');
  for (const f of ['src/routes/settings.mts', 'src/routes/logs.mts']) {
    const src = fs.readFileSync(f, 'utf8');
    expect(src).not.toMatch(/json\(\{ error: err instanceof Error \? err\.message/);
  }
});
