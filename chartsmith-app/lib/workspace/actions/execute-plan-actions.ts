"use server"

import { Session } from "@/lib/types/session";
import { getDB } from "@/lib/data/db";
import { getParam } from "@/lib/data/param";
import { enqueueWork } from "@/lib/utils/queue";
import { logger } from "@/lib/utils/logger";

export interface FileChange {
  path: string;
  content: string;
}

export interface PersistedFile {
  id: string;
  filePath: string;
  revisionNumber: number;
  content: string;
  contentPending: string;
  chartId: string;
}

/**
 * Persist a single file immediately after it completes.
 * This mirrors the behavior of the Go worker which sends Centrifugo events per-file.
 * Returns the persisted file data for immediate UI update.
 */
export async function persistSingleFileAction(
  session: Session,
  workspaceId: string,
  revisionNumber: number,
  chartId: string,
  path: string,
  content: string
): Promise<PersistedFile> {
  console.log("[persistSingleFileAction] Persisting file:", path);

  const db = getDB(await getParam("DB_URI"));

  const existing = await db.query(
    `SELECT id FROM workspace_file
     WHERE workspace_id = $1 AND revision_number = $2 AND file_path = $3`,
    [workspaceId, revisionNumber, path]
  );

  let fileId: string;

  if (existing.rows.length === 0) {
    // Create new file (content starts as empty string, content_pending holds the new content)
    const srs = await import("secure-random-string");
    fileId = srs.default({ length: 12, alphanumeric: true });
    console.log("[persistSingleFileAction] Creating new file:", path, "with id:", fileId);
    await db.query(
      `INSERT INTO workspace_file (id, workspace_id, revision_number, chart_id, file_path, content, content_pending)
       VALUES ($1, $2, $3, $4, $5, '', $6)`,
      [fileId, workspaceId, revisionNumber, chartId, path, content]
    );
  } else {
    fileId = existing.rows[0].id;
    console.log("[persistSingleFileAction] Updating existing file:", path, "id:", fileId);
    await db.query(
      `UPDATE workspace_file SET content_pending = $1
       WHERE workspace_id = $2 AND revision_number = $3 AND file_path = $4`,
      [content, workspaceId, revisionNumber, path]
    );
  }

  console.log("[persistSingleFileAction] File persisted:", path);

  return {
    id: fileId,
    filePath: path,
    revisionNumber,
    content: "",
    contentPending: content,
    chartId,
  };
}

/**
 * Batch persist all file changes after execution completes.
 * Called from onFinish callback after all tool calls complete.
 */
export async function persistExecutionResultsAction(
  session: Session,
  workspaceId: string,
  revisionNumber: number,
  chartId: string,
  fileChanges: FileChange[]
): Promise<void> {
  console.log("[persistExecutionResultsAction] Called with:", {
    workspaceId,
    revisionNumber,
    chartId,
    fileCount: fileChanges.length,
    files: fileChanges.map(fc => ({ path: fc.path, contentLength: fc.content?.length || 0 }))
  });

  logger.info("Persisting execution results", {
    workspaceId,
    revisionNumber,
    chartId,
    fileCount: fileChanges.length,
  });

  const db = getDB(await getParam("DB_URI"));

  for (const { path, content } of fileChanges) {
    console.log("[persistExecutionResultsAction] Processing file:", path);

    const existing = await db.query(
      `SELECT id FROM workspace_file
       WHERE workspace_id = $1 AND revision_number = $2 AND file_path = $3`,
      [workspaceId, revisionNumber, path]
    );

    console.log("[persistExecutionResultsAction] Existing rows for", path, ":", existing.rows.length);

    if (existing.rows.length === 0) {
      // Create new file (content starts as empty string, content_pending holds the new content)
      const srs = await import("secure-random-string");
      const fileId = srs.default({ length: 12, alphanumeric: true });
      console.log("[persistExecutionResultsAction] Creating new file:", path, "with id:", fileId);
      await db.query(
        `INSERT INTO workspace_file (id, workspace_id, revision_number, chart_id, file_path, content, content_pending)
         VALUES ($1, $2, $3, $4, $5, '', $6)`,
        [fileId, workspaceId, revisionNumber, chartId, path, content]
      );
      console.log("[persistExecutionResultsAction] Inserted file:", path);
    } else {
      // Update existing file
      console.log("[persistExecutionResultsAction] Updating existing file:", path);
      await db.query(
        `UPDATE workspace_file SET content_pending = $1
         WHERE workspace_id = $2 AND revision_number = $3 AND file_path = $4`,
        [content, workspaceId, revisionNumber, path]
      );
      console.log("[persistExecutionResultsAction] Updated file:", path);
    }
  }

  logger.info("Persisted execution results successfully", {
    workspaceId,
    revisionNumber,
  });
}

/**
 * Mark plan and revision as complete, enqueue render.
 */
export async function completePlanExecutionAction(
  session: Session,
  planId: string,
  workspaceId: string,
  revisionNumber: number,
  chatMessageId?: string
): Promise<void> {
  logger.info("Completing plan execution", {
    planId,
    workspaceId,
    revisionNumber,
    chatMessageId,
  });

  const db = getDB(await getParam("DB_URI"));

  // Update all action files to 'created' status
  await db.query(
    `UPDATE workspace_plan_action_file SET status = 'created' WHERE plan_id = $1`,
    [planId]
  );

  // Update plan status to 'applied'
  await db.query(
    `UPDATE workspace_plan SET status = 'applied', updated_at = now() WHERE id = $1`,
    [planId]
  );

  // Mark revision as complete
  await db.query(
    `UPDATE workspace_revision SET is_complete = true
     WHERE workspace_id = $1 AND revision_number = $2`,
    [workspaceId, revisionNumber]
  );

  // Enqueue render job if we have a chat message ID
  if (chatMessageId) {
    await enqueueWork("render_workspace", {
      workspaceId,
      revisionNumber,
      chatMessageId,
    });
  }

  logger.info("Completed plan execution successfully", {
    planId,
    workspaceId,
    revisionNumber,
  });
}
