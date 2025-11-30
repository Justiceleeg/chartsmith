/**
 * Chat API route using Vercel AI SDK.
 * Provides streaming chat responses for Helm chart assistance.
 */

import { streamText } from 'ai';
import { getChatModel } from '@/lib/llm/model-provider';
import { chatOnlySystemPrompt } from '@/lib/llm/prompts';

export const maxDuration = 60; // Allow up to 60 seconds for streaming responses

export async function POST(req: Request) {
  try {
    const { messages, workspaceId } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: 'Messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const result = streamText({
      model: getChatModel(),
      system: chatOnlySystemPrompt,
      messages,
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
