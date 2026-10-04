import 'server-only'

import { toErrorResponse } from '@/server/errors'
import { isAdminConfigured } from '@/lib/firebase/admin'
import { badRequest, serviceUnavailable } from '@/server/errors'

export type RouteParams = Record<string, string | string[] | undefined>

export type ApiHandler = (
  request: Request,
  ctx: { params: Promise<RouteParams>; requestId: string },
) => Promise<Response>

type ApiHandlerOptions = {
  requireAdmin?: boolean
}

/** Normalize a dynamic route param to a single string. */
export function routeParam(
  params: RouteParams,
  key: string,
): string {
  const raw = params[key]
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) throw badRequest(`Missing route param: ${key}`)
  return value
}

export function withApiHandler(
  handler: ApiHandler,
  options: ApiHandlerOptions = {},
): (
  request: Request,
  ctx: { params: Promise<RouteParams> },
) => Promise<Response> {
  return async (request, ctx) => {
    const requestId = crypto.randomUUID()
    try {
      if (options.requireAdmin !== false && !isAdminConfigured()) {
        throw serviceUnavailable(
          'Server database access is not configured (Firebase Admin credentials missing)',
        )
      }
      const response = await handler(request, { ...ctx, requestId })
      const headers = new Headers(response.headers)
      headers.set('x-request-id', requestId)
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    } catch (err) {
      const { status, body } = toErrorResponse(err, requestId)
      return Response.json(body, {
        status,
        headers: { 'x-request-id': requestId },
      })
    }
  }
}

export function jsonOk<T>(data: T, init?: { status?: number }) {
  return Response.json({ data }, { status: init?.status ?? 200 })
}

export function jsonCreated<T>(data: T) {
  return Response.json({ data }, { status: 201 })
}
