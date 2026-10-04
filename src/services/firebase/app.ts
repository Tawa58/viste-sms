/**
 * Firebase app bootstrap.
 *
 * USED: Authentication, Cloud Firestore, Realtime Database (live state only)
 * NOT USED: Firebase Storage — never import or call getStorage()
 */
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getDatabase, type Database } from 'firebase/database'
import { readPublicEnv } from '@/lib/env'

const firebaseConfig = {
  apiKey: readPublicEnv('FIREBASE_API_KEY', 'AIzaSyCP9qdogUuP51SabQAJduEM3yr6ATE-ZGg'),
  authDomain: readPublicEnv('FIREBASE_AUTH_DOMAIN', 'viste-school-db.firebaseapp.com'),
  projectId: readPublicEnv('FIREBASE_PROJECT_ID', 'viste-school-db'),
  storageBucket: readPublicEnv('FIREBASE_STORAGE_BUCKET', 'viste-school-db.firebasestorage.app'),
  messagingSenderId: readPublicEnv('FIREBASE_MESSAGING_SENDER_ID', '873776792991'),
  appId: readPublicEnv('FIREBASE_APP_ID', '1:873776792991:web:9397f4b8f35b6d2ee3e9aa'),
  databaseURL:
    readPublicEnv('FIREBASE_DATABASE_URL') ||
    `https://${readPublicEnv('FIREBASE_PROJECT_ID', 'viste-school-db')}-default-rtdb.firebaseio.com`,
}

const firestoreDatabaseId = readPublicEnv('FIRESTORE_DATABASE_ID').trim() || undefined

let app: FirebaseApp | undefined
let auth: Auth | undefined
let db: Firestore | undefined
let rtdb: Database | undefined
let authReady: Promise<void> | null = null

export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig)
  }
  return app
}

export function getFirebaseAuth(): Auth {
  if (!auth) auth = getAuth(getFirebaseApp())
  return auth
}

export function getFirestoreDb(): Firestore {
  if (!db) {
    const firebaseApp = getFirebaseApp()
    db = firestoreDatabaseId
      ? getFirestore(firebaseApp, firestoreDatabaseId)
      : getFirestore(firebaseApp)
  }
  return db
}

export function getRealtimeDb(): Database {
  if (!rtdb) rtdb = getDatabase(getFirebaseApp())
  return rtdb
}

/** Wait for Firebase Auth to restore the persisted school-user session. */
export function ensureFirebaseAuth(): Promise<void> {
  if (!authReady) {
    authReady = new Promise((resolve) => {
      const a = getFirebaseAuth()
      const unsub = onAuthStateChanged(
        a,
        () => {
          unsub()
          resolve()
        },
        () => {
          unsub()
          resolve()
        },
      )
    })
  }
  return authReady
}

export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId)
}

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId
export const FIREBASE_STORAGE_DISABLED = true as const
