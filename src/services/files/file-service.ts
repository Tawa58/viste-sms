import { saveBlobInApp } from '@/lib/native-app'
import { compressImage } from './compress-image'
import {
  blobToUint8Array,
  createFileChunks,
  createFileId,
  reconstructBlob,
  sha256Hex,
} from './chunking'
import { FirestoreFileRepository } from './firestore-file-repository'
import { localFileRepository } from './local-file-repository'
import {
  enqueuePendingUpload,
  flushPendingUploads,
  isOnline,
  listPendingUploads,
  publishSyncStatus,
  registerOfflineFlushHandler,
  retryPendingUpload,
} from './offline-queue'
import {
  assertCanAccessFile,
  assertCanUpload,
  canAccessFile,
} from './permissions'
import type {
  FileAccessContext,
  StoredFileChunk,
  StoredFileMetadata,
  UploadFileInput,
  UploadFileResult,
} from './types'
import { FileValidationError, validateFile } from './validation'

const firestoreRepo = new FirestoreFileRepository()

registerOfflineFlushHandler(async (job) => {
  await firestoreRepo.saveFile(
    { ...job.metadata, syncStatus: 'synced', status: 'active' },
    job.chunks,
  )
  await localFileRepository.saveFile(
    { ...job.metadata, syncStatus: 'synced', status: 'active' },
    job.chunks,
  )
})

function createFileMetadata(
  partial: Omit<StoredFileMetadata, 'storageMethod' | 'uploadedAt' | 'status' | 'syncStatus'> & {
    status?: StoredFileMetadata['status']
    syncStatus?: StoredFileMetadata['syncStatus']
  },
): StoredFileMetadata {
  return {
    storageMethod: 'firestore',
    uploadedAt: new Date().toISOString(),
    status: partial.status ?? 'active',
    syncStatus: partial.syncStatus ?? 'synced',
    ...partial,
  }
}

async function prepareUploadPayload(input: UploadFileInput) {
  const originalName =
    input.fileName ||
    (input.file instanceof File ? input.file.name : `upload-${Date.now()}`)
  const validated = validateFile(input.file, input.fileType, originalName)

  const shouldCompress =
    input.compressImage !== false &&
    (input.fileType === 'profile_photo' ||
      input.fileType === 'staff_photo' ||
      validated.mimeType.startsWith('image/'))

  let blob: Blob = input.file
  let mimeType = validated.mimeType
  let fileName = validated.fileName
  let width: number | undefined
  let height: number | undefined

  if (shouldCompress) {
    const compressed = await compressImage(input.file, validated.fileName, {
      square: input.fileType === 'profile_photo' || input.fileType === 'staff_photo',
      maxEdge:
        input.fileType === 'profile_photo' || input.fileType === 'staff_photo' ? 512 : undefined,
    })
    blob = compressed.blob
    mimeType = compressed.mimeType
    fileName = compressed.fileName
    width = compressed.width
    height = compressed.height
  }

  // Re-validate size after compression.
  validateFile(blob, input.fileType, fileName)

  const bytes = await blobToUint8Array(blob)
  const chunks = createFileChunks(bytes, 'pending')
  const contentHash = await sha256Hex(bytes)

  return { blob, mimeType, fileName, width, height, bytes, chunks, contentHash, originalName }
}

/**
 * Application file service — frontend must use this, never touch chunks directly.
 * Storage backend: Cloud Firestore metadata + chunks. Firebase Storage is NOT used.
 */
