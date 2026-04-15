const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(__dirname, '../../../media');

// File size limits (bytes)
const SIZE_LIMITS = {
  image: 10 * 1024 * 1024,    // 10MB
  video: 1024 * 1024 * 1024,  // 1GB
  default: 100 * 1024 * 1024, // 100MB
};

// Determine subdirectory based on MIME type
function getSubdir(mimetype) {
  if (mimetype.startsWith('image/')) return 'images';
  if (mimetype.startsWith('video/')) return 'videos';
  return 'files';
}

// Determine message type from MIME type
function getMessageType(mimetype) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  return 'file';
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subdir = getSubdir(file.mimetype);
    cb(null, path.join(MEDIA_ROOT, subdir));
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-random.ext
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: SIZE_LIMITS.video, // Use largest limit; fine-tune per type if needed
  },
});

module.exports = { upload, getSubdir, getMessageType, MEDIA_ROOT, SIZE_LIMITS };
