import type { ReactNode } from 'react'
import { useState } from 'react'
import { Check, Copy, Eye, EyeOff, KeyRound, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { copyText } from '@/lib/native-app'
import { notify } from '@/lib/notify'
import type { StaffLoginCredential } from '@/types'

export function LoginCredentialsCard({
  credential,
  staffName,
  onReset,
  className,
}: {
  credential?: StaffLoginCredential | null
  staffName: string
  onReset?: () => Promise<void> | void
  className?: string
}) {
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState<'email' | 'password' | null>(null)
  const [resetting, setResetting] = useState(false)

  if (!credential) {
    return (
      <div className={cn('rounded-2xl border border-dashed border-border bg-muted/20 p-4', className)}>
        <p className="text-sm font-medium">No login account yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Create or reset credentials so {staffName} can sign in.
        </p>
        {onReset ? (
          <Button
            className="mt-3"
            size="sm"
            loading={resetting}
            onClick={() => {
              void (async () => {
                setResetting(true)
                try {
                  await onReset()
                } finally {
                  setResetting(false)
                }
              })()
            }}
          >
            <KeyRound className="h-3.5 w-3.5" />
            Issue login
          </Button>
        ) : null}
      </div>
    )
  }

  async function copy(value: string, kind: 'email' | 'password') {
    try {
      await copyText(value)
      setCopied(kind)
      notify.success(kind === 'email' ? 'Email copied' : 'Password copied')
      window.setTimeout(() => setCopied(null), 1500)
    } catch {
      notify.error('Could not copy to clipboard')
    }
  }

  return (
    <div className={cn('rounded-2xl border border-border/80 bg-card p-4 shadow-card', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Portal login
          </p>
          <p className="mt-1 font-display text-base font-semibold">{staffName}</p>
        </div>
        {credential.temporaryPassword ? (
          <span
            className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning"
            title="Admin-issued password — teacher should change it under Settings → Security after first sign-in"
          >
            Temp password
          </span>
        ) : (
          <span
            className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success"
            title="Teacher set their own password — not visible to admins"
          >
            Own password
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        <CredentialRow
          label="Email / username"
          value={credential.email}
          copied={copied === 'email'}
          onCopy={() => void copy(credential.email, 'email')}
        />
        <CredentialRow
          label="Password"
          value={
            !credential.password
              ? 'Hidden after first sign-in — reset to issue a new one'
              : visible
                ? credential.password
                : '••••••••'
          }
          copied={copied === 'password'}
          onCopy={() => {
            if (!credential.password) {
              notify.error('No recoverable password', 'Reset the password to issue a new one.')
              return
            }
            void copy(credential.password, 'password')
          }}
          trailing={
            credential.password ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setVisible((v) => !v)}
                aria-label={visible ? 'Hide password' : 'Show password'}
              >
                {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            ) : undefined
          }
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {credential.lastResetAt ? `Last reset ${credential.lastResetAt}` : 'Never reset'}
        </span>
        {onReset ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={resetting}
            onClick={() => {
              void (async () => {
                setResetting(true)
                try {
                  await onReset()
                } finally {
                  setResetting(false)
                }
              })()
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reset password
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function CredentialRow({
  label,
  value,
  onCopy,
  copied,
  trailing,
}: {
  label: string
  value: string
  onCopy: () => void
  copied: boolean
  trailing?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-1">
        <code className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{value}</code>
        {trailing}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onCopy}
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  )
}
