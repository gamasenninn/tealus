import { logger } from '../../utils/logger.mts';

/** OpenAI Images API のレスポンス (外部 JSON 境界) */
interface OpenAIImageResponse {
  error?: { message?: string };
  data: { b64_json?: string; url?: string }[];
}

/**
 * OpenAI image provider (GPT-Image-1 / DALL-E 3)
 */
class OpenAIImageProvider {
  apiKey: string | undefined;
  model: string;

  constructor(apiKey: string | undefined, model?: string) {
    this.apiKey = apiKey;
    this.model = model || 'gpt-image-1';
  }

  async generate(prompt: string): Promise<Buffer> {
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

    const data = await res.json() as OpenAIImageResponse;
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
export function createImageProvider(provider?: string): OpenAIImageProvider {
  const apiKey = process.env.STAMP_IMAGE_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.STAMP_IMAGE_MODEL;

  switch (provider || 'openai') {
    case 'openai':
      return new OpenAIImageProvider(apiKey, model);
    default:
      throw new Error(`Unknown image provider: ${provider}`);
  }
}
