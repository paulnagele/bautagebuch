// Background uploads of diary photos and files (uploadQueue.js).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const drive = { connected: true, active: 0, max: 0, folderLookups: 0, failNames: new Set(), delays: {} }
const db = { rows: new Map(), updates: 0 }
let connectListener = null

vi.mock('../../src/drive.js', () => {
  const send = async (blob, name, folderId, onBytes) => {
    drive.active++
    drive.max = Math.max(drive.max, drive.active)
    await new Promise((r) => setTimeout(r, drive.delays[blob.size] ?? 5))
    drive.active--
    if (drive.failNames.has(blob.name)) throw new Error('Netz weg')
    onBytes?.(blob.size)
    return `drive-${blob.name}`
  }
  return {
    driveAccess: { connected: () => drive.connected },
    getEntryFolderId: async () => {
      drive.folderLookups++
      return 'F'
    },
    uploadPhoto: send,
    uploadFile: send,
    onDriveConnected: (listener) => {
      connectListener = listener
      return () => {}
    },
  }
})

vi.mock('../../src/supabase.js', () => {
  const from = () => {
    let patch = null
    let id = null
    const chain = {
      select: () => chain,
      update: (p) => ((patch = p), chain),
      eq: (_col, value) => ((id = value), chain),
      maybeSingle: async () => ({ data: db.rows.get(id) ?? null, error: null }),
      single: async () => {
        db.updates++
        const row = { ...db.rows.get(id), ...patch }
        db.rows.set(id, row)
        return { data: row, error: null }
      },
    }
    return chain
  }
  return { supabase: { from } }
})

vi.mock('../../src/useCollection.js', () => ({ applyRow: () => {}, friendlyError: (e) => e.message }))

const file = (name, size = 10) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' })
const photos = (...names) => names.map((name, i) => ({ key: `k${i}`, blob: file(name, 10 + i) }))

async function freshQueue() {
  vi.resetModules()
  return import('../../src/uploadQueue.js')
}

async function settle(queue) {
  for (let i = 0; i < 200 && queue.getUploads().items.length > 0; i++) {
    await new Promise((r) => setTimeout(r, 5))
  }
}

beforeEach(() => {
  Object.assign(drive, { connected: true, active: 0, max: 0, folderLookups: 0, failNames: new Set(), delays: {} })
  db.rows = new Map([['e1', { id: 'e1', photo_ids: ['alt'], files: [] }]])
  db.updates = 0
  localStorage.clear()
})

describe('Fotos im Hintergrund hochladen', () => {
  it('lädt drei gleichzeitig hoch und hängt alle in der gewählten Reihenfolge an', async () => {
    const queue = await freshQueue()
    const picked = photos('a', 'b', 'c', 'd', 'e', 'f')
    // The first photo takes longest, so later ones finish first.
    drive.delays = { 10: 40 }
    await queue.enqueue('e1', { photos: picked, files: [], date: '2026-11-22' }, ['Status', '2026_11_22'])
    expect(queue.getUploads().status).toBe('uploading')
    expect(queue.pendingFor('e1')).toHaveLength(6)
    await settle(queue)
    expect(drive.max).toBe(queue.PARALLEL_UPLOADS)
    expect(db.rows.get('e1').photo_ids).toEqual(['alt', ...'abcdef'.split('').map((n) => `drive-${n}`)])
    expect(queue.getUploads().status).toBe('idle')
    expect(localStorage.getItem('bautagebuch.uploadQueue')).toBeNull()
  })

  it('Dateien kommen mit Namen in die Dateiliste', async () => {
    const queue = await freshQueue()
    const plan = { key: 'p', name: 'plan.pdf', blob: new File([new Uint8Array(3)], 'plan.pdf') }
    await queue.enqueue('e1', { photos: [], files: [plan], date: 'd' }, ['Status', 'x'])
    await settle(queue)
    expect(db.rows.get('e1').files).toEqual([{ id: 'drive-plan.pdf', name: 'plan.pdf' }])
  })

  it('wartet ohne Drive-Zugriff und startet, sobald Drive verbunden ist', async () => {
    drive.connected = false
    const queue = await freshQueue()
    await queue.enqueue('e1', { photos: photos('a'), files: [], date: 'd' }, ['S', 'x'])
    expect(queue.getUploads().status).toBe('needs-drive')
    expect(drive.max).toBe(0)
    drive.connected = true
    connectListener()
    await settle(queue)
    expect(db.rows.get('e1').photo_ids).toEqual(['alt', 'drive-a'])
  })

  it('nach einem Fehler: fertige bleiben, der Rest wird erneut versucht', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    try {
      const queue = await freshQueue()
      drive.failNames = new Set(['b'])
      await queue.enqueue('e1', { photos: photos('a', 'b'), files: [], date: 'd' }, ['S', 'x'])
      for (let i = 0; i < 50 && queue.getUploads().status !== 'retrying'; i++) await vi.advanceTimersByTimeAsync(5)
      expect(queue.getUploads().status).toBe('retrying')
      expect(queue.getUploads().error).toBe('Netz weg')
      expect(db.rows.get('e1').photo_ids).toEqual(['alt', 'drive-a'])
      drive.failNames = new Set()
      await vi.advanceTimersByTimeAsync(10_000)
      for (let i = 0; i < 50 && queue.getUploads().items.length; i++) await vi.advanceTimersByTimeAsync(5)
      expect(db.rows.get('e1').photo_ids).toEqual(['alt', 'drive-a', 'drive-b'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('macht nach dem Neustart der App weiter', async () => {
    let queue = await freshQueue()
    drive.connected = false
    await queue.enqueue('e1', { photos: photos('a'), files: [], date: 'd' }, ['S', 'x'])
    const saved = JSON.parse(localStorage.getItem('bautagebuch.uploadQueue'))
    // Pretend it was uploaded just before the app closed.
    localStorage.setItem('bautagebuch.uploadQueue', JSON.stringify(saved.map((i) => ({ ...i, fileId: 'drive-a' }))))
    drive.connected = true
    queue = await freshQueue()
    await queue.resumeUploads()
    await settle(queue)
    expect(db.rows.get('e1').photo_ids).toEqual(['alt', 'drive-a'])
  })

  it('vergisst die Fotos eines inzwischen gelöschten Eintrags', async () => {
    const queue = await freshQueue()
    db.rows.delete('e1')
    await queue.enqueue('e1', { photos: photos('a'), files: [], date: 'd' }, ['S', 'x'])
    await settle(queue)
    expect(queue.getUploads().items).toHaveLength(0)
    expect(db.updates).toBe(0)
  })
})
