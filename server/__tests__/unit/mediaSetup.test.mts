/**
 * Unit tests for ensureMediaDirs (#222)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { ensureMediaDirs, REQUIRED_SUBDIRS } from '../../src/utils/mediaSetup.mts';

describe('ensureMediaDirs (#222)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tealus-media-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('全 REQUIRED_SUBDIRS を作成する', () => {
    ensureMediaDirs(tmpRoot);
    for (const subdir of REQUIRED_SUBDIRS) {
      const dir = path.join(tmpRoot, subdir);
      expect(fs.existsSync(dir)).toBe(true);
      expect(fs.statSync(dir).isDirectory()).toBe(true);
    }
  });

  it('REQUIRED_SUBDIRS に必要な 8 dir が含まれる', () => {
    expect(REQUIRED_SUBDIRS).toEqual(
      expect.arrayContaining([
        'avatars',
        'icons',
        'images',
        'videos',
        'files',
        'voices',
        'stamps',
        'thumbnails',
      ])
    );
  });

  it('既存 dir があっても idempotent (上書きしない)', () => {
    const imagesDir = path.join(tmpRoot, 'images');
    fs.mkdirSync(imagesDir);
    const sentinelFile = path.join(imagesDir, 'existing.txt');
    fs.writeFileSync(sentinelFile, 'should not be deleted');

    ensureMediaDirs(tmpRoot);

    expect(fs.existsSync(sentinelFile)).toBe(true);
    expect(fs.readFileSync(sentinelFile, 'utf8')).toBe('should not be deleted');
  });

  it('mediaRoot 自体が存在しなくても recursive で作成', () => {
    const nestedRoot = path.join(tmpRoot, 'a', 'b', 'media');
    expect(fs.existsSync(nestedRoot)).toBe(false);

    ensureMediaDirs(nestedRoot);

    expect(fs.existsSync(nestedRoot)).toBe(true);
    for (const subdir of REQUIRED_SUBDIRS) {
      expect(fs.existsSync(path.join(nestedRoot, subdir))).toBe(true);
    }
  });

  it('複数回呼び出しても error にならない (idempotent)', () => {
    expect(() => {
      ensureMediaDirs(tmpRoot);
      ensureMediaDirs(tmpRoot);
      ensureMediaDirs(tmpRoot);
    }).not.toThrow();
  });
});
