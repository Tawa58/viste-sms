import { useCallback, useEffect, useState } from 'react'
import { Copy, KeyRound, Printer, RefreshCw, ShieldOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { copyText, isAndroidApp, printHtmlInApp } from '@/lib/native-app'
import { notify } from '@/lib/notify'
import { formatDate } from '@/lib/utils'
import { formatPortalMonth } from '@/lib/student-portal'
import { studentService } from '@/services/api'
import type { StudentPortalAccess, StudentPortalStatus } from '@/types'

const STATUS_BADGE: Record<
  StudentPortalStatus,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'outline' }
> = {
  ACTIVE: { label: 'Active', variant: 'success' },
  EXPIRED: { label: 'Expired', variant: 'warning' },
  REVOKED: { label: 'Revoked', variant: 'danger' },
  NONE: { label: 'No code issued', variant: 'outline' },
}

export type PortalSlip = {
  name: string
  studentNumber: string
  code: string
  expiresAt?: string
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

/** Open a printable sheet of cut-out login slips. */
export function printPortalSlips(slips: PortalSlip[], title = 'Student portal codes') {
  const win = isAndroidApp() ? null : window.open('', '_blank', 'width=820,height=900')
  if (!win && !isAndroidApp()) {
    notify.error('Allow pop-ups to print portal codes')
    return
  }
  const portalUrl = window.location.origin
  const cards = slips
    .map(
      (s) => `
      <div class="slip">
        <div class="school">Viste High School · Student portal</div>
        <div class="name">${escapeHtml(s.name)}</div>
        <div class="row"><span>Student number</span><b>${escapeHtml(s.studentNumber)}</b></div>
        <div class="row"><span>Portal code</span><b class="code">${escapeHtml(s.code)}</b></div>
        ${s.expiresAt ? `<div class="row"><span>Valid until</span><b>${escapeHtml(new Date(new Date(s.expiresAt).getTime() - 1).toLocaleDateString('en-GB'))}</b></div>` : ''}
        <div class="hint">Sign in at ${escapeHtml(portalUrl)} with your student number and this code. Keep it private.</div>
      </div>`,
    )
    .join('')
  const html = `<!doctype html><html><head><title>${escapeHtml(title)}</title>
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:16px;color:#0b1b2b}
      h1{font-size:16px;margin:0 0 12px}
      .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
      .slip{border:1px dashed #6b7c8f;border-radius:10px;padding:12px;break-inside:avoid}
      .school{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#52657a}
      .name{font-weight:600;font-size:14px;margin:4px 0 8px}
      .row{display:flex;justify-content:space-between;font-size:12px;margin:3px 0}
      .code{font-family:ui-monospace,Consolas,monospace;font-size:16px;letter-spacing:.12em}
      .hint{font-size:10px;color:#52657a;margin-top:8px}
      @media print{body{margin:8mm}h1{display:none}}
    </style></head><body><h1>${escapeHtml(title)}</h1><div class="grid">${cards}</div>
    <script>window.onload=function(){window.print()}</script></body></html>`
  if (!win) {
    printHtmlInApp(html, title)
    return
  }
  win.document.write(html)
  win.document.close()
}

export function StudentPortalAccessCard({
  studentId,
  studentName,
}: {
  studentId: string
  studentName: string
}) {
  const [access, setAccess] = useState<StudentPortalAccess | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!studentService.getPortalAccess) {
      setLoading(false)
      return
    }
    try {
      setAccess(await studentService.getPortalAccess(studentId))
    } catch {
      setAccess(null)
    } finally {
      setLoading(false)
    }
  }, [studentId])

  useEffect(() => {
    void load()
  }, [load])

  async function issue() {
    if (!studentService.issuePortalCode) return
    setBusy(true)
    try {
      const next = await notify.process(() => studentService.issuePortalCode!(studentId), {
        loading: 'Generating portal code…',
        success: 'Portal code ready for this month',
      })
      setAccess(next)
    } catch {
      /* toast already shown */
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    if (!studentService.revokePortalAccess) return
    if (!window.confirm(`Revoke portal access for ${studentName}? They will be signed out.`)) return
    setBusy(true)
    try {
      const next = await notify.process(() => studentService.revokePortalAccess!(studentId), {
        loading: 'Revoking access…',
        success: 'Portal access revoked',
      })
      setAccess(next)
    } catch {
      /* toast already shown */
    } finally {
      setBusy(false)
    }
  }

  async function copyCode(code: string) {
    try {
      await copyText(code)
      notify.success('Code copied')
    } catch {
      notify.error('Could not copy code')
    }
  }

  if (!studentService.getPortalAccess) return null

  const status = access?.status ?? 'NONE'
  const badge = STATUS_BADGE[status]
  const hasLogin = status !== 'NONE'

  return (
    <section className="space-y-3 border-t border-border/60 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <KeyRound className="h-3.5 w-3.5" />
          Student portal login
        </h3>
        {!loading ? <Badge variant={badge.variant}>{badge.label}</Badge> : null}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Checking portal access…</p>
      ) : !access ? (
        <p className="text-sm text-muted-foreground">Portal access details are unavailable.</p>
      ) : (
        <>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Student number (username)</dt>
              <dd className="font-medium">{access.studentNumber}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Portal code</dt>
              <dd className="flex items-center gap-2">
                {access.code && status === 'ACTIVE' ? (
                  <>
                    <span className="font-mono text-base font-semibold tracking-[0.14em]">
                      {access.code}
                    </span>
                    <button
                      type="button"
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                      onClick={() => void copyCode(access.code!)}
                      aria-label="Copy code"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : access.codeChangedByStudent && status === 'ACTIVE' ? (
                  <span className="text-muted-foreground">Changed by student</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
            </div>
            {access.validMonth ? (
              <div>
                <dt className="text-muted-foreground">Valid for</dt>
                <dd>
                  {formatPortalMonth(access.validMonth)}
                  {access.issuedAt ? (
                    <span className="text-muted-foreground">
                      {' '}
                      · issued {formatDate(access.issuedAt)}
                      {access.issuedByName ? ` by ${access.issuedByName}` : ''}
                    </span>
                  ) : null}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted-foreground">Fees</dt>
              <dd className={access.feeCleared ? 'text-success' : 'text-warning'}>
                {access.feeCleared ? 'Cleared' : access.feeMessage ?? 'Not cleared'}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              loading={busy}
              disabled={!access.feeCleared}
              onClick={() => void issue()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {status === 'ACTIVE' ? 'Regenerate code' : 'Generate code'}
            </Button>
            {access.code && status === 'ACTIVE' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  printPortalSlips(
                    [
                      {
                        name: studentName,
                        studentNumber: access.studentNumber,
                        code: access.code!,
                        expiresAt: access.expiresAt,
                      },
                    ],
                    `Portal code · ${studentName}`,
                  )
                }
              >
                <Printer className="h-3.5 w-3.5" />
                Print slip
              </Button>
            ) : null}
            {hasLogin && status !== 'REVOKED' ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void revoke()}>
                <ShieldOff className="h-3.5 w-3.5" />
                Revoke
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Students sign in with their student number and this code. Codes expire at the end of
            each month and can only be issued once fees are cleared.
          </p>
        </>
      )}
    </section>
  )
}
