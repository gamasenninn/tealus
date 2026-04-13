/**
 * TealusSession
 * OpenAI Agents SDK の Session インターフェースを実装
 * messagesテーブルをバックエンドに使い、プロセス再起動でも履歴を保持
 */
const botApi = require('../lib/botApi');
const config = require('../config');
const logger = require('../lib/logger');

class TealusSession {
  constructor(roomId) {
    this.roomId = roomId;
    this.pendingItems = [];
    this.cachedItems = null;
  }

  async getSessionId() {
    return `tealus-room-${this.roomId}`;
  }

  /**
   * 会話履歴を取得してSDK形式に変換
   */
  async getItems() {
    // 初回はDBから取得、以降はキャッシュ + pending
    if (!this.cachedItems) {
      this.cachedItems = await this._fetchFromDb();
    }
    return [...this.cachedItems, ...this.pendingItems];
  }

  /**
   * Bot APIから会話履歴を取得してAgentInputItem形式に変換
   */
  async _fetchFromDb() {
    try {
      const historyData = await botApi.getMessages(this.roomId, config.LIGHT_CONTEXT_MESSAGES || 20);
      const messages = (historyData.messages || []).reverse();
      const botUserId = botApi.getBotUserId();

      const items = [];
      for (const msg of messages) {
        const text = msg.content
          || msg.transcription?.formatted_text
          || msg.transcription?.raw_text;
        if (!text) continue;

        const isBot = msg.sender_id === botUserId;
        if (isBot) {
          items.push({ role: 'assistant', content: text });
        } else {
          items.push({ role: 'user', content: `${msg.sender_display_name}: ${text}` });
        }
      }
      return items;
    } catch (err) {
      logger.error(`TealusSession fetch error: ${err.message}`);
      return [];
    }
  }

  async addItems(items) {
    this.pendingItems.push(...items);
  }

  async popItem() {
    return this.pendingItems.pop();
  }

  async clearSession() {
    this.pendingItems = [];
    this.cachedItems = null;
  }
}

module.exports = { TealusSession };
