/**
 * Mock LLM provider for testing without making real API calls.
 * Uses a simple mock implementation that doesn't require test dependencies.
 *
 * Note: This file uses a custom mock implementation instead of ai/test
 * to avoid pulling in test dependencies (msw, vitest) into the production build.
 */

import type { LanguageModelV2 } from '@ai-sdk/provider';

/**
 * Check if mock responses should be used instead of real API calls.
 * Controlled by MOCK_LLM_RESPONSES environment variable.
 */
export const shouldUseMock = () => process.env.MOCK_LLM_RESPONSES === 'true';

/**
 * Creates a mock language model that returns predefined responses.
 * Useful for testing streaming behavior without API calls.
 *
 * @param responses - Array of responses to return in sequence
 * @returns A mock LanguageModelV2 instance
 */
export function createMockModel(responses: string[]): LanguageModelV2 {
  let callIndex = 0;

  return {
    specificationVersion: 'v2' as const,
    provider: 'mock',
    modelId: 'mock-model',
    supportedUrls: {},

    doGenerate: async () => {
      const response = responses[callIndex++] || 'Mock response';
      return {
        content: [{ type: 'text' as const, text: response }],
        finishReason: 'stop' as const,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        rawCall: { rawPrompt: null, rawSettings: {} },
        warnings: [],
        response: {
          id: `mock-${Date.now()}`,
          timestamp: new Date(),
          modelId: 'mock-model',
          headers: {},
        },
      };
    },

    doStream: async () => {
      const response = responses[callIndex++] || 'Mock response';
      const textId = `text-${Date.now()}`;

      // Create a simple readable stream that emits the response
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: textId });
          controller.enqueue({ type: 'text-delta', id: textId, delta: response });
          controller.enqueue({ type: 'text-end', id: textId });
          controller.enqueue({
            type: 'finish',
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          });
          controller.close();
        },
      });

      return {
        stream,
        rawCall: { rawPrompt: null, rawSettings: {} },
        warnings: [],
        response: {
          id: `mock-${Date.now()}`,
          timestamp: new Date(),
          modelId: 'mock-model',
          headers: {},
        },
      };
    },
  };
}
