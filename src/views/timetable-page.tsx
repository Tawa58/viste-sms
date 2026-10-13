import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Plus, Send, Trash2 } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'
import { TimetableGrid } from '@/components/shared/timetable-grid'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/contexts/auth-context'
import { hasAppPermission } from '@/lib/roles'
import { notify } from '@/lib/notify'
import { timetableService } from '@/services/api'
import type {
  ClassTimetable,
  PublishTimetableInput,
  TimetableDay,
  TimetableDraftEntry,
  TimetableOptions,
} from '@/types'

const DAYS: { value: TimetableDay; label: string }[] = [
  { value: 'MONDAY', label: 'Monday' },
  { value: 'TUESDAY', label: 'Tuesday' },
  { value: 'WEDNESDAY', label: 'Wednesday' },
  { value: 'THURSDAY', label: 'Thursday' },
  { value: 'FRIDAY', label: 'Friday' },
  { value: 'SATURDAY', label: 'Saturday' },
  { value: 'SUNDAY', label: 'Sunday' },
]

function newEntry(): TimetableDraftEntry {
  return {
    id: crypto.randomUUID(),
    day: 'MONDAY',
    startTime: '08:00',
    endTime: '09:00',
    subjectId: '',
    teacherId: '',
  }
}

export function TimetablePage() {
  const { user, permissions } = useAuth()
  const canPublish = hasAppPermission(permissions, 'classes.manage')
  const isTeacher = user?.role === 'TEACHER'
  const [options, setOptions] = useState<TimetableOptions | null>(null)
  const [schedules, setSchedules] = useState<ClassTimetable[]>([])
  const [classId, setClassId] = useState('')
  const [audience, setAudience] = useState<PublishTimetableInput['audience']>(['STUDENTS'])
  const [entries, setEntries] = useState<TimetableDraftEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        if (canPublish) {
          const [catalog, published] = await Promise.all([
            timetableService.options(),
            timetableService.get(),
          ])
          if (!active) return
          setOptions(catalog)
          setSchedules(published)
          const firstClassId = catalog.classes[0]?.id ?? ''
          setClassId(firstClassId)
          const existing = published.find((row) => row.classId === firstClassId)
          setEntries(existing?.entries ?? [newEntry()])
          setAudience(existing?.audience ?? ['STUDENTS'])
        } else {
          const published = await timetableService.get()
          if (active) setSchedules(published)
        }
      } catch (error) {
        if (active) {
          const message = error instanceof Error ? error.message : 'An unexpected error occurred'
          setLoadError(message)
          notify.error('Could not load timetables', message)
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [canPublish])

  const selectedClass = options?.classes.find((item) => item.id === classId)
  const currentSchedule = schedules.find((row) => row.classId === classId)
  const visibleSchedules = schedules
  const eligibleSubjects = useMemo(
    () =>
      options?.subjects.filter(
        (subject) =>
          !selectedClass?.subjectIds?.length || selectedClass.subjectIds.includes(subject.id),
      ) ?? [],
    [options, selectedClass],
  )

  function selectClass(nextId: string) {
    setClassId(nextId)
    const existing = schedules.find((row) => row.classId === nextId)
    setEntries(existing?.entries ?? [newEntry()])
    setAudience(existing?.audience ?? ['STUDENTS'])
  }

  function updateEntry(id: string, patch: Partial<TimetableDraftEntry>) {
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)))
  }

  function toggleAudience(value: PublishTimetableInput['audience'][number]) {
    setAudience((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    )
  }

  async function publish() {
    if (!classId || entries.length === 0 || audience.length === 0) {
      notify.error('Select a class, add at least one lesson, and choose an audience')
      return
    }
    if (entries.some((entry) => !entry.subjectId || !entry.teacherId)) {
      notify.error('Choose a subject and teacher for every lesson')
      return
    }
    const hasTimeConflict = entries.some(
      (entry, index) =>
        entry.startTime >= entry.endTime ||
        entries.some(
          (other, otherIndex) =>
            otherIndex !== index &&
            other.day === entry.day &&
            other.startTime < entry.endTime &&
            entry.startTime < other.endTime,
        ),
    )
    if (hasTimeConflict) {
      notify.error('Check lesson times', 'Lessons on the same day cannot overlap and end times must be later than start times.')
      return
    }
    setSaving(true)
    try {
      const saved = await timetableService.publish({ classId, audience, entries })
      setSchedules((current) => [...current.filter((item) => item.classId !== saved.classId), saved])
      setEntries(saved.entries)
      notify.success('Timetable published', `${saved.className} timetable is now available in-app.`)
    } catch (error) {
      notify.error('Could not publish timetable', error instanceof Error ? error.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading timetables…</div>
  }

  if (loadError) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Could not load timetables"
        description={loadError}
      />
    )
  }

  if (!canPublish) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="My timetable"
          description={isTeacher ? 'Your published weekly teaching schedule.' : 'Published weekly class schedules.'}
        />
        {visibleSchedules.length ? (
          <TimetableGrid schedules={visibleSchedules} showClass />
        ) : (
          <EmptyState
            icon={CalendarClock}
            title="No timetable published"
            description="Your published timetable will appear here when the school shares it."
          />
        )}
      </div>
    )
  }

  if (!options?.classes.length) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No active classes"
        description="Create an active class before publishing its weekly timetable."
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetables"
        description="Build a weekly class schedule and publish it to student and/or teacher accounts."
      />
      <Card>
        <CardHeader>
          <CardTitle>Weekly class schedule</CardTitle>
          <CardDescription>
            Publishing replaces the selected class’s current schedule and makes it available in-app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="timetable-class">Class</Label>
              <Select id="timetable-class" value={classId} onChange={(event) => selectClass(event.target.value)}>
                {options.classes.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </Select>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Publish to</legend>
              <div className="flex flex-wrap gap-4 pt-2">
                {(['STUDENTS', 'TEACHERS'] as const).map((value) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={audience.includes(value)}
                      onChange={() => toggleAudience(value)}
                    />
                    {value === 'STUDENTS' ? 'Students in this class' : 'Teachers assigned to lessons'}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Lessons</h3>
                <p className="text-sm text-muted-foreground">Set a day, time, subject, and teacher for each lesson.</p>
              </div>
              <Button variant="outline" onClick={() => setEntries((current) => [...current, newEntry()])}>
                <Plus className="mr-2 h-4 w-4" /> Add lesson
              </Button>
            </div>
            <div className="space-y-3">
              {entries.map((entry) => (
                <div key={entry.id} className="grid items-end gap-3 rounded-xl border border-border p-3 md:grid-cols-[1fr_1fr_1fr_1.3fr_1.4fr_auto]">
                  <div className="space-y-2">
                    <Label>Day</Label>
                    <Select value={entry.day} onChange={(event) => updateEntry(entry.id, { day: event.target.value as TimetableDay })}>
                      {DAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Start</Label>
                    <Input type="time" value={entry.startTime} onChange={(event) => updateEntry(entry.id, { startTime: event.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>End</Label>
                    <Input type="time" value={entry.endTime} onChange={(event) => updateEntry(entry.id, { endTime: event.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Subject</Label>
                    <Select value={entry.subjectId} onChange={(event) => updateEntry(entry.id, { subjectId: event.target.value })}>
                      <option value="">Select subject</option>
                      {eligibleSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Teacher</Label>
                    <Select value={entry.teacherId} onChange={(event) => updateEntry(entry.id, { teacherId: event.target.value })}>
                      <option value="">Select teacher</option>
                      {options.teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.firstName} {teacher.lastName}</option>)}
                    </Select>
                  </div>
                  <Button
                    aria-label="Remove lesson"
                    variant="ghost"
                    size="icon"
                    disabled={entries.length === 1}
                    onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <Button disabled={saving} onClick={() => void publish()}>
            <Send className="mr-2 h-4 w-4" />
            {saving ? 'Publishing…' : 'Publish timetable'}
          </Button>
        </CardContent>
      </Card>
      {currentSchedule && (
        <Card>
          <CardHeader>
            <CardTitle>Published timetable · {currentSchedule.className}</CardTitle>
            <CardDescription>
              Available to {currentSchedule.audience.map((item) => item.toLowerCase()).join(' and ')}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TimetableGrid schedules={[currentSchedule]} showClass={false} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
