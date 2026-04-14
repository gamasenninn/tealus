/**
 * Agent Server API クライアント
 * agent-server の設定ファイル読み書き用
 */
class AgentApiClient {
  constructor() {
    this.baseUrl = '/agent-api';
  }

  async request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`${this.baseUrl}${path}`, options);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  getSettings() {
    return this.request('GET', '/config/settings');
  }

  updateSettings(settings) {
    return this.request('PUT', '/config/settings', { settings });
  }

  getMcpConfig() {
    return this.request('GET', '/config/mcp');
  }

  updateMcpConfig(mcpConfig) {
    return this.request('PUT', '/config/mcp', { mcpConfig });
  }

  getEnv() {
    return this.request('GET', '/config/env');
  }
}

export const agentApi = new AgentApiClient();
