/**
 * Chat API route using Vercel AI SDK.
 * Provides streaming chat responses for Helm chart assistance.
 *
 * Note: Uses createUIMessageStreamResponse for compatibility with
 * the AI SDK v5 useChat hook and DefaultChatTransport.
 */

import { streamText, createUIMessageStreamResponse } from 'ai';
import { getChatModel } from '@/lib/llm/model-provider';
import { chatOnlySystemPrompt } from '@/lib/llm/prompts';

export const maxDuration = 60; // Allow up to 60 seconds for streaming responses

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // AI SDK v5 sends messages in a different format
    // The DefaultChatTransport sends { messages: [...] } with UIMessage format
    const messages = body.messages;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: 'Messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Convert UIMessage format to CoreMessage format for streamText
    const coreMessages = messages.map((msg: { role: string; parts?: Array<{ type: string; text?: string }>; content?: string }) => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.parts
        ? msg.parts.filter((p: { type: string }) => p.type === 'text').map((p: { text?: string }) => p.text).join('')
        : msg.content || '',
    }));

    const result = streamText({
      model: getChatModel(),
      system: chatOnlySystemPrompt,
      messages: coreMessages,
    });

    // Use createUIMessageStreamResponse for AI SDK v5 useChat compatibility
    return createUIMessageStreamResponse({
      status: 200,
      stream: result.toUIMessageStream(),
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
