"use server"

import { getDB } from "@/lib/data/db";
import { getParam } from "@/lib/data/param";
import { Plan, ActionFile } from "@/lib/types/workspace";
import { getPlan } from "../workspace";

export type PlanStatus = 'pending' | 'planning' | 'review' | 'applying' | 'applied' | 'ignored';

export interface ActionFileInput {
  action: 'create' | 'update' | 'delete';
  path: string;
}

export async function updatePlanStatusAction(planId: string, status: PlanStatus, description?: string): Promise<Plan> {
  const db = getDB(await getParam("DB_URI"));

  const updates: string[] = [`status = $2`];
  const values: (string | undefined)[] = [planId, status];

  if (description !== undefined) {
    updates.push(`description = $${values.length + 1}`);
    values.push(description);
  }

  await db.query(
    `UPDATE workspace_plan SET ${updates.join(', ')}, updated_at = now() WHERE id = $1`,
    values
  );

  return getPlan(planId);
}

/**
 * Update plan with action files parsed from XML.
 * This is called after the AI generates a plan with file actions.
 */
export async function updatePlanWithActionsAction(
  planId: string,
  status: PlanStatus,
  description: string,
  actionFiles: ActionFileInput[]
): Promise<Plan> {
  const db = getDB(await getParam("DB_URI"));

  // Start transaction
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Update plan status and description
    await client.query(
      `UPDATE workspace_plan SET status = $2, description = $3, updated_at = now() WHERE id = $1`,
      [planId, status, description]
    );

    // Delete existing action files
    await client.query(
      `DELETE FROM workspace_plan_action_file WHERE plan_id = $1`,
      [planId]
    );

    // Insert new action files
    for (const actionFile of actionFiles) {
      await client.query(
        `INSERT INTO workspace_plan_action_file (plan_id, action, path, status, created_at)
         VALUES ($1, $2, $3, 'pending', now())
         ON CONFLICT (plan_id, path) DO UPDATE SET status = EXCLUDED.status`,
        [planId, actionFile.action, actionFile.path]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return getPlan(planId);
}
