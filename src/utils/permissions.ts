export type PermissionKey =
  | 'DOC_CREATE'
  | 'DOC_APPROVE'
  | 'DOC_EXECUTE'
  | 'REPORTS_VIEW'
  | 'USERS_MANAGE'
  | 'DOC_DELETE'
  | 'INCOMING_MANAGE'
  | 'TEMPLATES_MANAGE'
  | 'ASSIGN_TASK';

export const DEFAULT_ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  ADMIN: [
    'DOC_CREATE',
    'DOC_APPROVE',
    'DOC_EXECUTE',
    'REPORTS_VIEW',
    'USERS_MANAGE',
    'DOC_DELETE',
    'INCOMING_MANAGE',
    'TEMPLATES_MANAGE',
    'ASSIGN_TASK',
  ],
  INITIATOR: ['DOC_CREATE', 'DOC_EXECUTE', 'TEMPLATES_MANAGE'],
  APPROVER: ['DOC_APPROVE', 'DOC_EXECUTE'],
  EXECUTOR: ['DOC_EXECUTE'],
  SECRETARY: ['DOC_CREATE', 'DOC_EXECUTE', 'INCOMING_MANAGE', 'TEMPLATES_MANAGE'],
};

export const parsePermissions = (role: string, permissionsRaw?: string | null): PermissionKey[] => {
  if (role === 'ADMIN') {
    return DEFAULT_ROLE_PERMISSIONS.ADMIN;
  }

  try {
    if (permissionsRaw) {
      const parsed = JSON.parse(permissionsRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as PermissionKey[];
      }
    }
  } catch {
    // Fallback to role defaults
  }

  return DEFAULT_ROLE_PERMISSIONS[role] || ['DOC_EXECUTE'];
};

export const hasPermission = (
  user: { role: string; permissions?: string | string[] | null } | null | undefined,
  perm: PermissionKey
): boolean => {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;

  if (Array.isArray(user.permissions)) {
    return user.permissions.includes(perm);
  }

  const parsed = parsePermissions(user.role, typeof user.permissions === 'string' ? user.permissions : null);
  return parsed.includes(perm);
};
