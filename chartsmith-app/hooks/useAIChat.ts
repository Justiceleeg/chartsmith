"use client";

/**
 * AI Chat hook using Vercel AI SDK v5.
 * Provides streaming chat functionality with database persistence.
 *
 * This hook wraps the Vercel AI SDK's useChat hook and adds:
 * - Input state management (useChat v5 doesn't include this)
 * - Database persistence for messages after completion
 * - Integration with workspace context
 * - Conversion of AI SDK message format to app Message format
 * - Plan parsing from streaming responses
 */

import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useCallback, useEffect, useMemo, useRef, ChangeEvent } from "react";
import { useAtom } from "jotai";
import { messagesAtom, plansAtom } from "@/atoms/workspace";
import { Message } from "@/components/types";
import { Session } from "@/lib/types/session";
import { Parser } from "@/lib/llm/parser";
import { createPlanAction } from "@/lib/workspace/actions/create-plan";
import { updatePlanWithActionsAction } from "@/lib/workspace/actions/update-plan-status";

interface UseAIChatOptions {
  workspaceId: string;
  session?: Session;
}

/**
 * Extract text content from a UIMessage's parts array.
 * AI SDK v5 uses a parts-based structure instead of a simple content string.
 */
function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function useAIChat({ workspaceId, session }: UseAIChatOptions) {
  const [existingMessages, setMessages] = useAtom(messagesAtom);
  const [, setPlans] = useAtom(plansAtom);

  // Input state management (v5 doesn't include this in useChat)
  const [input, setInput] = useState("");

  // Track if we've already auto-submitted to prevent duplicate submissions
  const hasAutoSubmitted = useRef(false);

  // Track if we've already created a plan for this response
  const hasCreatedPlan = useRef(false);

  // Store the original database message ID before AI SDK replaces it
  const pendingMessageId = useRef<string | null>(null);

  // Store the most recently created plan ID (AI SDK generates unstable message IDs)
  const lastCreatedPlanId = useRef<string | null>(null);

  // Counter to force re-sync when plans are created (refs don't trigger re-renders)
  const [planCreatedCount, setPlanCreatedCount] = useState(0);

  // Create custom transport with our API endpoint and auth
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: session
          ? { Authorization: `Bearer ${session.id}` }
          : undefined,
        body: { workspaceId },
      }),
    [workspaceId, session]
  );

  const chat = useChat({
    transport,
    onFinish: async ({ message }: { message: UIMessage }) => {
      const responseText = getMessageText(message);
      console.log("[useAIChat] Response complete:", responseText.substring(0, 100) + "...");

      // Check if response contains a plan XML
      if (responseText.includes("<chartsmithArtifactPlan") && !hasCreatedPlan.current) {
        hasCreatedPlan.current = true;
        console.log("[useAIChat] Plan XML detected, parsing...");

        // Parse the plan
        const parser = new Parser();
        parser.parsePlan(responseText);
        const result = parser.getResult();

        console.log("[useAIChat] Parsed plan:", { title: result.title, actions: Object.keys(result.actions) });

        // Create plan in database if we have session and detected plan content
        if (session && result.title && Object.keys(result.actions).length > 0) {
          try {
            // Find the AI SDK user message ID - this is what we use in the sync effect
            // We need to use the AI SDK's ID, not the database ID, for the lookup to work
            const allMessages = chat.messages;
            let aiSdkUserMessageId: string | null = null;

            // Find the user message that precedes this assistant message
            for (let i = allMessages.length - 1; i >= 0; i--) {
              if (allMessages[i].role === "user") {
                aiSdkUserMessageId = allMessages[i].id;
                break;
              }
            }

            // For database persistence, use the pending message ID if available
            const dbMessageId = pendingMessageId.current || aiSdkUserMessageId || message.id;

            console.log("[useAIChat] Creating plan - dbMessageId:", dbMessageId);
            const plan = await createPlanAction(session, workspaceId, dbMessageId);

            console.log("[useAIChat] Plan created:", plan.id);

            // Extract the description (text before the XML block)
            const xmlStart = responseText.indexOf('<chartsmithArtifactPlan');
            const description = xmlStart > 0 ? responseText.substring(0, xmlStart).trim() : result.title;

            // Convert parsed actions to action files format
            const actionFiles = Object.entries(result.actions).map(([path, action]) => ({
              action: action.action,
              path,
            }));

            console.log("[useAIChat] Action files:", actionFiles);

            // Update plan with status 'review', description, and action files
            const updatedPlan = await updatePlanWithActionsAction(plan.id, 'review', description, actionFiles);
            console.log("[useAIChat] Plan updated with actions");

            // Store the plan ID - we'll match by checking if response has plan XML
            lastCreatedPlanId.current = updatedPlan.id;

            // Update plansAtom with the updated plan
            setPlans((prev) => [...prev, updatedPlan]);

            // Force re-sync to include the plan ID in the message
            setPlanCreatedCount((prev) => prev + 1);
          } catch (error) {
            console.error("[useAIChat] Failed to create plan:", error);
          }
        }
      }
    },
    onError: (error: Error) => {
      console.error("AI Chat error:", error);
    },
  });

  // Check for pending messages that need AI responses
  // This handles messages saved to DB but not yet processed by AI SDK
  useEffect(() => {
    // Don't re-submit if we've already auto-submitted
    if (hasAutoSubmitted.current) return;

    // Find messages with a prompt but no response (pending AI processing)
    const pendingMessage = existingMessages.find(
      (msg) => msg.prompt && !msg.response && !msg.isComplete
    );

    if (pendingMessage && chat.status === "ready" && chat.messages.length === 0) {
      hasAutoSubmitted.current = true;
      // Store the database message ID before AI SDK replaces it
      pendingMessageId.current = pendingMessage.id;
      // Submit the pending prompt to get AI response
      chat.sendMessage({ text: pendingMessage.prompt });
    }
  }, [existingMessages, chat.status, chat.messages.length, chat.sendMessage]);

  // Sync AI SDK messages with atom state for display
  // This allows the UI to use a single source of truth (messagesAtom)
  useEffect(() => {
    if (chat.messages.length > 0) {
      // Pair user/assistant messages into single Message objects
      const pairedMessages: Message[] = [];
      for (let i = 0; i < chat.messages.length; i++) {
        const msg = chat.messages[i];
        if (msg.role === "user") {
          // Find the following assistant message if any
          const nextMsg = chat.messages[i + 1];
          const assistantResponse =
            nextMsg?.role === "assistant" ? getMessageText(nextMsg) : undefined;

          // Check if this message's response contains plan XML
          const hasPlanXml = assistantResponse?.includes("<chartsmithArtifactPlan");
          // If it has plan XML and we have a created plan, link them
          const responsePlanId = hasPlanXml ? lastCreatedPlanId.current : undefined;

          console.log("[useAIChat] Sync - msg.id:", msg.id, "hasPlanXml:", hasPlanXml, "responsePlanId:", responsePlanId);

          // Strip XML plan tags from response - the plan is shown via PlanChatMessage component
          let cleanedResponse = assistantResponse;
          if (cleanedResponse && hasPlanXml) {
            // Remove the chartsmithArtifactPlan block from the displayed response
            cleanedResponse = cleanedResponse
              .replace(/<chartsmithArtifactPlan[\s\S]*?<\/chartsmithArtifactPlan>/g, '')
              .replace(/<chartsmithArtifactPlan[\s\S]*$/g, '') // Handle unclosed tags
              .trim();
          }

          pairedMessages.push({
            id: msg.id,
            prompt: getMessageText(msg),
            response: cleanedResponse,
            responsePlanId,
            isComplete: assistantResponse !== undefined || chat.status === "ready",
            // Set isIntentComplete to true when we have a response, so the UI doesn't show "thinking..."
            isIntentComplete: assistantResponse !== undefined || chat.status === "ready",
            workspaceId,
          });

          // Skip the assistant message in the next iteration
          if (assistantResponse) i++;
        }
      }

      // Simply replace all messages with AI SDK messages
      // The AI SDK is now the source of truth for this chat session
      setMessages(pairedMessages);
    }
  }, [chat.messages, chat.status, workspaceId, setMessages, planCreatedCount]);

  // Input change handler
  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setInput(e.target.value);
    },
    []
  );

  // Submit handler
  const handleSubmit = useCallback(
    async (e?: React.FormEvent<HTMLFormElement>) => {
      e?.preventDefault();

      if (!input.trim()) return;

      console.log("[useAIChat] Submitting message:", input.substring(0, 50) + "...");

      // Reset plan creation flag for new messages
      hasCreatedPlan.current = false;

      // Note: Skipping message persistence for now - the /message API expects
      // extension tokens, not session IDs. Messages are stored via atom state.
      // TODO: Add proper session-based persistence in a future phase

      // Send to AI using the v5 API
      await chat.sendMessage({ text: input });

      // Clear input after sending
      setInput("");
    },
    [input, chat]
  );

  return {
    // Core chat state
    messages: existingMessages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading: chat.status === "streaming" || chat.status === "submitted",

    // Additional controls
    stop: chat.stop,
    reload: chat.regenerate,
    setInput,
    append: chat.sendMessage,

    // Error state
    error: chat.error,
  };
}

// Note: Message persistence functions removed for now.
// The /message API expects extension tokens, not session IDs.
// TODO: Add proper session-based persistence in a future phase (Phase 7)
