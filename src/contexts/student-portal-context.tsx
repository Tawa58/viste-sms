import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { studentPortalService } from '@/services/student-portal'
import type { StudentPortalBundle } from '@/types'

type StudentPortalState = {
  data: StudentPortalBundle | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

const StudentPortalContext = createContext<StudentPortalState | null>(null)

/** Loads the signed-in student's portal once and shares it with the shell and every portal page. */
export function StudentPortalProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const [data, setData] = useState<StudentPortalBundle | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      setData(await studentPortalService.get())
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not load your portal')
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      setData(null)
      setLoading(false)
      return
    }
    void reload()
  }, [enabled, reload])

  return (
    <StudentPortalContext.Provider value={{ data, loading, error, reload }}>
      {children}
    </StudentPortalContext.Provider>
  )
}

export function useStudentPortal(): StudentPortalState {
  const ctx = useContext(StudentPortalContext)
  if (!ctx) throw new Error('useStudentPortal must be used inside StudentPortalProvider')
  return ctx
}
