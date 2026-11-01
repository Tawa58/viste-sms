import 'server-only'

import {
  FieldPath,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
  type WhereFilterOp,
} from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebase/admin'

export type WhereClause = {
  field: string
  op: WhereFilterOp
  value: unknown
}

export type ListOptions = {
  limit?: number
  orderBy?: string
  orderDirection?: 'asc' | 'desc'
  cursor?: string
  where?: WhereClause[]
}

export type ListResult<T> = {
  items: T[]
  nextCursor: string | null
}

function applyQuery(collection: string, opts?: ListOptions): Query {
  const db = getAdminDb()
  let q: Query = db.collection(collection)

  if (opts?.where) {
    for (const clause of opts.where) {
      q = q.where(clause.field, clause.op, clause.value)
    }
  }

  if (opts?.orderBy) {
    q = q.orderBy(opts.orderBy, opts.orderDirection ?? 'asc')
  }

  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100)
  q = q.limit(limit)

  return q
}

export async function listCollection<T extends { id: string }>(
  collection: string,
  opts?: ListOptions,
): Promise<ListResult<T>> {
  let q = applyQuery(collection, opts)

  if (opts?.cursor) {
    const cursorSnap = await getAdminDb().collection(collection).doc(opts.cursor).get()
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap)
    }
  }

  const snap = await q.get()
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T)
  const last = snap.docs[snap.docs.length - 1] as QueryDocumentSnapshot | undefined
  const nextCursor =
    last && snap.docs.length === Math.min(Math.max(opts?.limit ?? 50, 1), 100)
      ? last.id
      : null

  return { items, nextCursor }
}

export async function getDoc<T extends { id: string }>(
  collection: string,
  id: string,
): Promise<T | null> {
  const snap = await getAdminDb().collection(collection).doc(id).get()
  if (!snap.exists) return null
  return { id: snap.id, ...snap.data() } as T
}

export async function setDoc(
  collection: string,
  id: string,
  data: DocumentData,
  merge = false,
): Promise<void> {
  await getAdminDb().collection(collection).doc(id).set(data, { merge })
}

export async function updateDoc(
  collection: string,
  id: string,
  data: DocumentData,
): Promise<void> {
  await getAdminDb().collection(collection).doc(id).update(data)
}

export async function deleteDoc(collection: string, id: string): Promise<void> {
  await getAdminDb().collection(collection).doc(id).delete()
}

/** Run a constrained query (max 100 per page). */
export async function queryCollection<T extends { id: string }>(
  collection: string,
  opts?: ListOptions,
): Promise<T[]> {
  const { items } = await listCollection<T>(collection, opts)
  return items
}

/**
 * Page through a collection in 100-doc chunks. Use this when a hard 100-doc
 * cap would silently drop rows (marks, assessments, class lists).
 */
export async function queryAllCollection<T extends { id: string }>(
  collection: string,
  opts?: Omit<ListOptions, 'cursor' | 'limit'> & { max?: number },
): Promise<T[]> {
  const max = Math.min(Math.max(opts?.max ?? 1000, 1), 5000)
  const items: T[] = []
  let cursor: string | undefined
  while (items.length < max) {
    const pageLimit = Math.min(100, max - items.length)
    const { items: page, nextCursor } = await listCollection<T>(collection, {
      ...opts,
      limit: pageLimit,
      cursor,
    })
    items.push(...page)
    if (!nextCursor || page.length === 0) break
    cursor = nextCursor
  }
  return items
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
}

/** FieldPath helper for document id ordering when needed. */
export const documentId = FieldPath.documentId

// Back-compat aliases used by earlier service drafts
export const listDocs = async <T extends { id: string }>(
  collection: string,
  opts?: { limit?: number; orderBy?: string },
) => queryCollection<T>(collection, opts)

export const getDocById = getDoc
export const setDocById = (collection: string, id: string, data: DocumentData) =>
  setDoc(collection, id, data, false)
export const mergeDocById = (collection: string, id: string, data: DocumentData) =>
  setDoc(collection, id, data, true)
export const deleteDocById = deleteDoc
