import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { EXIT_REASONS } from '@/lib/checkin'
import { cn } from '@/lib/utils'

/** "Why did you leave?" prompt shown when a checked-in staff member leaves the premises. */
export function ExitReasonDialog({
  open,
  firstName,
  timeOut,
  leftAt,
  saving,
  onSubmit,
  onClose,
}: {
  open: boolean
  firstName: string
  timeOut: string
  leftAt: string
  saving: boolean
  onSubmit: (reason: string, note?: string) => Promise<void>
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setReason('')
    setNote('')
    setError('')
  }, [open])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = note.trim()
    if (!reason) return setError('Choose a reason.')
    if (reason === 'Other' && !trimmed) return setError('Describe why you left.')
    setError('')
    try {
      await onSubmit(reason, trimmed || undefined)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not save the reason.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{firstName}, why did you leave?</DialogTitle>
          <DialogDescription>
            You left the school premises at {leftAt} and have been out for{' '}
            <span className="font-semibold tabular-nums text-foreground">{timeOut}</span>. The reason
            is shared with the school administration.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {EXIT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                aria-pressed={reason === r}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors',
                  reason === r ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted/40',
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <Field>
            <Label htmlFor="exit-note">
              Note {reason === 'Other' ? '' : <span className="text-muted-foreground">(optional)</span>}
            </Label>
            <Textarea
              id="exit-note"
              value={note}
              maxLength={300}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Collecting exam papers from the district office"
            />
          </Field>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              Later
            </Button>
            <Button type="submit" loading={saving}>
              Save reason
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
