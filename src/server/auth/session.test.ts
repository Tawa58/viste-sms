import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  assertStaffAccountActive,
  getAdminAuth,
  getAdminDb,
  getRoleOverrides,
  isAdminConfigured,
} = vi.hoisted(() => ({
  assertStaffAccountActive: vi.fn(),
  getAdminAuth: vi.fn(),
  getAdminDb: vi.fn(),
  getRoleOverrides: vi.fn(),
  isAdminConfigured: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/firebase/admin', () => ({
  getAdminAuth,
  getAdminDb,
  isAdminConfigured,
}))
vi.mock('@/server/services/admin-users-service', () => ({
  getRoleOverrides,
}))
vi.mock('@/server/services/staff-service', () => ({
  assertStaffAccountActive,
}))

import { verifyBearerToken } from '@/server/auth/session'

describe('verifyBearerToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRoleOverrides.mockResolvedValue(null)
    assertStaffAccountActive.mockResolvedValue(null)
  })

  it('returns unauthorized without initializing Firebase Admin when no token is present', async () => {
    const request = new Request('https://example.test/api/v1/auth/me')

    await expect(verifyBearerToken(request)).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
    })
    expect(isAdminConfigured).not.toHaveBeenCalled()
    expect(getAdminAuth).not.toHaveBeenCalled()
  })

  it('returns service unavailable when Firebase Admin is not configured', async () => {
    isAdminConfigured.mockReturnValue(false)
    const request = new Request('https://example.test/api/v1/auth/me', {
      headers: { Authorization: 'Bearer valid-token' },
    })

    await expect(verifyBearerToken(request)).rejects.toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
    })
    expect(getAdminAuth).not.toHaveBeenCalled()
  })

  it('resolves an authenticated user and role from Firebase Auth and Firestore', async () => {
    isAdminConfigured.mockReturnValue(true)
    getAdminAuth.mockReturnValue({
      verifyIdToken: vi.fn().mockResolvedValue({
        uid: 'user-1',
        email: 'admin@example.test',
        name: 'Admin',
        auth_time: 123,
      }),
    })
    getAdminDb.mockReturnValue({
      collection: vi.fn((name: string) => ({
        doc: vi.fn((id: string) => ({
          get: vi.fn().mockResolvedValue(
            name === 'users' && id === 'user-1'
              ? {
                  exists: true,
                  data: () => ({
                    email: 'admin@example.test',
                    name: 'Admin',
                    role: 'SCHOOL_ADMIN',
                  }),
                }
              : { exists: false },
          ),
        })),
      })),
    })
    const request = new Request('https://example.test/api/v1/auth/me', {
      headers: { Authorization: 'Bearer valid-token' },
    })

    const session = await verifyBearerToken(request)

    expect(session.uid).toBe('user-1')
    expect(session.role).toBe('SCHOOL_ADMIN')
    expect(session.profile.email).toBe('admin@example.test')
    expect(session.permissions).toContain('students.read')
  })

  it('keeps authentication available when optional staff and permission data is malformed', async () => {
    isAdminConfigured.mockReturnValue(true)
    getAdminAuth.mockReturnValue({
      verifyIdToken: vi.fn().mockResolvedValue({
        uid: 'staff-user-1',
        email: 'teacher@example.test',
        name: 'Teacher',
      }),
    })
    getAdminDb.mockReturnValue({
      collection: vi.fn((name: string) => ({
        doc: vi.fn((id: string) => ({
          get: vi.fn().mockResolvedValue(
            name === 'users' && id === 'staff-user-1'
              ? {
                  exists: true,
                  data: () => ({
                    email: 'teacher@example.test',
                    name: 'Teacher',
                    role: 'TEACHER',
                    staffId: 'staff-1',
                  }),
                }
              : { exists: false },
          ),
        })),
      })),
    })
    assertStaffAccountActive.mockResolvedValue({
      accountRole: 'TEACHER',
      permissionOverrides: { grant: { invalid: true }, deny: null },
    })
    getRoleOverrides.mockResolvedValue({
      grant: { invalid: true },
      deny: null,
    })
    const request = new Request('https://example.test/api/v1/auth/me', {
      headers: { Authorization: ['Bearer', 'token'].join(' ') },
    })

    const session = await verifyBearerToken(request)

    expect(session.profile.role).toBe('TEACHER')
    expect(session.permissions).toContain('attendance.read')
    expect(session.permissions).not.toContain('fees.read')
  })
})
