/**
 * エージェント設定マネージャー
 * config/settings.json を読み込んで提供
 */
const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');

const SETTINGS_PATH = path.join(__dirname, '..', '..', 'config', 'settings.json');

let settings = {};

/**
 * settings.json を読み込む
 */
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      logger.info(`Settings loaded: ${Object.keys(settings).length} keys`);
    } else {
      settings = {};
      logger.info('No settings.json found, using defaults');
    }
  } catch (err) {
    logger.error(`Failed to load settings: ${err.message}`);
    settings = {};
  }
}

/**
 * 設定値を取得（未設定ならデフォルト値）
 */
function getSetting(key, defaultValue) {
  const value = settings[key];
  if (value === undefined || value === null || value === '') return defaultValue;
  return value;
}

/**
 * 全設定を取得
 */
function getAllSettings() {
  return { ...settings };
}

/**
 * 設定を保存
 */
function saveSettings(newSettings) {
  settings = { ...newSettings };
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
  logger.info('Settings saved');
}

module.exports = { loadSettings, getSetting, getAllSettings, saveSettings };
