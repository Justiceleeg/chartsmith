/**
 * Execute plan API route using Vercel AI SDK with tool calling.
 * Executes a plan by using the text_editor tool to create/modify files.
 * Ported from pkg/llm/execute-action.go
 *
 * This route:
 * 1. Receives a plan with action items (create/update/delete files)
 * 2. Uses the LLM with text_editor tool to execute each action
 * 3. Streams progress and tool calls back to the client
 */

import { streamText, createUIMessageStreamResponse, stepCountIs } from 'ai';
import { getChatModel } from '@/lib/llm/model-provider';
import { executePlanSystemPrompt } from '@/lib/llm/prompts';
import {
  createTextEditorTool,
  InMemoryFileProvider,
  ToolResult,
} from '@/lib/llm/tools';

export const maxDuration = 300; // Plan execution can take up to 5 minutes

interface ActionPlan {
  action: 'create' | 'update' | 'delete';
  path: string;
  description?: string;
}

interface ExecuteRequest {
  plan: {
    id: string;
    description: string;
    title?: string;
  };
  action: ActionPlan;
  workspaceId: string;
  currentContent?: string;
}

/**
 * Build workflow instructions for the LLM based on the action type.
 * Ported from pkg/llm/execute-action.go ExecuteAction
 */
function buildWorkflowInstructions(action: ActionPlan): string {
  const baseInstructions = `
Important workflow instructions:
1. For ANY file operation, ALWAYS use "view" command first to check if a file exists and view its contents.
2. Only after viewing, decide whether to use "create" (if file doesn't exist) or "str_replace" (if file exists).
3. Never use "create" on an existing file.
4. When using str_replace, use small, precise replacements. Do not try to replace large blocks of text.
5. After making changes, you may use view again to verify your changes.
`;

  if (action.action === 'create') {
    return (
      baseInstructions +
      `\nCreate the file at ${action.path}. The file should follow Helm chart best practices.`
    );
  } else if (action.action === 'update') {
    return (
      baseInstructions +
      `\nThe file at ${action.path} needs to be updated according to the plan. Make minimal, targeted changes.`
    );
  } else if (action.action === 'delete') {
    return (
      baseInstructions +
      `\nThe file at ${action.path} should be deleted. Confirm the deletion is appropriate.`
    );
  }

  return baseInstructions;
}

export async function POST(req: Request) {
  try {
    const body: ExecuteRequest = await req.json();
    const { plan, action, currentContent = '' } = body;

    if (!plan || !action) {
      return new Response(
        JSON.stringify({ error: 'Plan and action are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create a file provider with the current file content
    const initialFiles: Record<string, string> = {};
    if (currentContent && action.path) {
      initialFiles[action.path] = currentContent;
    }
    const fileProvider = new InMemoryFileProvider(initialFiles);

    // Create the text editor tool with our file provider
    const textEditorTool = createTextEditorTool(fileProvider);

    // Build messages for the LLM
    const workflowInstructions = buildWorkflowInstructions(action);

    const messages: Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
    }> = [
      {
        role: 'assistant',
        content: `Plan: ${plan.description}`,
      },
      {
        role: 'user',
        content: workflowInstructions,
      },
    ];

    // Add description context if available
    if (action.description) {
      messages.push({
        role: 'user',
        content: `Additional context for this file: ${action.description}`,
      });
    }

    const result = streamText({
      model: getChatModel(),
      system: executePlanSystemPrompt,
      messages,
      tools: {
        text_editor: textEditorTool,
      },
      // Use stopWhen to allow multiple tool calls (up to 50 steps)
      stopWhen: stepCountIs(50),
      onStepFinish: async ({ toolResults }) => {
        // Log tool results for debugging
        if (toolResults && toolResults.length > 0) {
          for (const toolResult of toolResults) {
            // Access the output property instead of result
            const output = 'output' in toolResult ? toolResult.output as ToolResult : null;
            console.log(
              `[Execute] Tool ${toolResult.toolName} completed:`,
              output?.message || 'unknown'
            );
          }
        }
      },
    });

    // Use createUIMessageStreamResponse for AI SDK v5 useChat compatibility
    return createUIMessageStreamResponse({
      status: 200,
      stream: result.toUIMessageStream(),
    });
  } catch (error) {
    console.error('Execute API error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
