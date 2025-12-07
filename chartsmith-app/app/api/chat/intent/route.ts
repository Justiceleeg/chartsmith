/**
 * Intent classification API route using Vercel AI SDK with Groq.
 * Classifies user messages to determine routing (plan, conversational, render, etc.).
 * Ported from pkg/llm/intent.go
 */

import { classifyIntent } from '@/lib/llm/intent';
import type { ChatMessageFromPersona } from '@/lib/llm/types';

export const maxDuration = 30; // Intent classification should be fast

interface IntentRequest {
  message: string;
  isInitialPrompt?: boolean;
  persona?: ChatMessageFromPersona;
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

    const intent = await classifyIntent(message, isInitialPrompt, persona);
    return Response.json(intent);
  } catch (error) {
    console.error('Intent classification error:', error);
    return Response.json(
      { error: 'Failed to classify intent' },
      { status: 500 }
    );
  }
}
