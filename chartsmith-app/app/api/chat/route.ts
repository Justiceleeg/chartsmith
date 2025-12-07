/**
 * Chat API route using Vercel AI SDK.
 * Provides streaming chat responses for Helm chart assistance.
 * Routes to plan or conversational based on intent classification.
 *
 * Note: Uses createUIMessageStreamResponse for compatibility with
 * the AI SDK v5 useChat hook and DefaultChatTransport.
 */

import { streamText, createUIMessageStreamResponse } from 'ai';
import { getChatModel } from '@/lib/llm/model-provider';
import {
  chatOnlySystemPrompt,
  detailedPlanSystemPrompt,
  initialPlanInstructions,
  updatePlanInstructions,
} from '@/lib/llm/prompts';
import { classifyIntent } from '@/lib/llm/intent';
import type { ChatMessageFromPersona } from '@/lib/llm/types';

export const maxDuration = 120; // Allow up to 120 seconds for streaming responses

interface UIMessage {
  role: string;
  parts?: Array<{ type: string; text?: string }>;
  content?: string;
}

interface ChatRequest {
  messages: UIMessage[];
  workspaceId?: string;
  chartStructure?: string;
  relevantFiles?: Array<{ filePath: string; content: string }>;
  isUpdate?: boolean;
  isInitialPrompt?: boolean;
  persona?: ChatMessageFromPersona;
  skipIntentClassification?: boolean;
}

/**
 * Convert UIMessage format to CoreMessage format for streamText
 */
function convertToCoreMessages(messages: UIMessage[]) {
  return messages.map((msg) => ({
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.parts
      ? msg.parts
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('')
      : msg.content || '',
  }));
}

/**
 * Get the last user message content for intent classification
 */
function getLastUserMessage(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      if (messages[i].parts) {
        return messages[i]
          .parts!.filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('');
      }
      return messages[i].content || '';
    }
  }
  return '';
}


/**
 * Handle conversational chat request (Q&A about Helm/K8s)
 */
function handleConversationalRequest(coreMessages: ReturnType<typeof convertToCoreMessages>) {
  return streamText({
    model: getChatModel(),
    system: chatOnlySystemPrompt,
    messages: coreMessages,
  });
}

/**
 * Handle plan generation request (create/update Helm chart)
 */
function handlePlanRequest(
  coreMessages: ReturnType<typeof convertToCoreMessages>,
  chartStructure: string,
  relevantFiles: Array<{ filePath: string; content: string }>,
  isUpdate: boolean
) {
  // Use detailedPlanSystemPrompt which includes XML output instructions
  const systemPrompt = detailedPlanSystemPrompt;
  const instructions = isUpdate ? updatePlanInstructions : initialPlanInstructions;

  // Build the message chain as in the Go implementation
  // Use explicit type to allow mixed user/assistant roles
  const fullMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
    { role: 'assistant', content: instructions },
  ];

  // Add chart context as user message
  if (chartStructure) {
    fullMessages.push({ role: 'user', content: `Chart structure: ${chartStructure}` });
  }

  // For updates, include relevant file contents
  if (isUpdate && relevantFiles.length > 0) {
    for (const file of relevantFiles) {
      fullMessages.push({
        role: 'user',
        content: `File: ${file.filePath}, Content: ${file.content}`,
      });
    }
  }

  // Add the conversation messages
  fullMessages.push(...coreMessages);

  // Add final instruction to describe the plan with XML format
  const verb = isUpdate ? 'edit' : 'create';
  fullMessages.push({
    role: 'user',
    content: `Describe the plan to ${verb} a helm chart based on the previous discussion.

Output your plan as XML in this exact format:
<chartsmithArtifactPlan title="Short descriptive title for the chart">
  <chartsmithActionPlan type="file" action="create" path="Chart.yaml" />
  <chartsmithActionPlan type="file" action="create" path="values.yaml" />
  <!-- more files as needed -->
</chartsmithArtifactPlan>

Do not write code, just list the files and actions needed. The title attribute is required.`,
  });

  return streamText({
    model: getChatModel(),
    system: systemPrompt,
    messages: fullMessages,
    maxOutputTokens: 8192,
  });
}

export async function POST(req: Request) {
  try {
    const body: ChatRequest = await req.json();
    const {
      messages,
      chartStructure = '',
      relevantFiles = [],
      isUpdate = false,
      isInitialPrompt = false,
      persona = 'auto',
      skipIntentClassification = false,
    } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: 'Messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const coreMessages = convertToCoreMessages(messages);
    const lastUserMessage = getLastUserMessage(messages);

    // Only use isInitialPrompt if explicitly passed by the frontend
    // This should only be true when starting a new chart creation flow,
    // not just because it's the first message in a conversation
    const isActuallyInitialPrompt = isInitialPrompt;

    // Determine intent - either from classification or explicit flags
    let shouldUsePlanRoute = false;

    if (!skipIntentClassification && lastUserMessage) {
      const intent = await classifyIntent(lastUserMessage, isActuallyInitialPrompt, persona);
      shouldUsePlanRoute = intent.isPlan;
    }

    // Route to appropriate handler based on intent
    let result;
    if (shouldUsePlanRoute) {
      result = handlePlanRequest(coreMessages, chartStructure, relevantFiles, isUpdate);
    } else {
      result = handleConversationalRequest(coreMessages);
    }

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
