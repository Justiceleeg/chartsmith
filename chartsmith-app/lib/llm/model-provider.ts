/**
 * Model provider for LLM operations.
 * Provides access to different AI models with automatic mock support for testing.
 */

import { anthropic } from '@ai-sdk/anthropic';
import { groq } from '@ai-sdk/groq';
import { createMockModel, shouldUseMock } from './mock-provider';

/**
 * Get the chat model for conversational and plan generation tasks.
 * Uses Claude Sonnet 4 for production and a mock model for testing.
 */
export function getChatModel() {
  if (shouldUseMock()) {
    return createMockModel([
      'This is a mock response for testing. I can help you with Helm charts and Kubernetes deployments.',
    ]);
  }
  return anthropic('claude-sonnet-4-20250514');
}

/**
 * Get the intent classification model.
 * Uses Groq's Llama 3.3 70B for fast, cost-effective intent classification.
 */
export function getIntentModel() {
  if (shouldUseMock()) {
    return createMockModel(['{"isConversational": true, "isPlan": false, "isOffTopic": false}']);
  }
  return groq('llama-3.3-70b-versatile');
}
