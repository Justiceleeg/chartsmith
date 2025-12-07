/**
 * XML Parser for LLM responses, ported from pkg/llm/parser.go
 *
 * Handles streaming parse of chartsmithArtifact and chartsmithActionPlan XML tags
 * from LLM responses.
 */

import type { ActionPlan, Artifact, HelmResponse } from './types';

export class Parser {
  private buffer: string = '';
  private result: HelmResponse = {
    title: '',
    actions: {},
    artifacts: [],
  };

  /**
   * Parse artifacts from a streaming chunk.
   * Handles both complete and partial artifacts.
   */
  parseArtifacts(chunk: string): void {
    this.buffer += chunk;

    // Find complete artifacts first
    const completeRegex = /<chartsmithArtifact([^>]*)>([\s\S]*?)<\/chartsmithArtifact>/g;
    let completeMatch: RegExpExecArray | null;

    while ((completeMatch = completeRegex.exec(this.buffer)) !== null) {
      const attributes = completeMatch[1];
      const content = completeMatch[2].trim();

      // Extract path from attributes
      const pathMatch = /path="([^"]*)"/.exec(attributes);
      if (pathMatch && pathMatch[1]) {
        const path = pathMatch[1];
        this.addArtifact(content, path);
      }

      // Remove complete artifact from buffer
      this.buffer = this.buffer.replace(completeMatch[0], '');
    }

    // Check for partial artifacts
    const partialStart = this.buffer.lastIndexOf('<chartsmithArtifact');
    if (partialStart !== -1) {
      const partialContent = this.buffer.substring(partialStart);

      // Try to extract path from the opening tag
      const pathMatch = /<chartsmithArtifact[^>]*path="([^"]*)"/.exec(partialContent);
      if (pathMatch && pathMatch[1]) {
        const path = pathMatch[1];

        // Only process content if we found the closing angle bracket
        if (partialContent.includes('>')) {
          const contentStart = partialContent.indexOf('>') + 1;
          const content = partialContent.substring(contentStart).trim();
          if (content !== '') {
            this.addArtifact(content, path);
          }
        }
      }
    }
  }

  /**
   * Helper to add artifact with content and path
   */
  private addArtifact(content: string, path: string): void {
    const artifact: Artifact = {
      content,
      path,
    };

    // Only append if we have content
    if (artifact.content !== '') {
      this.result.artifacts.push(artifact);
    }
  }

  /**
   * Parse plan from a streaming chunk.
   * Extracts title and action plans.
   */
  parsePlan(chunk: string): void {
    this.buffer += chunk;

    // Extract title if we haven't already
    if (this.result.title === '') {
      const titleRegex = /<chartsmithArtifactPlan[^>]*title="([^"]*)"[^>]*>/;
      const match = titleRegex.exec(this.buffer);
      if (match && match[1]) {
        this.result.title = match[1];
      }
    }

    // Find all action plan tags (handles attributes in any order)
    const tagRegex = /<chartsmithActionPlan([^>]*)(?:\/>|>)/g;
    let tagMatch: RegExpExecArray | null;

    while ((tagMatch = tagRegex.exec(this.buffer)) !== null) {
      const attributes = tagMatch[1];

      // Extract individual attributes (order-independent)
      const typeMatch = /type="([^"]+)"/.exec(attributes);
      const actionMatch = /action="([^"]+)"/.exec(attributes);
      const pathMatch = /path="([^"]+)"/.exec(attributes);

      if (!typeMatch || !actionMatch || !pathMatch) {
        continue;
      }

      const actionType = typeMatch[1]; // "file"
      const action = actionMatch[1];   // "create" or "update" or "delete"
      let path = pathMatch[1];         // file path

      // Strip any leading /
      path = path.replace(/^\//, '');

      // Check if we already have this file
      let artifactExists = false;
      for (const existingArtifact of this.result.artifacts) {
        if (existingArtifact.path === path) {
          artifactExists = true;
          break;
        }
      }

      if (!artifactExists && !this.result.actions[path]) {
        const actionPlan: ActionPlan = {
          type: actionType,
          action: action as ActionPlan['action'],
        };

        this.result.actions[path] = actionPlan;
      }
    }
  }

  /**
   * Returns the current parse results
   */
  getResult(): HelmResponse {
    return this.result;
  }

  /**
   * Reset the parser state
   */
  reset(): void {
    this.buffer = '';
    this.result = {
      title: '',
      actions: {},
      artifacts: [],
    };
  }
}
