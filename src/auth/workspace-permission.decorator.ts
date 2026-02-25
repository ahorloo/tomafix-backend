import { SetMetadata } from '@nestjs/common';
import { PermissionKey } from './permissions';

export const WORKSPACE_PERMISSION_KEY = 'workspace_permission_key';
export const WorkspacePermission = (permission: PermissionKey) => SetMetadata(WORKSPACE_PERMISSION_KEY, permission);
