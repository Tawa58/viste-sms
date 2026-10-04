import 'server-only'

import { forbidden } from '@/server/errors'
import type { SessionContext } from '@/server/auth/session'
import {
  hasPermission as roleHasPermission,
  listPermissions as listRolePermissions,
  normalizePermissionOverrides,
  resolveEffectivePermissions,
  ROLE_PERMISSIONS,
  PERMISSIONS,
  TEACHER_ASSIGNABLE_PERMISSIONS,
  TEACHER_PERMISSION_GROUPS,
  overridesFromTeacherSelection,
  pathAllowedByPermissions,
  type Permission,
  type PermissionOverrides,
} from '@/server/authorization/rbac-map'

export {
  roleHasPermission as hasPermission,
  listRolePermissions as listPermissions,
  normalizePermissionOverrides,
  resolveEffectivePermissions,
  ROLE_PERMISSIONS,
  PERMISSIONS,
  TEACHER_ASSIGNABLE_PERMISSIONS,
  TEACHER_PERMISSION_GROUPS,
  overridesFromTeacherSelection,
  pathAllowedByPermissions,
  type Permission,
  type PermissionOverrides,
}

export function sessionPermissions(session: SessionContext): Permission[] {
  if (session.permissions?.length) return session.permissions
  return listRolePermissions(session.role)
}

export function sessionHasPermission(session: SessionContext, permission: Permission): boolean {
  return sessionPermissions(session).includes(permission)
}

export function requirePermission(session: SessionContext, permission: Permission): void {
  if (!sessionHasPermission(session, permission)) {
    throw forbidden(`Missing permission: ${permission}`)
  }
}
