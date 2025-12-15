/**
 * Mock LLM provider for testing without API calls.
 * Uses Vercel AI SDK's MockLanguageModelV1 for realistic streaming behavior.
 */

import { MockLanguageModelV1 } from 'ai/test';

/**
 * Create a mock model that returns predefined responses.
 * Useful for testing chat flows without making real API calls.
 *
 * @param responses - Array of responses to return in sequence
 * @returns A mock language model compatible with Vercel AI SDK
 */
export function createMockModel(responses: string[]) {
  let callIndex = 0;
  return new MockLanguageModelV1({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          const response = responses[callIndex++] || 'Mock response';
          controller.enqueue({ type: 'text-delta', textDelta: response });
          controller.enqueue({ type: 'finish', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 20 } });
          controller.close();
        },
      }),
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  });
}

/**
 * Check if mock responses should be used instead of real API calls.
 * Controlled by MOCK_LLM_RESPONSES environment variable.
 */
export function shouldUseMock(): boolean {
  return process.env.MOCK_LLM_RESPONSES === 'true';
}
