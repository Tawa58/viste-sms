import 'server-only'

import type { SessionContext } from '@/server/auth/session'
import { requirePermission } from '@/server/authorization/permissions'
import { getDoc, setDoc } from '@/server/repositories/firestore-repo'
import { DEFAULT_TERM_FEES, normalizeTermFees } from '@/lib/fees'
import type { FeePolicy, SchoolProfile } from '@/types'

export const DEFAULT_SCHOOL_PROFILE: SchoolProfile = {
  id: 'schoolProfile',
  name: 'Viste High School',
  motto: 'Excellence in learning',
  address: 'Harare, Zimbabwe',
  phone: '+263 000 000 000',
  email: 'info@viste.school',
  website: '',
  registrationNumber: '',
}

export const DEFAULT_FEE_POLICY: FeePolicy = {
  id: 'feePolicy',
  currency: 'USD',
  receiptPrefix: 'VHS',
  nextReceiptNumber: 1001,
  blockResultsWhenFeesOutstanding: true,
  overdueGraceDays: 14,
  termFees: { ...DEFAULT_TERM_FEES },
}

export async function getSchoolProfile(): Promise<SchoolProfile> {
  const row = await getDoc<SchoolProfile>('settings', 'schoolProfile')
  if (!row) return { ...DEFAULT_SCHOOL_PROFILE }
  return {
    ...DEFAULT_SCHOOL_PROFILE,
    ...row,
    id: 'schoolProfile',
  }
}

export async function getSchoolProfileService(session: SessionContext): Promise<SchoolProfile> {
  requirePermission(session, 'settings.manage')
  return getSchoolProfile()
}

export async function updateSchoolProfileService(
  session: SessionContext,
  input: Omit<SchoolProfile, 'id' | 'updatedAt' | 'updatedBy'>,
): Promise<SchoolProfile> {
  requirePermission(session, 'settings.manage')
  const row: SchoolProfile = {
    id: 'schoolProfile',
    name: input.name.trim(),
    motto: input.motto?.trim() || undefined,
    address: input.address.trim(),
    phone: input.phone.trim(),
    email: input.email.trim().toLowerCase(),
    website: input.website?.trim() || undefined,
    registrationNumber: input.registrationNumber?.trim() || undefined,
    updatedAt: new Date().toISOString(),
    updatedBy: session.uid,
  }
  await setDoc('settings', 'schoolProfile', { ...row })
  return row
}

export async function getFeePolicy(): Promise<FeePolicy> {
  const row = await getDoc<FeePolicy>('settings', 'feePolicy')
  if (!row) return { ...DEFAULT_FEE_POLICY, termFees: { ...DEFAULT_TERM_FEES } }
  return {
    ...DEFAULT_FEE_POLICY,
    ...row,
    termFees: normalizeTermFees(row.termFees),
    id: 'feePolicy',
  }
}

export async function getFeePolicyService(session: SessionContext): Promise<FeePolicy> {
  requirePermission(session, 'fees.read')
  return getFeePolicy()
}

export async function updateFeePolicyService(
  session: SessionContext,
  input: Omit<FeePolicy, 'id' | 'updatedAt' | 'updatedBy' | 'termFees'> & {
    termFees?: FeePolicy['termFees']
  },
): Promise<FeePolicy> {
  requirePermission(session, 'settings.manage')
  const current = input.termFees ? null : await getFeePolicy()
  const row: FeePolicy = {
    id: 'feePolicy',
    currency: input.currency.trim().toUpperCase() || 'USD',
    receiptPrefix: input.receiptPrefix.trim().toUpperCase() || 'VHS',
    nextReceiptNumber: Math.max(1, Math.floor(input.nextReceiptNumber)),
    blockResultsWhenFeesOutstanding: Boolean(input.blockResultsWhenFeesOutstanding),
    overdueGraceDays: Math.max(0, Math.min(365, Math.floor(input.overdueGraceDays))),
    termFees: normalizeTermFees(input.termFees ?? current?.termFees),
    updatedAt: new Date().toISOString(),
    updatedBy: session.uid,
  }
  await setDoc('settings', 'feePolicy', { ...row })
  return row
}
