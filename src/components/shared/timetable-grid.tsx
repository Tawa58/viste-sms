import type { ClassTimetable, TimetableDay, TimetableEntry } from '@/types'

const DAY_ORDER: TimetableDay[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
]

const DAY_LABEL: Record<TimetableDay, string> = {
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
  SATURDAY: 'Saturday',
  SUNDAY: 'Sunday',
}

export function TimetableGrid({
  schedules,
  showClass = true,
}: {
  schedules: ClassTimetable[]
  showClass?: boolean
}) {
  const rows = schedules
    .flatMap((schedule) =>
      schedule.entries.map((entry) => ({
        ...entry,
        className: schedule.className,
      })),
    )
    .sort(
      (a, b) =>
        DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) ||
        a.startTime.localeCompare(b.startTime),
    )
  const columns = ['Day', 'Time', 'Subject', ...(showClass ? ['Class'] : []), 'Teacher']

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[38rem] text-left text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-4 py-3 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((entry, index) => (
            <TimetableRow
              key={`${entry.day}-${entry.startTime}-${entry.subjectId}-${index}`}
              entry={entry}
              showClass={showClass}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TimetableRow({
  entry,
  showClass,
}: {
  entry: TimetableEntry & { className: string }
  showClass: boolean
}) {
  return (
    <tr>
      <td className="whitespace-nowrap px-4 py-3 font-medium">{DAY_LABEL[entry.day]}</td>
      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
        {entry.startTime}–{entry.endTime}
      </td>
      <td className="px-4 py-3 font-medium">{entry.subjectName}</td>
      {showClass && <td className="px-4 py-3">{entry.className}</td>}
      <td className="px-4 py-3">{entry.teacherName}</td>
    </tr>
  )
}
