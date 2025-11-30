"use server";

import { Session } from "@/lib/types/session";
import { ChatMessageFromPersona, CreateChatMessageParams, createWorkspace, createWorkspaceWithoutChat } from "../workspace";
import { Workspace } from "@/lib/types/workspace";
import { logger } from "@/lib/utils/logger";

// Check if we should use Vercel AI SDK (server-side check)
const useVercelAISDK = process.env.NEXT_PUBLIC_USE_VERCEL_AI_SDK === "true";

export async function createWorkspaceFromPromptAction(session: Session, prompt: string): Promise<Workspace> {
  logger.info("Creating workspace from prompt", { prompt, userId: session.user.id, useVercelAISDK });

  if (useVercelAISDK) {
    // When using AI SDK, create workspace without triggering Go backend
    // The frontend will handle the chat via the AI SDK
    const w = await createWorkspaceWithoutChat("prompt", session.user.id, prompt);
    return w;
  }

  // Original flow: create workspace and trigger Go backend for chat processing
  const createChartMessageParams: CreateChatMessageParams = {
    prompt: prompt,
    messageFromPersona: ChatMessageFromPersona.AUTO,
  }
  const w = await createWorkspace("prompt", session.user.id, createChartMessageParams);

  return w;
}
