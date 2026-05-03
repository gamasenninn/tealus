const logger = require('../../utils/logger');

/**
 * OpenAI image provider (GPT-Image-1 / DALL-E 3)
 */
class OpenAIImageProvider {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model = model || 'gpt-image-1';
  }

  async generate(prompt) {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        n: 1,
        size: '1536x1024',
        quality: 'high',
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || 'Image generation failed');
    }

    // Return base64 or URL depending on response format
    const image = data.data[0];
    if (image.b64_json) {
      return Buffer.from(image.b64_json, 'base64');
    } else if (image.url) {
      const imgRes = await fetch(image.url);
      const arrayBuf = await imgRes.arrayBuffer();
      return Buffer.from(arrayBuf);
    }

    throw new Error('No image data in response');
  }
}

/**
 * Factory function
 */
function createImageProvider(provider) {
  const apiKey = process.env.STAMP_IMAGE_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.STAMP_IMAGE_MODEL;

  switch (provider || 'openai') {
    case 'openai':
      return new OpenAIImageProvider(apiKey, model);
    default:
      throw new Error(`Unknown image provider: ${provider}`);
  }
}

module.exports = { createImageProvider };
