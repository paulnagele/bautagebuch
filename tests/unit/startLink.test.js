// Links like ".../?tab=haus&vollbild" (src/startLink.js) are read once when
// the module loads, so each test loads it afresh with its own address.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const tabs = [
  { id: 'home', label: 'Home' },
  { id: 'house', label: 'Haus' },
  { id: 'diary', label: 'Tagebuch' },
]

async function open(search) {
  window.history.replaceState(null, '', `/app/${search}#oben`)
  vi.resetModules()
  return import('../../src/startLink.js')
}

beforeEach(() => window.history.replaceState(null, '', '/'))

describe('Startlinks', () => {
  it('öffnet einen Tab nach Name oder ID und räumt die Adresse auf', async () => {
    const link = await open('?tab=Haus&vollbild&x=1')
    expect(link.startTab(tabs)).toBe('house')
    expect(window.location.search).toBe('?x=1')
    expect(window.location.hash).toBe('#oben')
    expect(link.takeFullStart()).toBe(true)
    expect(link.takeFullStart()).toBe(false)
  })

  it('ohne Parameter bleibt alles beim Alten', async () => {
    const link = await open('')
    expect(link.startTab(tabs)).toBeNull()
    expect(link.startSettings()).toBe(false)
    expect(link.takeFullStart()).toBe(false)
  })

  it('unbekannter Tab und Einstellungen', async () => {
    expect((await open('?tab=gibtsnicht')).startTab(tabs)).toBeNull()
    expect((await open('?tab=einstellungen')).startSettings()).toBe(true)
    expect((await open('?tab=diary')).startTab(tabs)).toBe('diary')
  })
})
