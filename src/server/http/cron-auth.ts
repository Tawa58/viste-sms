import { forbidden } from '@/server/errors'

export function assertCronAuthorized(request: Request) {
  // Vercel Cron invocations include this header
  if (request.headers.get('x-vercel-cron') === '1') return

  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
      throw forbidden('CRON_SECRET is not configured')
    }
    return
  }
  const auth = request.headers.get('authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const url = new URL(request.url)
  const querySecret = url.searchParams.get('secret') ?? ''
  if (bearer !== secret && querySecret !== secret) {
    throw forbidden('Invalid cron credentials')
  }
}
