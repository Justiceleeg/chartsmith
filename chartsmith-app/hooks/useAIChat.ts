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
 */

import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useCallback, useEffect, useMemo, ChangeEvent } from "react";
import { useAtom } from "jotai";
import { messagesAtom } from "@/atoms/workspace";
import { Message } from "@/components/types";

interface UseAIChatOptions {
  workspaceId: string;
  sessionToken?: string;
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

export function useAIChat({ workspaceId, sessionToken }: UseAIChatOptions) {
  const [existingMessages, setMessages] = useAtom(messagesAtom);

  // Input state management (v5 doesn't include this in useChat)
  const [input, setInput] = useState("");

  // Create custom transport with our API endpoint and auth
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: sessionToken
          ? { Authorization: `Bearer ${sessionToken}` }
          : undefined,
        body: { workspaceId },
      }),
    [workspaceId, sessionToken]
  );

  const chat = useChat({
    transport,
    onFinish: async ({ message }: { message: UIMessage }) => {
      // Note: Message persistence is disabled for now.
      // The /message API expects extension tokens, not session IDs.
      // TODO: Add proper session-based persistence in a future phase
      console.log("[useAIChat] Response complete:", getMessageText(message).substring(0, 100) + "...");
    },
    onError: (error: Error) => {
      console.error("AI Chat error:", error);
    },
  });

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

          pairedMessages.push({
            id: msg.id,
            prompt: getMessageText(msg),
            response: assistantResponse,
            isComplete: assistantResponse !== undefined || chat.status === "ready",
            // Set isIntentComplete to true when we have a response, so the UI doesn't show "thinking..."
            isIntentComplete: assistantResponse !== undefined || chat.status === "ready",
            workspaceId,
          });

          // Skip the assistant message in the next iteration
          if (assistantResponse) i++;
        }
      }

      // Update atom with paired messages from this chat session
      // Note: We append to existing messages to preserve history from Centrifugo
      setMessages((prev: Message[]) => {
        // Remove any messages that came from this AI chat session
        // (identified by matching IDs) and replace with updated versions
        const aiMessageIds = new Set(pairedMessages.map((m) => m.id));
        const filteredPrev = prev.filter((m) => !aiMessageIds.has(m.id));
        return [...filteredPrev, ...pairedMessages];
      });
    }
  }, [chat.messages, chat.status, workspaceId, setMessages]);

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