export const fileService = {
  validateFile,
  compressImage,
  createFileMetadata,
  createFileChunks,
  canAccessFile,

  async uploadFile(
    input: UploadFileInput,
    access: FileAccessContext,
  ): Promise<UploadFileResult> {
    assertCanUpload(access, input.ownerType, input.ownerId, input.fileType)

    const prepared = await prepareUploadPayload(input)
    const id = createFileId()
    const metadata = createFileMetadata({
      id,
      fileName: prepared.fileName,
      originalFileName: prepared.originalName,
      mimeType: prepared.mimeType,
      fileType: input.fileType,
      sizeBytes: prepared.bytes.byteLength,
      ownerId: input.ownerId,
      ownerType: input.ownerType,
      uploadedBy: input.uploadedBy,
      chunkCount: prepared.chunks.length,
      contentHash: prepared.contentHash,
      width: prepared.width,
      height: prepared.height,
      syncStatus: isOnline() ? 'uploading' : 'pending',
      status: isOnline() ? 'active' : 'pending_upload',
    })

    await localFileRepository.saveFile(metadata, prepared.chunks)
    await publishSyncStatus(id, metadata.syncStatus)

    const previewUrl = URL.createObjectURL(prepared.blob)

    if (!isOnline()) {
      enqueuePendingUpload(metadata, prepared.chunks)
      return { metadata, previewUrl, queuedOffline: true }
    }

    try {
      await publishSyncStatus(id, 'uploading')
      await firestoreRepo.saveFile({ ...metadata, syncStatus: 'synced', status: 'active' }, prepared.chunks)
      const synced = { ...metadata, syncStatus: 'synced' as const, status: 'active' as const }
      await localFileRepository.saveFile(synced, prepared.chunks)
      await publishSyncStatus(id, 'synced')
      return { metadata: synced, previewUrl, queuedOffline: false }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      enqueuePendingUpload(
        { ...metadata, syncStatus: 'failed', status: 'pending_upload', lastError: message },
        prepared.chunks,
      )
      await publishSyncStatus(id, 'failed', message)
      return {
        metadata: { ...metadata, syncStatus: 'failed', status: 'pending_upload', lastError: message },
        previewUrl,
        queuedOffline: true,
      }
    }
  },

  async getFileMetadata(fileId: string, access: FileAccessContext) {
    const local = await localFileRepository.getMetadata(fileId)
    if (local) {
      assertCanAccessFile(local, access)
      return local
    }
    const remote = await firestoreRepo.getMetadata(fileId)
    if (!remote) return undefined
    assertCanAccessFile(remote, access)
    return remote
  },

  async getFileChunks(fileId: string, access: FileAccessContext): Promise<StoredFileChunk[]> {
    const meta = await this.getFileMetadata(fileId, access)
    if (!meta) throw new Error('File not found')
    const local = await localFileRepository.getChunks(fileId)
    if (local.length) return local
    const remote = await firestoreRepo.getChunks(fileId)
    if (remote.length) await localFileRepository.saveFile(meta, remote)
    return remote
  },

  async reconstructFile(fileId: string, access: FileAccessContext): Promise<Blob> {
    const meta = await this.getFileMetadata(fileId, access)
    if (!meta) throw new Error('File not found')
    const chunks = await this.getFileChunks(fileId, access)
    return reconstructBlob(chunks, meta.mimeType)
  },

  async downloadFile(fileId: string, access: FileAccessContext): Promise<void> {
    const meta = await this.getFileMetadata(fileId, access)
    if (!meta) throw new Error('File not found')
    const blob = await this.reconstructFile(fileId, access)
    if (await saveBlobInApp(blob, meta.originalFileName || meta.fileName)) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = meta.originalFileName || meta.fileName
    a.click()
    URL.revokeObjectURL(url)
  },

  async deleteFile(fileId: string, access: FileAccessContext): Promise<void> {
    const meta = await this.getFileMetadata(fileId, access)
    if (!meta) return
    if (!canAccessFile(meta, access)) throw new Error('Not allowed to delete this file')
    await localFileRepository.softDelete(fileId)
    if (isOnline()) {
      try {
        await firestoreRepo.softDelete(fileId)
      } catch {
        // offline / rules — local soft-delete still applied
      }
    }
  },

  async restoreFile(fileId: string, access: FileAccessContext): Promise<void> {
    const meta =
      (await localFileRepository.getMetadata(fileId)) ??
      (await firestoreRepo.getMetadata(fileId))
    if (!meta) throw new Error('File not found')
    assertCanAccessFile({ ...meta, status: 'active' }, access)
    await localFileRepository.restore(fileId)
    if (isOnline()) await firestoreRepo.restore(fileId)
  },

  async listFiles(
    ownerType: StoredFileMetadata['ownerType'],
    ownerId: string,
    access: FileAccessContext,
  ): Promise<StoredFileMetadata[]> {
    let rows: StoredFileMetadata[] = []
    try {
      if (isOnline()) rows = await firestoreRepo.listByOwner(ownerType, ownerId)
    } catch {
      rows = []
    }
    if (!rows.length) rows = await localFileRepository.listByOwner(ownerType, ownerId)
    return rows.filter((r) => canAccessFile(r, access))
  },

  listPendingUploads,
  flushPendingUploads,
  retryPendingUpload,

  async getObjectUrl(fileId: string, access: FileAccessContext): Promise<string> {
    const blob = await this.reconstructFile(fileId, access)
    return URL.createObjectURL(blob)
  },
}

export { FileValidationError }
export type { UploadFileInput, UploadFileResult, FileAccessContext, StoredFileMetadata }
