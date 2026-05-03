const fs = require('fs');
const path = require('path');

const REQUIRED_SUBDIRS = [
  'avatars',
  'icons',
  'images',
  'videos',
  'files',
  'voices',
  'stamps',
  'thumbnails',
];

function ensureMediaDirs(mediaRoot) {
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

module.exports = { ensureMediaDirs, REQUIRED_SUBDIRS };
