/**
 * Types for LLM operations, ported from pkg/llm/types/types.go
 */

export type ActionPlanStatus = 'pending' | 'creating' | 'created';

export interface ActionPlan {
  type: string;
  action: 'create' | 'update' | 'delete';
  status?: ActionPlanStatus;
}

export interface ActionPlanWithPath extends ActionPlan {
  path: string;
}

export interface Artifact {
  path: string;
  content: string;
}

export interface HelmResponse {
  title: string;
  actions: Record<string, ActionPlan>;
  artifacts: Artifact[];
}

/**
 * Intent classification result from the LLM.
 * Ported from pkg/workspace/types/types.go Intent struct.
 */
export interface Intent {
  isConversational: boolean;
  isPlan: boolean;
  isOffTopic: boolean;
  isChartDeveloper: boolean;
  isChartOperator: boolean;
  isProceed: boolean;
  isRender: boolean;
}

/**
 * Persona type for intent classification context.
 * Affects which intent flags are checked.
 */
export type ChatMessageFromPersona = 'auto' | 'developer' | 'operator';
