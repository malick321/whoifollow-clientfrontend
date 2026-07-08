const MB = 1024 * 1024

export const CHAT_MAX_FILES = 10
export const CHAT_MAX_IMAGE_BYTES = 8 * MB
export const CHAT_MAX_VIDEO_BYTES = 150 * MB
export const CHAT_MAX_AUDIO_BYTES = 50 * MB
export const CHAT_MAX_FILE_BYTES = 25 * MB
export const CHAT_MAX_BATCH_BYTES = 200 * MB

const IMAGE_MAX_EDGE = 1600
const IMAGE_OPTIMIZE_THRESHOLD_BYTES = 1.5 * MB
const IMAGE_QUALITY = 0.82

export interface PreparedChatFile {
  file: File
  originalName: string
  originalSize: number
  wasOptimized: boolean
}

export interface RejectedChatFile {
  file: File
  reason: string
}

export interface PrepareChatFilesResult {
  accepted: PreparedChatFile[]
  rejected: RejectedChatFile[]
  optimizedCount: number
}

export async function prepareChatUploadFiles(
  files: File[],
  existingCount = 0,
  existingBytes = 0
): Promise<PrepareChatFilesResult> {
  const accepted: PreparedChatFile[] = []
  const rejected: RejectedChatFile[] = []
  let optimizedCount = 0
  let batchBytes = existingBytes

  for (const file of files) {
    if (existingCount + accepted.length >= CHAT_MAX_FILES) {
      rejected.push({ file, reason: `You can send up to ${CHAT_MAX_FILES} files at once.` })
      continue
    }

    const prepared = await prepareOneFile(file)
    const maxBytes = maxBytesForFile(prepared.file)
    if (prepared.file.size > maxBytes) {
      rejected.push({
        file,
        reason: `${file.name} is too large. Max ${formatBytes(maxBytes)}.`
      })
      continue
    }

    if (batchBytes + prepared.file.size > CHAT_MAX_BATCH_BYTES) {
      rejected.push({
        file,
        reason: `This send is too large. Max ${formatBytes(CHAT_MAX_BATCH_BYTES)} per message.`
      })
      continue
    }

    batchBytes += prepared.file.size
    if (prepared.wasOptimized) optimizedCount += 1
    accepted.push(prepared)
  }

  return { accepted, rejected, optimizedCount }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(index === 0 || value >= 10 ? 0 : 1)} ${units[index]}`
}

async function prepareOneFile(file: File): Promise<PreparedChatFile> {
  if (!isCompressibleImage(file)) {
    return { file, originalName: file.name, originalSize: file.size, wasOptimized: false }
  }

  try {
    const optimized = await optimizeImage(file)
    return {
      file: optimized ?? file,
      originalName: file.name,
      originalSize: file.size,
      wasOptimized: !!optimized && optimized.size < file.size
    }
  } catch {
    return { file, originalName: file.name, originalSize: file.size, wasOptimized: false }
  }
}

function maxBytesForFile(file: File): number {
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|avif|heic|heif)$/i.test(name)) {
    return CHAT_MAX_IMAGE_BYTES
  }
  if (type.startsWith('video/') || /\.(mp4|m4v|mov|webm|ogv|avi|mkv)$/i.test(name)) {
    return CHAT_MAX_VIDEO_BYTES
  }
  if (type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|webm|flac)$/i.test(name)) {
    return CHAT_MAX_AUDIO_BYTES
  }
  return CHAT_MAX_FILE_BYTES
}

function isCompressibleImage(file: File): boolean {
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()
  if (!(type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|avif)$/i.test(name))) return false
  if (type === 'image/gif' || type === 'image/svg+xml' || /\.svg$/i.test(name) || /\.gif$/i.test(name)) {
    return false
  }
  return true
}

async function optimizeImage(file: File): Promise<File | null> {
  const image = await loadImage(file)
  const naturalWidth = image.naturalWidth || image.width
  const naturalHeight = image.naturalHeight || image.height
  if (!naturalWidth || !naturalHeight) return null

  const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(naturalWidth, naturalHeight))
  const shouldResize = scale < 1
  const shouldCompress = file.size > IMAGE_OPTIMIZE_THRESHOLD_BYTES
  if (!shouldResize && !shouldCompress) return null

  const width = Math.max(1, Math.round(naturalWidth * scale))
  const height = Math.max(1, Math.round(naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const targetType = file.type.toLowerCase() === 'image/png' ? 'image/webp' : 'image/jpeg'
  if (targetType === 'image/jpeg') {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.drawImage(image, 0, 0, width, height)

  const blob = await canvasToBlob(canvas, targetType, IMAGE_QUALITY)
  if (!blob || blob.size >= file.size) return null

  const extension = targetType === 'image/webp' ? 'webp' : 'jpg'
  return new File([blob], replaceExtension(file.name, extension), {
    type: targetType,
    lastModified: Date.now()
  })
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Image could not be loaded'))
    }
    image.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

function replaceExtension(name: string, extension: string): string {
  const clean = name.replace(/[^\w.-]+/g, '_')
  if (/\.[A-Za-z0-9]+$/.test(clean)) return clean.replace(/\.[A-Za-z0-9]+$/, `.${extension}`)
  return `${clean}.${extension}`
}
