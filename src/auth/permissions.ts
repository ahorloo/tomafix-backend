import { MemberRole, TemplateType } from '@prisma/client';

export type PermissionKey =
  | 'dashboard:view'
  | 'units:view'
  | 'units:manage'
  | 'residents:view'
  | 'residents:manage'
  | 'requests:view'
  | 'requests:create'
  | 'notices:view'
  | 'notices:manage'
  | 'inspections:view'
  | 'inspections:manage'
  | 'users:manage';

const baseByRole: Record<MemberRole, PermissionKey[]> = {
  OWNER_ADMIN: [
    'dashboard:view',
    'units:view',
    'units:manage',
    'residents:view',
    'residents:manage',
    'requests:view',
    'requests:create',
    'notices:view',
    'notices:manage',
    'inspections:view',
    'inspections:manage',
    'users:manage',
  ],
  MANAGER: [
    'dashboard:view',
    'units:view',
    'units:manage',
    'residents:view',
    'residents:manage',
    'requests:view',
    'requests:create',
    'notices:view',
    'notices:manage',
    'inspections:view',
    'inspections:manage',
    'users:manage',
  ],
  STAFF: [
    'dashboard:view',
    'units:view',
    'residents:view',
    'requests:view',
    'requests:create',
    'notices:view',
    'inspections:view',
    'inspections:manage',
  ],
  TECHNICIAN: ['dashboard:view', 'requests:view', 'requests:create', 'inspections:view', 'inspections:manage'],
  RESIDENT: ['dashboard:view', 'requests:view', 'requests:create', 'notices:view'],
};

export function hasPermission(templateType: TemplateType, role: MemberRole, permission: PermissionKey) {
  // future: template-specific overrides. for now same matrix across templates.
  void templateType;
  return baseByRole[role]?.includes(permission) ?? false;
}
