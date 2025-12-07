"use server"

import { Session } from "@/lib/types/session";
import { createPlan } from "../workspace";

export async function createPlanAction(session: Session, workspaceId: string, chatMessageId: string, superceedingPlanId?: string) {
  const plan = await createPlan(session.user.id, workspaceId, chatMessageId, superceedingPlanId);
  return plan;
}
