import fs from 'node:fs';
import path from 'node:path';

export const REQUIRED_SUBDIRS = [
  'avatars',
  'icons',
  'images',
  'videos',
  'files',
  'voices',
  'stamps',
  'thumbnails',
];

export function ensureMediaDirs(mediaRoot: string): void {
  if (!fs.existsSync(mediaRoot)) {
    fs.mkdirSync(mediaRoot, { recursive: true });
  }
  for (const subdir of REQUIRED_SUBDIRS) {
    const dir = path.join(mediaRoot, subdir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
