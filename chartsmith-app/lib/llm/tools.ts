/**
 * Tool definitions for LLM operations using Vercel AI SDK.
 * Ported from pkg/llm/execute-action.go and pkg/llm/conversational.go
 *
 * These tools allow the LLM to:
 * - View, create, and edit files (text_editor)
 * - Look up subchart versions from Artifact Hub
 * - Get latest Kubernetes version
 */

import { tool, Tool } from 'ai';
import { z } from 'zod';
import { performStringReplacement } from './fuzzy-match';

/**
 * Result of a tool execution
 */
export interface ToolResult {
  success: boolean;
  message: string;
  content?: string;
}

/**
 * File content provider interface.
 * Used to abstract file operations for testing and different backends.
 */
export interface FileProvider {
  getFileContent(path: string): Promise<string | null>;
  createFile(path: string, content: string): Promise<void>;
  updateFile(path: string, content: string): Promise<void>;
}

/**
 * In-memory file provider for use during streaming execution.
 * Tracks file contents as they're modified by tool calls.
 */
export class InMemoryFileProvider implements FileProvider {
  private files: Map<string, string>;

  constructor(initialFiles: Record<string, string> = {}) {
    this.files = new Map(Object.entries(initialFiles));
  }

  async getFileContent(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async createFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async updateFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  getFiles(): Record<string, string> {
    return Object.fromEntries(this.files);
  }
}

// Define the input schema for text editor tool
const textEditorInputSchema = z.object({
  command: z
    .enum(['view', 'str_replace', 'create'])
    .describe('The command to execute'),
  path: z.string().describe('File path relative to chart root'),
  file_text: z
    .string()
    .optional()
    .describe('For create: full file content'),
  old_str: z
    .string()
    .optional()
    .describe('For str_replace: text to find'),
  new_str: z
    .string()
    .optional()
    .describe('For str_replace: replacement text'),
  view_range: z
    .array(z.number())
    .optional()
    .describe('For view: [start, end] line range (1-indexed)'),
});

type TextEditorInput = z.infer<typeof textEditorInputSchema>;

/**
 * Text editor tool matching Claude's text_editor_20241022 format.
 * Supports view, str_replace, and create commands for file manipulation.
 *
 * Ported from pkg/llm/execute-action.go
 */
export function createTextEditorTool(
  fileProvider: FileProvider
): Tool<TextEditorInput, ToolResult> {
  return tool({
    description: 'Edit files using view, str_replace, or create commands',
    inputSchema: textEditorInputSchema,
    execute: async ({
      command,
      path,
      file_text,
      old_str,
      new_str,
      view_range,
    }): Promise<ToolResult> => {
      const currentContent = await fileProvider.getFileContent(path);

      switch (command) {
        case 'view': {
          if (currentContent === null) {
            return {
              success: false,
              message: 'Error: File does not exist. Use create instead.',
            };
          }

          // Handle view_range if provided
          if (view_range && view_range.length === 2) {
            const lines = currentContent.split('\n');
            const [start, end] = view_range;
            // Convert to 0-indexed and slice
            const sliced = lines.slice(Math.max(0, start - 1), end);
            return {
              success: true,
              message: 'File content retrieved',
              content: sliced.join('\n'),
            };
          }

          return {
            success: true,
            message: 'File content retrieved',
            content: currentContent,
          };
        }

        case 'str_replace': {
          if (currentContent === null) {
            return {
              success: false,
              message: 'Error: File does not exist. Use create instead.',
            };
          }

          if (!old_str) {
            return {
              success: false,
              message: 'Error: old_str is required for str_replace command',
            };
          }

          if (new_str === undefined) {
            return {
              success: false,
              message: 'Error: new_str is required for str_replace command',
            };
          }

          const result = performStringReplacement(
            currentContent,
            old_str,
            new_str
          );

          if (result.error) {
            return {
              success: false,
              message:
                'Error: String to replace not found in file. Please use smaller, more precise replacements.',
            };
          }

          await fileProvider.updateFile(path, result.content);

          return {
            success: true,
            message: 'Content replaced successfully',
            content: result.content,
          };
        }

        case 'create': {
          if (currentContent !== null) {
            return {
              success: false,
              message:
                'Error: File already exists. Use view and str_replace instead.',
            };
          }

          if (!file_text) {
            return {
              success: false,
              message: 'Error: file_text is required for create command',
            };
          }

          await fileProvider.createFile(path, file_text);

          return {
            success: true,
            message: 'File created successfully',
            content: file_text,
          };
        }

        default:
          return {
            success: false,
            message: `Error: Unknown command ${command}`,
          };
      }
    },
  });
}

/**
 * Artifact Hub API response types
 */
interface ArtifactHubPackage {
  name: string;
  version: string;
  app_version?: string;
}

interface ArtifactHubResponse {
  packages: ArtifactHubPackage[];
}

/**
 * Search Artifact Hub for a Helm chart and return the latest version.
 * Ported from pkg/recommendations/subchart.go
 */
async function searchArtifactHubForChart(
  chartName: string
): Promise<string | null> {
  try {
    const encodedName = encodeURIComponent(chartName);
    const url = `https://artifacthub.io/api/v1/packages/search?offset=0&limit=20&facets=false&ts_query_web=${encodedName}&kind=0&deprecated=false&sort=relevance`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'chartsmith/1.0',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error(
        `Artifact Hub API error: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data: ArtifactHubResponse = await response.json();

    if (!data.packages || data.packages.length === 0) {
      return null;
    }

    return data.packages[0].version;
  } catch (error) {
    console.error('Failed to search Artifact Hub:', error);
    return null;
  }
}

/**
 * Get the latest Replicated SDK version from GitHub releases.
 * Ported from pkg/recommendations/subchart.go
 */
async function getReplicatedSubchartVersion(): Promise<string | null> {
  try {
    const response = await fetch(
      'https://api.github.com/repos/replicatedhq/replicated-sdk/releases/latest',
      {
        headers: {
          'User-Agent': 'chartsmith/1.0',
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.error(
        `GitHub API error: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = await response.json();
    return data.tag_name || null;
  } catch (error) {
    console.error('Failed to get Replicated subchart version:', error);
    return null;
  }
}

// Define input schema for subchart version tool
const subchartVersionInputSchema = z.object({
  chart_name: z
    .string()
    .describe(
      'The name of the Helm chart to look up (e.g., "postgresql", "redis", "nginx")'
    ),
});

type SubchartVersionInput = z.infer<typeof subchartVersionInputSchema>;

/**
 * Tool to get the latest version of a Helm subchart.
 * Searches Artifact Hub for the chart version.
 *
 * Ported from pkg/llm/conversational.go latest_subchart_version tool
 */
export const latestSubchartVersionTool: Tool<
  SubchartVersionInput,
  { version: string }
> = tool({
  description:
    'Get the latest version of a Helm subchart from Artifact Hub. Use this when you need to know what version of a dependency to include.',
  inputSchema: subchartVersionInputSchema,
  execute: async ({ chart_name }): Promise<{ version: string }> => {
    // Check for Replicated SDK special case
    if (chart_name.toLowerCase().includes('replicated')) {
      const version = await getReplicatedSubchartVersion();
      return { version: version || '?' };
    }

    const version = await searchArtifactHubForChart(chart_name);
    return { version: version || '?' };
  },
});

// Define input schema for kubernetes version tool
const kubernetesVersionInputSchema = z.object({
  semver_field: z
    .enum(['major', 'minor', 'patch'])
    .describe("One of 'major', 'minor', or 'patch'"),
});

type KubernetesVersionInput = z.infer<typeof kubernetesVersionInputSchema>;

/**
 * Tool to get the latest Kubernetes version.
 * Returns major, minor, or patch version based on the field requested.
 *
 * Ported from pkg/llm/conversational.go latest_kubernetes_version tool
 */
export const latestKubernetesVersionTool: Tool<
  KubernetesVersionInput,
  { version: string }
> = tool({
  description:
    'Get the latest Kubernetes version. Specify whether you want major, minor, or patch version.',
  inputSchema: kubernetesVersionInputSchema,
  execute: async ({ semver_field }): Promise<{ version: string }> => {
    // Current latest Kubernetes versions as of December 2025
    // In production, this could be fetched from the Kubernetes GitHub API
    switch (semver_field) {
      case 'major':
        return { version: '1' };
      case 'minor':
        return { version: '1.32' };
      case 'patch':
        return { version: '1.32.1' };
      default:
        return { version: '1.32.1' };
    }
  },
});

/**
 * All conversational tools that can be used during chat.
 * These are read-only information lookup tools.
 */
export const conversationalTools = {
  latest_subchart_version: latestSubchartVersionTool,
  latest_kubernetes_version: latestKubernetesVersionTool,
};
