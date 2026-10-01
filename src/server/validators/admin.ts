import { z } from 'zod'
import { isPermission } from '@/server/authorization/rbac-map'

const permissionSchema = z.string().refine((v) => isPermission(v), 'Unknown permission')

export const adminRolesSchema = z.enum([
  'SCHOOL_ADMIN',
  'PRINCIPAL',
  'ACCOUNTANT',
  'FINANCE_OFFICER',
  'FINANCE_VIEWER',
  'HR_ADMIN',
  'REGISTRAR',
  'RECEPTIONIST',
  'LIBRARIAN',
  'TRANSPORT_MANAGER',
  'TEACHER',
])

export const userCreateSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  role: adminRolesSchema,
  title: z.string().max(120).optional().or(z.literal('')),
})

export const userUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  role: adminRolesSchema.optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  title: z.string().max(120).optional().or(z.literal('')),
})

export const roleMatrixUpdateSchema = z.object({
  role: adminRolesSchema,
  /** Desired effective permissions for this role (server computes grant/deny vs baseline). */
  permissions: z.array(permissionSchema).min(0),
})

export const authActivitySchema = z.object({
  event: z.enum(['login', 'logout']),
})

export type UserCreateInput = z.infer<typeof userCreateSchema>
export type UserUpdateInput = z.infer<typeof userUpdateSchema>
export type RoleMatrixUpdateInput = z.infer<typeof roleMatrixUpdateSchema>
