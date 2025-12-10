"use client";

/**
 * Hook for executing plans using Vercel AI SDK.
 * Executes each action file sequentially, tracks file changes,
 * and persists results after all actions complete.
 *
 * This replaces the Go-based execution flow (pkg/listener/apply-plan.go)
 * with SDK-native tool calling.
 */

import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useAtom } from "jotai";
import { workspaceAtom } from "@/atoms/workspace";
import { Plan, ActionFile } from "@/lib/types/workspace";
import { Session } from "@/lib/types/session";
import {
  persistSingleFileAction,
  completePlanExecutionAction,
  FileChange,
  PersistedFile,
} from "@/lib/workspace/actions/execute-plan-actions";

interface UseExecutePlanOptions {
  session?: Session;
  workspaceId: string;
  onActionStart?: (action: ActionFile, index: number, total: number) => void;
  onActionComplete?: (action: ActionFile, index: number, total: number) => void;
  onFilePersisted?: (file: PersistedFile) => void;
  onToolCall?: (toolName: string, args: unknown) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

interface ExecutionState {
  isExecuting: boolean;
  currentAction: ActionFile | null;
  currentActionIndex: number;
  totalActions: number;
  completedActions: number;
}

export function useExecutePlan(options: UseExecutePlanOptions) {
  const [workspace] = useAtom(workspaceAtom);

  // Execution state
  const [executionState, setExecutionState] = useState<ExecutionState>({
    isExecuting: false,
    currentAction: null,
    currentActionIndex: 0,
    totalActions: 0,
    completedActions: 0,
  });

  // Track file changes across all action executions
  const fileChangesRef = useRef<FileChange[]>([]);

  // Track execution context for persistence
  const executionContextRef = useRef<{
    plan: Plan;
    revisionNumber: number;
    fileContents: Record<string, string>;
  } | null>(null);

  // Track the current action being executed
  const currentActionRef = useRef<ActionFile | null>(null);

  // Store options in a ref to avoid recreating callbacks on every render
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Create transport for execute API
  // Use session ID string as dependency to prevent recreating transport when session object reference changes
  const sessionId = options.session?.id;
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat/execute",
        headers: sessionId
          ? { Authorization: `Bearer ${sessionId}` }
          : undefined,
      }),
    [sessionId]
  );

  // Memoize callbacks to prevent useChat from re-initializing
  const handleToolCall = useCallback(async ({ toolCall }: { toolCall: { toolName: string } }) => {
    // Log tool calls for debugging
    console.log("[useExecutePlan] Tool called:", toolCall.toolName);
    optionsRef.current.onToolCall?.(toolCall.toolName, toolCall);

    // Tool execution happens server-side
    // We'll track file changes from the tool results in onFinish
    return undefined;
  }, []);

  const handleFinish = useCallback(async ({ message }: { message: UIMessage }) => {
    const action = currentActionRef.current;
    console.log("[useExecutePlan] onFinish called, action:", action?.path || "none");
    if (!action) {
      console.log("[useExecutePlan] onFinish: No current action, skipping");
      return;
    }

    // Debug: Log the entire message structure to understand AI SDK v5 format
    console.log("[useExecutePlan] onFinish message parts:", JSON.stringify(message.parts, null, 2));

    // Look for tool results in the message parts
    // AI SDK v5 uses "tool-{toolName}" parts with state and output
    console.log("[useExecutePlan] Processing", message.parts.length, "parts for action:", action.path);

    // Track all tool results for this action to pick the best one
    let lastModifyingContent: string | null = null;

    for (const part of message.parts) {
      console.log("[useExecutePlan] Part type:", part.type);

      // Check for tool parts - they have type like "tool-text_editor"
      if (part.type.startsWith("tool-")) {
        const toolPart = part as {
          type: string;
          toolCallId: string;
          state?: string;
          input?: { command?: string; path?: string };
          output?: { success?: boolean; content?: string; message?: string };
        };

        const command = toolPart.input?.command;
        const state = toolPart.state;
        const hasOutput = !!toolPart.output;
        const isSuccess = toolPart.output?.success;
        const hasContent = !!toolPart.output?.content;

        console.log("[useExecutePlan] Tool part:", {
          command,
          state,
          hasOutput,
          isSuccess,
          hasContent,
          contentLength: toolPart.output?.content?.length || 0
        });

        // Only capture results from create or str_replace commands (not view)
        if (toolPart.state === "output-available" && toolPart.output?.success && toolPart.output?.content) {
          // Skip view commands - we only want create/str_replace results
          if (command === "view") {
            console.log("[useExecutePlan] Skipping view command");
            continue;
          }

          console.log("[useExecutePlan] Found modifying tool result:", command, "content length:", toolPart.output.content.length);
          lastModifyingContent = toolPart.output.content;
        }
      }
    }

    // If we found any modifying content, use the last one (most recent state)
    if (lastModifyingContent) {
      console.log("[useExecutePlan] Using last modifying content for:", action.path, "length:", lastModifyingContent.length);

      // Update file contents with the final result
      if (executionContextRef.current) {
        executionContextRef.current.fileContents[action.path] = lastModifyingContent;
      }

      // Check if we already have this file in fileChangesRef and update it, otherwise add new
      const existingIndex = fileChangesRef.current.findIndex(fc => fc.path === action.path);
      if (existingIndex >= 0) {
        // Update existing entry with the latest content
        fileChangesRef.current[existingIndex].content = lastModifyingContent;
        console.log("[useExecutePlan] Updated existing file change:", action.path, "content length:", lastModifyingContent.length);
      } else {
        // Add new entry
        fileChangesRef.current.push({
          path: action.path,
          content: lastModifyingContent,
        });
        console.log("[useExecutePlan] Added new file change:", action.path, "content length:", lastModifyingContent.length);
      }
    } else {
      console.log("[useExecutePlan] No modifying content found for action:", action.path);
    }

    console.log(`[useExecutePlan] Action complete: ${action.path}, total file changes: ${fileChangesRef.current.length}`);
  }, []);

  const handleError = useCallback((error: Error) => {
    console.error("[useExecutePlan] Chat error:", error);
    optionsRef.current.onError?.(error);
  }, []);

  // useChat for executing individual actions
  const chat = useChat({
    transport,
    onToolCall: handleToolCall,
    onFinish: handleFinish,
    onError: handleError,
  });

  // Refs to track chat state for polling (avoids stale closure issues)
  const chatStatusRef = useRef(chat.status);
  const chatErrorRef = useRef(chat.error);

  useEffect(() => {
    chatStatusRef.current = chat.status;
  }, [chat.status]);

  useEffect(() => {
    chatErrorRef.current = chat.error;
  }, [chat.error]);

  /**
   * Execute a single action file
   */
  const executeAction = useCallback(
    async (
      action: ActionFile,
      plan: Plan,
      fileContents: Record<string, string>
    ): Promise<void> => {
      currentActionRef.current = action;

      const currentContent = fileContents[action.path] || "";

      // Send the execution request
      await chat.sendMessage({
        text: JSON.stringify({
          plan: {
            id: plan.id,
            description: plan.description,
          },
          action: {
            action: action.action,
            path: action.path,
          },
          currentContent,
        }),
      });

      // Wait for the chat to finish
      // The useChat hook handles streaming automatically
      // We need to wait for status to return to "ready"
      // Use refs to avoid stale closure issues
      return new Promise((resolve, reject) => {
        const checkStatus = () => {
          if (chatStatusRef.current === "ready") {
            resolve();
          } else if (chatErrorRef.current) {
            reject(chatErrorRef.current);
          } else {
            setTimeout(checkStatus, 100);
          }
        };
        // Start checking after a small delay to let the request start
        setTimeout(checkStatus, 100);
      });
    },
    [chat.sendMessage]
  );

  /**
   * Execute the full plan - all action files sequentially
   */
  const executePlan = useCallback(
    async (
      plan: Plan,
      revisionNumber: number,
      fileContents: Record<string, string>,
      chartId?: string
    ) => {
      // Use optionsRef to get current options without adding options to dependencies
      const currentOptions = optionsRef.current;

      if (!currentOptions.session) {
        console.error("[useExecutePlan] No session available");
        currentOptions.onError?.(new Error("No session available"));
        return;
      }

      if (!plan.actionFiles || plan.actionFiles.length === 0) {
        console.log("[useExecutePlan] No action files to execute");
        currentOptions.onComplete?.();
        return;
      }

      // Store context for persistence
      executionContextRef.current = {
        plan,
        revisionNumber,
        fileContents: { ...fileContents },
      };
      fileChangesRef.current = [];

      const totalActions = plan.actionFiles.length;

      setExecutionState({
        isExecuting: true,
        currentAction: null,
        currentActionIndex: 0,
        totalActions,
        completedActions: 0,
      });

      // Use provided chartId or fall back to first chart in workspace
      const effectiveChartId = chartId || workspace?.charts?.[0]?.id;
      console.log("[useExecutePlan] Using chartId:", effectiveChartId, "workspaceId:", currentOptions.workspaceId, "revisionNumber:", revisionNumber);

      try {
        // Execute each action sequentially and persist immediately
        for (let i = 0; i < plan.actionFiles.length; i++) {
          const action = plan.actionFiles[i];

          setExecutionState((prev) => ({
            ...prev,
            currentAction: action,
            currentActionIndex: i,
          }));

          currentOptions.onActionStart?.(action, i, totalActions);
          console.log(
            `[useExecutePlan] Executing action ${i + 1}/${totalActions}: ${action.action} ${action.path}`
          );

          await executeAction(
            action,
            plan,
            executionContextRef.current.fileContents
          );

          // Persist file immediately after action completes (mirrors main branch behavior)
          const fileChange = fileChangesRef.current.find(fc => fc.path === action.path);
          if (fileChange && effectiveChartId) {
            console.log(`[useExecutePlan] Persisting file immediately: ${action.path}`);
            const persistedFile = await persistSingleFileAction(
              currentOptions.session!,
              currentOptions.workspaceId,
              revisionNumber,
              effectiveChartId,
              fileChange.path,
              fileChange.content
            );
            console.log(`[useExecutePlan] File persisted: ${action.path}, id: ${persistedFile.id}`);

            // Notify caller so they can update UI immediately
            currentOptions.onFilePersisted?.(persistedFile);
          }

          setExecutionState((prev) => ({
            ...prev,
            completedActions: i + 1,
          }));

          currentOptions.onActionComplete?.(action, i, totalActions);
        }

        console.log(
          `[useExecutePlan] All actions complete, ${fileChangesRef.current.length} files persisted`
        );

        // Mark plan as complete in database
        const lastChatMessageId =
          plan.chatMessageIds?.[plan.chatMessageIds.length - 1];
        await completePlanExecutionAction(
          currentOptions.session!, // Safe: we check for session at function start
          plan.id,
          currentOptions.workspaceId,
          revisionNumber,
          lastChatMessageId
        );

        // Note: Plan status UI update is handled in onComplete callback
        // to use the latest plan ref with updated action file statuses

        console.log("[useExecutePlan] Plan execution complete");
        currentOptions.onComplete?.();
      } catch (error) {
        console.error("[useExecutePlan] Execution failed:", error);
        currentOptions.onError?.(
          error instanceof Error ? error : new Error(String(error))
        );
      } finally {
        setExecutionState({
          isExecuting: false,
          currentAction: null,
          currentActionIndex: 0,
          totalActions: 0,
          completedActions: 0,
        });
        fileChangesRef.current = [];
        executionContextRef.current = null;
        currentActionRef.current = null;
      }
    },
    [
      executeAction,
      workspace,
    ]
  );

  return {
    executePlan,
    isExecuting: executionState.isExecuting,
    currentAction: executionState.currentAction,
    currentActionIndex: executionState.currentActionIndex,
    totalActions: executionState.totalActions,
    completedActions: executionState.completedActions,
    // Expose chat messages for debugging
    messages: chat.messages,
  };
}
