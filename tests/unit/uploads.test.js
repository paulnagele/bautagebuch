// Uploading a diary entry's photos and files: parallel, remembered after errors.
import { describe, expect, it, vi } from 'vitest'

const calls = { active: 0, max: 0, folder: 0, names: [] }
vi.mock('../../src/drive.js', () => {
  const send = async (blob, name, folderId, onBytes) => {
    calls.active++
    calls.max = Math.max(calls.max, calls.active)
    calls.names.push(name)
    await new Promise((r) => setTimeout(r, 5))
    onBytes?.(blob.size)
    calls.active--
    if (name.includes('kaputt')) throw new Error('Netz weg')
    return `id-${blob.size}-${folderId}`
  }
  return {
    getEntryFolderId: vi.fn(async () => {
      calls.folder++
      return 'F'
    }),
    uploadPhoto: send,
    uploadFile: send,
  }
})

const { uploadPending, PARALLEL_UPLOADS } = await import('../../src/diaryUploads.js')

const photo = (size) => ({ key: `p${size}`, blob: new File([new Uint8Array(size)], 'IMG.jpg', { type: 'image/jpeg' }) })

describe('Fotos hochladen', () => {
  it('lädt mehrere gleichzeitig hoch und sucht den Ordner nur einmal', async () => {
    Object.assign(calls, { active: 0, max: 0, folder: 0, names: [] })
    const photos = [1, 2, 3, 4, 5, 6].map(photo)
    const fractions = []
    const result = await uploadPending({ photos, files: [], date: '2026-11-22' }, ['Status', '2026_11_22'], (p) => fractions.push(p.fraction))
    expect(calls.max).toBe(PARALLEL_UPLOADS)
    expect(calls.folder).toBe(1)
    expect(result.photos.every((p) => p.fileId === `id-${p.key.slice(1)}-F` && !p.blob)).toBe(true)
    expect(result.photos.map((p) => p.key)).toEqual(photos.map((p) => p.key))
    expect(fractions.at(-1)).toBe(1)
  })

  it('merkt sich fertige Uploads, auch wenn einer scheitert', async () => {
    const ok = { key: 'ok', name: 'a.pdf', blob: new File([new Uint8Array(3)], 'a.pdf') }
    const bad = { key: 'bad', name: 'kaputt.pdf', blob: new File([new Uint8Array(4)], 'kaputt.pdf') }
    const seen = []
    await expect(
      uploadPending({ photos: [], files: [bad, ok], date: 'd' }, ['S', 'x'], (_, sofar) => sofar && seen.push(sofar)),
    ).rejects.toThrow('Netz weg')
    expect(seen.at(-1).files[1].fileId).toBe('id-3-F')
  })
})
