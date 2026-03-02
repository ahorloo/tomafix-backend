-- Performance indexes for common workspace-scoped reads

CREATE INDEX IF NOT EXISTS "WorkspaceMember_workspaceId_isActive_role_idx"
  ON "WorkspaceMember"("workspaceId", "isActive", role);

CREATE INDEX IF NOT EXISTS "Unit_workspaceId_status_idx"
  ON "Unit"("workspaceId", status);

CREATE INDEX IF NOT EXISTS "Resident_workspaceId_status_idx"
  ON "Resident"("workspaceId", status);

CREATE INDEX IF NOT EXISTS "Request_workspaceId_status_createdAt_idx"
  ON "Request"("workspaceId", status, "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Request_workspaceId_residentId_createdAt_idx"
  ON "Request"("workspaceId", "residentId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "RequestMessage_workspaceId_requestId_createdAt_idx"
  ON "RequestMessage"("workspaceId", "requestId", "createdAt" ASC);

CREATE INDEX IF NOT EXISTS "Notice_workspaceId_audience_createdAt_idx"
  ON "Notice"("workspaceId", audience, "createdAt" DESC);
