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

export type PermissionPolicy = Partial<Record<MemberRole, Partial<Record<PermissionKey, boolean>>>>;

export const ALL_PERMISSIONS: PermissionKey[] = [
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
];

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

export function defaultPolicyFor(templateType: TemplateType): PermissionPolicy {
  void templateType;
  const policy: PermissionPolicy = {};
  (Object.keys(baseByRole) as MemberRole[]).forEach((role) => {
    policy[role] = {};
    ALL_PERMISSIONS.forEach((perm) => {
      (policy[role] as any)[perm] = baseByRole[role].includes(perm);
    });
  });
  return policy;
}

export function hasPermission(
  templateType: TemplateType,
  role: MemberRole,
  permission: PermissionKey,
  policy?: PermissionPolicy | null,
) {
  const effective = policy ?? defaultPolicyFor(templateType);
  const rolePolicy = effective?.[role] ?? {};
  if (typeof rolePolicy?.[permission] === 'boolean') return !!rolePolicy[permission];
  return baseByRole[role]?.includes(permission) ?? false;
}
