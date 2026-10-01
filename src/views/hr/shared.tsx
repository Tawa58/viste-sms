import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { FileSpreadsheet, FileText } from 'lucide-react'
import { Pagination } from '@/components/shared/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/auth-context'
import { HR_STATUS_LABEL, PAYROLL_STATUS_LABEL, formatMoney } from '@/lib/hr/constants'
import { periodEnd } from '@/lib/hr/payroll-engine'
import { cn } from '@/lib/utils'
import { listPermissions, type Permission } from '@/server/authorization/rbac-map'
import { hrService } from '@/services/hr'
import type { HrStaffStatus, PayrollSchoolInfo, PayrollStatus, SalaryScaleStatus } from '@/types'

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function yearOptions(back = 4, ahead = 1) {
  const now = new Date().getFullYear()
  return Array.from({ length: back + ahead + 1 }, (_, i) => now + ahead - i)
}

export function currentPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function periodRange(period: string) {
  return { from: `${period}-01`, to: periodEnd(period) }
}

export function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function errorText(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback
}

/** Permission check that also works in demo mode, where the session carries no permission list. */
export function useHrAccess() {
  const { user, permissions } = useAuth()
  return useMemo(() => {
    const effective: readonly string[] = permissions.length
      ? permissions
      : user
        ? listPermissions(user.role)
        : []
    return (permission: Permission) => effective.includes(permission)
  }, [permissions, user])
}

export function usePaged<T>(rows: T[], pageSize = 12) {
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])
  const pageRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  )
  return { page, setPage, pageCount, pageRows }
}

export function TablePager({
  page,
  pageCount,
  onPageChange,
  total,
  noun,
  plural = `${noun}s`,
}: {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  total: number
  noun: string
  plural?: string
}) {
  if (pageCount <= 1) {
    return (
      <p className="pt-3 text-xs text-muted-foreground">
        {total} {total === 1 ? noun : plural}
      </p>
    )
  }
  return <Pagination page={page} pageCount={pageCount} onPageChange={onPageChange} />
}

/** School letterhead for PDF exports, fetched once per page. */
export function useLetterhead() {
  const [school, setSchool] = useState<PayrollSchoolInfo>({ name: 'Viste School' })
  useEffect(() => {
    hrService
      .getSchool()
      .then(setSchool)
      .catch(() => undefined)
  }, [])
  return school
}

export function Money({ value, className }: { value: number; className?: string }) {
  return <span className={cn('tabular-nums', className)}>{formatMoney(value)}</span>
}

export function ExportButtons({
  onPdf,
  onExcel,
  disabled,
}: {
  onPdf: () => void | Promise<void>
  onExcel: () => void | Promise<void>
  disabled?: boolean
}) {
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null)
  async function run(kind: 'pdf' | 'xlsx', fn: () => void | Promise<void>) {
    setBusy(kind)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || busy !== null}
        loading={busy === 'pdf'}
        onClick={() => void run('pdf', onPdf)}
      >
        <FileText className="h-4 w-4" />
        PDF
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || busy !== null}
        loading={busy === 'xlsx'}
        onClick={() => void run('xlsx', onExcel)}
      >
        <FileSpreadsheet className="h-4 w-4" />
        Excel
      </Button>
    </>
  )
}

const STAFF_STATUS_VARIANT: Record<HrStaffStatus, 'success' | 'warning' | 'danger' | 'secondary'> = {
  ACTIVE: 'success',
  ON_LEAVE: 'warning',
  SUSPENDED: 'danger',
  RESIGNED: 'secondary',
}

export function StaffStatusBadge({ status }: { status: HrStaffStatus }) {
  return <Badge variant={STAFF_STATUS_VARIANT[status]}>{HR_STATUS_LABEL[status]}</Badge>
}

export function ScaleStatusBadge({ status }: { status: SalaryScaleStatus }) {
  return (
    <Badge variant={status === 'ACTIVE' ? 'success' : 'secondary'}>
      {status === 'ACTIVE' ? 'Active' : 'Inactive'}
    </Badge>
  )
}

const PAYROLL_VARIANT: Record<PayrollStatus, 'warning' | 'accent' | 'success'> = {
  DRAFT: 'warning',
  APPROVED: 'accent',
  LOCKED: 'success',
}

export function PayrollStatusBadge({ status }: { status: PayrollStatus }) {
  return <Badge variant={PAYROLL_VARIANT[status]}>{PAYROLL_STATUS_LABEL[status]}</Badge>
}

export function SectionNote({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  )
}
