"use client";

import { useChat, UseChatOptions } from "ai/react";
import { useCallback, useEffect, useState } from "react";
import { useAtom } from "jotai";
import { messagesAtom } from "@/atoms/workspace";
import { Session } from "@/lib/types/session";
import { authorizeExtensionAction } from "@/lib/auth/actions/authorize-extension";
import { Message } from "@/components/types";

interface UseAIChatOptions {
  session: Session;
  workspaceId: string;
}

/**
 * Hook for AI chat using Vercel AI SDK.
 * Provides streaming chat with integration to existing atom state.
 */
export function useAIChat({ session, workspaceId }: UseAIChatOptions) {
  const [, setMessages] = useAtom(messagesAtom);
  const [extensionToken, setExtensionToken] = useState<string | null>(null);

  // Get extension token on mount
  useEffect(() => {
    const getToken = async () => {
      try {
        const { token } = await authorizeExtensionAction(session);
        setExtensionToken(token);
      } catch (error) {
        console.error("Failed to get extension token:", error);
      }
    };
    getToken();
  }, [session]);

  const chatOptions: UseChatOptions = {
    api: "/api/chat",
    body: { workspaceId },
    headers: extensionToken
      ? { Authorization: `Bearer ${extensionToken}` }
      : undefined,
    onFinish: async (message) => {
      // Convert AI SDK message to our Message format and update atom
      const newMessage: Message = {
        id: message.id,
        prompt: "", // The prompt is tracked separately
        response: message.content,
        isComplete: true,
        createdAt: message.createdAt,
        workspaceId,
        userId: session.user.id,
      };

      setMessages((prev) => {
        // Check if message already exists (from streaming)
        const existingIndex = prev.findIndex((m) => m.id === message.id);
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = { ...updated[existingIndex], ...newMessage };
          return updated;
        }
        return [...prev, newMessage];
      });

      // Note: DB persistence will be added in Phase 7
      // For now, messages are only tracked in atom state
    },
    onError: (error) => {
      console.error("Chat error:", error);
    },
  };

  const chat = useChat(chatOptions);

  // Custom submit handler that also tracks the user prompt in atom state
  const handleSubmit = useCallback(
    async (
      e?: { preventDefault?: () => void },
      options?: { data?: Record<string, string> }
    ) => {
      if (!extensionToken) {
        console.error("Extension token not ready");
        return;
      }

      const userPrompt = chat.input;

      // Add user message to atom state before sending
      if (userPrompt.trim()) {
        const userMessage: Message = {
          id: `user-${Date.now()}`, // Temporary ID, will be replaced by server
          prompt: userPrompt,
          response: undefined,
          isComplete: false,
          createdAt: new Date(),
          workspaceId,
          userId: session.user.id,
        };

        setMessages((prev) => [...prev, userMessage]);
      }

      // Call the original submit
      chat.handleSubmit(e, options);
    },
    [chat, extensionToken, setMessages, workspaceId, session.user.id]
  );

  return {
    messages: chat.messages,
    input: chat.input,
    handleInputChange: chat.handleInputChange,
    handleSubmit,
    isLoading: chat.status === "streaming" || chat.status === "submitted",
    error: chat.error,
    setInput: chat.setInput,
    status: chat.status,
    // Expose raw chat object for advanced use cases
    _chat: chat,
  };
}
