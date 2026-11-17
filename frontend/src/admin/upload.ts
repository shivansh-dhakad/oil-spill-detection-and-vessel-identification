import { client } from './api'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
const MAX_IN = 12 * 1024 * 1024
const MAX_OUT = 5 * 1024 * 1024 // matches the Supabase bucket limit

export function publicUrl(bucket: string, path?: string | null) {
  return path ? client().storage.from(bucket).getPublicUrl(path).data.publicUrl : ''
}

async function toWebp(file: File, maxW: number): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxW / bmp.width)
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Image conversion is not available in this browser.')
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('Could not convert the image.'))), 'image/webp', 0.86),
  )
}

async function put(bucket: string, path: string, body: Blob, contentType: string) {
  const { error } = await client().storage.from(bucket).upload(path, body, { contentType, cacheControl: '31536000' })
  if (error) throw new Error(error.message)
  return path
}

// Validates, converts to WebP (falls back to the original if the browser cannot encode WebP), uploads.
export async function uploadImage(bucket: 'media' | 'certificates', folder: string, file: File, maxW = 1600) {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Use a JPEG, PNG, WebP or AVIF image.')
  if (file.size > MAX_IN) throw new Error('That image is larger than 12 MB.')
  const webp = await toWebp(file, maxW)
  const useWebp = webp.type === 'image/webp'
  const body: Blob = useWebp ? webp : file
  if (body.size > MAX_OUT) throw new Error('The image is larger than 5 MB after processing. Use a smaller one.')
  const ext = useWebp ? 'webp' : file.type.split('/')[1]
  return put(bucket, `${folder}/${crypto.randomUUID()}.${ext}`, body, useWebp ? 'image/webp' : file.type)
}

export async function uploadPdf(bucket: 'resume' | 'certificates', folder: string, file: File) {
  if (file.type !== 'application/pdf') throw new Error('Please choose a PDF file.')
  if (file.size > MAX_OUT) throw new Error('The PDF is larger than 5 MB.')
  return put(bucket, `${folder}/${crypto.randomUUID()}.pdf`, file, 'application/pdf')
}

export const uploadCertificate = (file: File) =>
  file.type === 'application/pdf' ? uploadPdf('certificates', 'files', file) : uploadImage('certificates', 'files', file)

export async function removeFile(bucket: string, path?: string | null) {
  if (!path) return
  try {
    await client().storage.from(bucket).remove([path])
  } catch {
    /* best effort: an orphaned file is harmless */
  }
}
