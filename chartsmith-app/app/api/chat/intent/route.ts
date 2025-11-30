/**
 * Intent classification API route using Vercel AI SDK with Groq.
 * Classifies user messages to determine routing (plan, conversational, render, etc.).
 * Ported from pkg/llm/intent.go
 */

import { generateText } from 'ai';
import { getIntentModel } from '@/lib/llm/model-provider';
import { commonSystemPrompt, endUserSystemPrompt } from '@/lib/llm/prompts';
import type { Intent, ChatMessageFromPersona } from '@/lib/llm/types';

export const maxDuration = 30; // Intent classification should be fast

interface IntentRequest {
  message: string;
  isInitialPrompt?: boolean;
  persona?: ChatMessageFromPersona;
}

/**
 * Build the intent classification prompt based on persona.
 * Mirrors the logic from pkg/llm/intent.go GetChatMessageIntent
 */
function buildIntentPrompt(message: string, persona: ChatMessageFromPersona): string {
  const baseSystemPrompt =
    persona === 'operator' ? endUserSystemPrompt : commonSystemPrompt;

  if (persona === 'operator') {
    return `${baseSystemPrompt}

Given this, my request is:

${message}

Determine if the prompt is a question, a request for information, or a request to perform an action.

You will respond with a JSON object containing the following fields:
- isConversational: true if the prompt is a question or request for information, false otherwise
- isPlan: true if the prompt is a request to perform an update to the chart templates or files, false otherwise
- isOffTopic: true if the prompt is off topic, false otherwise
- isChartOperator: true if it's possible to answer this question as if it was asked by the chart operator and can be completed without making any changes to the chart templates or files, false if otherwise

Important: Do not respond with anything other than the JSON object.`;
  }

  if (persona === 'developer') {
    return `${baseSystemPrompt}

Given this, my request is:

${message}

Determine if the prompt is a question, a request for information, or a request to perform an action.

You will respond with a JSON object containing the following fields:
- isConversational: true if the prompt is a question or request for information, false otherwise
- isPlan: true if the prompt is a request to perform an update to the chart templates or files, false otherwise
- isOffTopic: true if the prompt is off topic, false otherwise
- isChartDeveloper: true if it's possible to answer this question as if it was asked by the chart developer, false if otherwise
- isProceed: true if the prompt is a clear request to execute previous instructions with no requested changes, false otherwise
- isRender: true if the prompt is a request to render or test or validate the chart, false otherwise

Important: Do not respond with anything other than the JSON object.`;
  }

  // Default: auto persona
  return `${baseSystemPrompt}

Given this, my request is:

${message}

Determine if the prompt is a question, a request for information, or a request to perform an action.

You will respond with a JSON object containing the following fields:
- isConversational: true if the prompt is a question or request for information, false otherwise
- isPlan: true if the prompt is a request to perform an update to the chart templates or files, false otherwise
- isOffTopic: true if the prompt is off topic, false otherwise
- isChartDeveloper: true if the question is related to planning a change to the chart, false otherwise
- isChartOperator: true if the question is about how to use the Helm chart in a Kubernetes cluster, false otherwise
- isProceed: true if the prompt is a clear request to execute previous instructions with no requested changes, false otherwise
- isRender: true if the prompt is a request to render or test or validate the chart, false otherwise

Important: Do not respond with anything other than the JSON object.`;
}

/**
 * Parse the LLM response into an Intent object.
 * Handles partial responses by defaulting missing fields to false.
 * Strips markdown code blocks if present (e.g., ```json...```)
 */
function parseIntentResponse(text: string): Intent {
  const defaultIntent: Intent = {
    isConversational: false,
    isPlan: false,
    isOffTopic: false,
    isChartDeveloper: false,
    isChartOperator: false,
    isProceed: false,
    isRender: false,
  };

  try {
    // Strip markdown code blocks if present (Groq sometimes wraps JSON in ```json...```)
    let cleanedText = text.trim();
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(cleanedText);
    return {
      isConversational: parsed.isConversational === true,
      isPlan: parsed.isPlan === true,
      isOffTopic: parsed.isOffTopic === true,
      isChartDeveloper: parsed.isChartDeveloper === true,
      isChartOperator: parsed.isChartOperator === true,
      isProceed: parsed.isProceed === true,
      isRender: parsed.isRender === true,
    };
  } catch {
    console.error('Failed to parse intent response:', text);
    return defaultIntent;
  }
}

export async function POST(req: Request) {
  try {
    const body: IntentRequest = await req.json();
    const { message, isInitialPrompt = false, persona = 'auto' } = body;

    if (!message || typeof message !== 'string') {
      return Response.json(
        { error: 'Message is required and must be a string' },
        { status: 400 }
      );
    }

    const prompt = buildIntentPrompt(message, persona);

    const result = await generateText({
      model: getIntentModel(),
      prompt,
    });

    let intent = parseIntentResponse(result.text);

    // For initial prompts, we always assume it's a plan (but still check for off-topic)
    // This matches the Go behavior in pkg/llm/intent.go
    if (isInitialPrompt) {
      intent = {
        ...intent,
        isPlan: true,
        isProceed: false,
      };
    }

    return Response.json(intent);
  } catch (error) {
    console.error('Intent classification error:', error);
    return Response.json(
      { error: 'Failed to classify intent' },
      { status: 500 }
    );
  }
}
