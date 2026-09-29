import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { money, shortDate } from '@/components/student-portal/portal-ui'
import { useStudentPortal } from '@/contexts/student-portal-context'
import { cn } from '@/lib/utils'
import type { StudentPortalBundle } from '@/types'

type PortalNotice = {
  id: string
  title: string
  body: string
  href: string
  date?: string
}

function buildNotices(data: StudentPortalBundle): PortalNotice[] {
  const notices: PortalNotice[] = []
  const { results, fees } = data

  if (results.accessState === 'RESULTS_LOCKED_FEES') {
    notices.push({
      id: 'results-locked',
      title: 'Results are locked',
      body: 'Your results are ready but stay hidden until outstanding fees are cleared.',
      href: '/my/fees',
    })
  } else if (results.accessState === 'RESULTS_AVAILABLE') {
    const latest = results.monthly?.[0] ?? null
    const term = results.termly?.[0] ?? null
    if (latest) {
      notices.push({
        id: `results-month-${latest.month}`,
        title: `${latest.label} results released`,
        body:
          latest.average != null
            ? `You averaged ${latest.average.toFixed(1)}% across ${latest.rows.length} subjects.`
            : `${latest.rows.length} subjects have published marks.`,
        href: '/my/results',
      })
    }
    if (term) {
      notices.push({
        id: `results-term-${term.termId}`,
        title: `${term.termName} report available`,
        body: 'Your end-of-term results and teacher comments are ready.',
        href: '/my/results',
      })
    }
  }

  if (fees.balance > 0) {
    notices.push({
      id: `fees-${fees.balance}-${fees.nextDueDate ?? ''}`,
      title: 'Fees balance outstanding',
      body: `${money(fees.balance, fees.currency)} is still owed${
        fees.nextDueDate ? `, due ${shortDate(fees.nextDueDate)}` : ''
      }.`,
      href: '/my/fees',
      date: fees.nextDueDate,
    })
  }

  for (const a of data.announcements.slice(0, 5)) {
    notices.push({
      id: `announcement-${a.id}`,
      title: a.title,
      body: a.body,
      href: '/my/announcements',
      date: a.publishedAt,
    })
  }
  return notices
}

function storageKey(studentId: string) {
  return `viste.student-notices.read.${studentId}`
}

function loadRead(studentId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(studentId))
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveRead(studentId: string, ids: Set<string>) {
  try {
    localStorage.setItem(storageKey(studentId), JSON.stringify([...ids].slice(-200)))
  } catch {
    /* private mode */
  }
}

/** Header bell for students: results, fees, and announcements from their portal. */
export function StudentNotificationsBell() {
  const navigate = useNavigate()
  const { data } = useStudentPortal()
  const studentId = data?.profile.id ?? ''
  const notices = useMemo(() => (data ? buildNotices(data) : []), [data])
  const [read, setRead] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (studentId) setRead(loadRead(studentId))
  }, [studentId])

  const unread = notices.filter((n) => !read.has(n.id)).length

  function markRead(ids: string[]) {
    const next = new Set(read)
    for (const id of ids) next.add(id)
    setRead(next)
    if (studentId) saveRead(studentId, next)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell />
          {unread > 0 ? (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[70dvh] w-[min(24rem,calc(100vw-1rem))] overflow-y-auto"
      >
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unread > 0 ? (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => markRead(notices.map((n) => n.id))}
            >
              Mark all read
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {notices.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">You're all caught up.</p>
        ) : (
          notices.map((item) => (
            <DropdownMenuItem
              key={item.id}
              className={cn(
                'flex cursor-pointer flex-col items-start gap-1 whitespace-normal py-2.5',
                !read.has(item.id) && 'bg-accent/10',
              )}
              onClick={() => {
                markRead([item.id])
                navigate(item.href)
              }}
            >
              <span className="text-sm font-medium leading-snug">{item.title}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{item.body}</span>
              {item.date ? (
                <span className="text-[10px] text-muted-foreground">{shortDate(item.date)}</span>
              ) : null}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
