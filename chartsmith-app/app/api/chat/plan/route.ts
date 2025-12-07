/**
 * Plan generation API route using Vercel AI SDK.
 * Creates or updates Helm chart plans based on user requirements.
 * Ported from pkg/llm/plan.go and pkg/llm/initial-plan.go
 *
 * Note: Uses createUIMessageStreamResponse for compatibility with
 * the AI SDK v5 useChat hook and DefaultChatTransport.
 */

import { streamText, createUIMessageStreamResponse } from 'ai';
import { getChatModel } from '@/lib/llm/model-provider';
import {
  detailedPlanSystemPrompt,
  initialPlanInstructions,
  updatePlanInstructions,
} from '@/lib/llm/prompts';

export const maxDuration = 120; // Plan generation can take longer

interface RelevantFile {
  filePath: string;
  content: string;
}

interface PlanRequest {
  messages: Array<{
    role: string;
    parts?: Array<{ type: string; text?: string }>;
    content?: string;
  }>;
  workspaceId?: string;
  chartStructure?: string;
  relevantFiles?: RelevantFile[];
  isUpdate?: boolean;
}

/**
 * Build the plan generation prompt with chart context.
 * Mirrors the logic from pkg/llm/plan.go CreatePlan
 */
function buildPlanPrompt(
  chartStructure: string,
  relevantFiles: RelevantFile[],
  isUpdate: boolean
): string {
  const parts: string[] = [];

  // Add chart structure context
  if (chartStructure) {
    parts.push(`Chart structure: ${chartStructure}`);
  }

  // For updates, include relevant file contents
  if (isUpdate && relevantFiles.length > 0) {
    for (const file of relevantFiles) {
      parts.push(`File: ${file.filePath}, Content: ${file.content}`);
    }
  }

  return parts.join('\n\n');
}

export async function POST(req: Request) {
  try {
    const body: PlanRequest = await req.json();
    const {
      messages,
      chartStructure = '',
      relevantFiles = [],
      isUpdate = false,
    } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: 'Messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Use detailedPlanSystemPrompt which includes XML output instructions
    const systemPrompt = detailedPlanSystemPrompt;
    const instructions = isUpdate ? updatePlanInstructions : initialPlanInstructions;

    // Convert UIMessage format to CoreMessage format for streamText
    const coreMessages = messages.map(
      (msg: {
        role: string;
        parts?: Array<{ type: string; text?: string }>;
        content?: string;
      }) => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.parts
          ? msg.parts
              .filter((p: { type: string }) => p.type === 'text')
              .map((p: { text?: string }) => p.text)
              .join('')
          : msg.content || '',
      })
    );

    // Build the message chain as in the Go implementation
    // Start with instructions as an assistant message
    // Use explicit type to allow mixed user/assistant roles
    const fullMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
      { role: 'assistant', content: instructions },
    ];

    // Add chart context as user message
    const contextPrompt = buildPlanPrompt(chartStructure, relevantFiles, isUpdate);
    if (contextPrompt) {
      fullMessages.push({ role: 'user', content: contextPrompt });
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

    const result = streamText({
      model: getChatModel(),
      system: systemPrompt,
      messages: fullMessages,
      maxOutputTokens: 8192,
    });

    // Use createUIMessageStreamResponse for AI SDK v5 useChat compatibility
    return createUIMessageStreamResponse({
      status: 200,
      stream: result.toUIMessageStream(),
    });
  } catch (error) {
    console.error('Plan API error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
