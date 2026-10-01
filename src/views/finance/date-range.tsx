import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatDate } from '@/lib/utils'

export type RangePreset = 'today' | 'this-month' | 'last-month' | 'this-year' | 'last-year' | 'custom'

const PRESET_LABEL: Record<RangePreset, string> = {
  today: 'Today',
  'this-month': 'This month',
  'last-month': 'Last month',
  'this-year': 'This year',
  'last-year': 'Last year',
  custom: 'Custom range',
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function presetDates(preset: Exclude<RangePreset, 'custom'>) {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  switch (preset) {
    case 'today':
      return { from: iso(now), to: iso(now) }
    case 'this-month':
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) }
    case 'last-month':
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) }
    case 'this-year':
      return { from: `${y}-01-01`, to: `${y}-12-31` }
    case 'last-year':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
  }
}

export function usePresetRange(initial: Exclude<RangePreset, 'custom'>) {
  const [preset, setPresetState] = useState<RangePreset>(initial)
  const [dates, setDates] = useState(() => presetDates(initial))
  return {
    preset,
    from: dates.from,
    to: dates.to,
    setPreset(next: RangePreset) {
      setPresetState(next)
      if (next !== 'custom') setDates(presetDates(next))
    },
    setFrom(from: string) {
      setPresetState('custom')
      setDates((d) => ({ ...d, from }))
    },
    setTo(to: string) {
      setPresetState('custom')
      setDates((d) => ({ ...d, to }))
    },
  }
}

export type PresetRange = ReturnType<typeof usePresetRange>

export function rangeLabel(range: Pick<PresetRange, 'preset' | 'from' | 'to'>) {
  if (range.preset !== 'custom') return PRESET_LABEL[range.preset]
  return range.from === range.to
    ? formatDate(range.from)
    : `${formatDate(range.from)} – ${formatDate(range.to)}`
}

export function DateRangeFilter({ range }: { range: PresetRange }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Select
        aria-label="Period"
        value={range.preset}
        onChange={(e) => range.setPreset(e.target.value as RangePreset)}
        className="w-40"
      >
        {(Object.keys(PRESET_LABEL) as RangePreset[]).map((p) => (
          <option key={p} value={p}>
            {PRESET_LABEL[p]}
          </option>
        ))}
      </Select>
      <Input
        type="date"
        aria-label="From"
        value={range.from}
        max={range.to}
        onChange={(e) => e.target.value && range.setFrom(e.target.value)}
        className="w-40"
      />
      <span className="text-sm text-muted-foreground">to</span>
      <Input
        type="date"
        aria-label="To"
        value={range.to}
        min={range.from}
        onChange={(e) => e.target.value && range.setTo(e.target.value)}
        className="w-40"
      />
    </div>
  )
}
