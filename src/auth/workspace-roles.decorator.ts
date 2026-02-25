import { MemberRole } from '@prisma/client';
import { SetMetadata } from '@nestjs/common';

export const WORKSPACE_ROLES_KEY = 'workspace_roles';
export const WorkspaceRoles = (...roles: MemberRole[]) => SetMetadata(WORKSPACE_ROLES_KEY, roles);
