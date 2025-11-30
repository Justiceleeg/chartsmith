/**
 * Mock LLM provider for testing without making real API calls.
 * Uses Vercel AI SDK's MockLanguageModelV2 for consistent testing behavior.
 */

import { simulateReadableStream } from 'ai';
import { MockLanguageModelV2 } from 'ai/test';
import type { LanguageModelV2StreamPart } from '@ai-sdk/provider';

/**
 * Creates a mock language model that returns predefined responses.
 * Useful for testing streaming behavior without API calls.
 *
 * @param responses - Array of responses to return in sequence
 * @returns A MockLanguageModelV2 instance
 */
export function createMockModel(responses: string[]) {
  let callIndex = 0;

  return new MockLanguageModelV2({
    doStream: async () => {
      const response = responses[callIndex++] || 'Mock response';
      const textId = `text-${Date.now()}`;

      const chunks: LanguageModelV2StreamPart[] = [
        { type: 'text-start', id: textId },
        { type: 'text-delta', id: textId, delta: response },
        { type: 'text-end', id: textId },
        {
          type: 'finish',
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        },
      ];

      return {
        stream: simulateReadableStream({ chunks }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    doGenerate: async () => {
      const response = responses[callIndex++] || 'Mock response';
      return {
        content: [{ type: 'text' as const, text: response }],
        finishReason: 'stop' as const,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        rawCall: { rawPrompt: null, rawSettings: {} },
        warnings: [],
      };
    },
  });
}

/**
 * Check if mock responses should be used instead of real API calls.
 * Controlled by MOCK_LLM_RESPONSES environment variable.
 */
export const shouldUseMock = () => process.env.MOCK_LLM_RESPONSES === 'true';
