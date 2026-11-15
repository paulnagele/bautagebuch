// Small helpers from all over the app.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { entryFolderPath } from '../../src/diaryUploads.js'
import { folderIdFromText } from '../../src/drive.js'
import { calculate, energyClass, layersU, partType, typeValues } from '../../src/energy/hwb.js'
import { lineLength, polygonArea } from '../../src/haus/garden.js'
import { rotateSite } from '../../src/haus/siteRotation.js'
import { compassName, sunPosition, sunTimes } from '../../src/haus/sun.js'
import { findRoomByName, folderName, sortItems, sortRooms } from '../../src/interior.js'
import { formatDate, forgetDeviceData, loadJSON, saveJSON, today } from '../../src/storage.js'
import { friendlyError } from '../../src/useCollection.js'
import { weatherChoice } from '../../src/weather.js'

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('Datum und Speicher', () => {
  it('ein Datumsformat für die ganze App', () => {
    expect(formatDate('2026-10-07')).toBe('07.10.2026')
    expect(formatDate('2026-10-07T23:00:00Z')).toBe('07.10.2026')
    expect(formatDate('')).toBe('')
  })

  it('heute in der Zeitzone des Geräts', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-15T10:30:00'))
    expect(today()).toBe('2026-11-15')
  })

  it('merkt sich Einstellungen und vergisst Inhalte beim Abmelden', () => {
    saveJSON('app.tab', 'finanzen')
    saveJSON('installHint.dismissed', true)
    expect(loadJSON('app.tab', null)).toBe('finanzen')
    forgetDeviceData()
    expect(loadJSON('app.tab', 'home')).toBe('home')
    expect(loadJSON('installHint.dismissed', false)).toBe(true)
  })

  it('kaputte gespeicherte Werte geben den Standard', () => {
    localStorage.setItem('kaputt', '{nicht json')
    expect(loadJSON('kaputt', 42)).toBe(42)
  })
})

describe('Drive und Ordner', () => {
  it('liest die Ordner-ID aus einem Link', () => {
    const id = '1AbC_dEf-GhIjKlMn'
    expect(folderIdFromText(`https://drive.google.com/drive/folders/${id}?usp=sharing`)).toBe(id)
    expect(folderIdFromText(`https://drive.google.com/open?id=${id}`)).toBe(id)
    expect(folderIdFromText(`  ${id} `)).toBe(id)
    expect(folderIdFromText('kein link')).toBeNull()
  })

  it('Ordner je Art und Tag der Erstellung', () => {
    expect(entryFolderPath('defect', '2026-10-02T09:00:00')).toEqual(['Mangel', '2026_10_02'])
    expect(entryFolderPath('unbekannt', '2026-01-05T09:00:00')).toEqual(['Status', '2026_01_05'])
  })

  it('Ordnernamen für Räume ohne Schrägstrich', () => {
    expect(folderName(' Bad/WC ')).toBe('Bad-WC')
  })
})

describe('Einrichtung', () => {
  it('Räume in eigener Reihenfolge, Bilder mit Favoriten zuerst', () => {
    const rooms = [{ name: 'Küche', sortOrder: 2 }, { name: 'Bad', sortOrder: 2 }, { name: 'Wohnen', sortOrder: 1 }]
    expect(sortRooms(rooms).map((r) => r.name)).toEqual(['Wohnen', 'Bad', 'Küche'])
    const items = [
      { id: 1, favorite: false, createdAt: '2026-11-03' },
      { id: 2, favorite: true, createdAt: '2026-11-01' },
      { id: 3, favorite: false, createdAt: '2026-11-04' },
    ]
    expect(sortItems(items).map((i) => i.id)).toEqual([2, 3, 1])
    expect(findRoomByName(rooms, ' küche ')).toBe(rooms[0])
    expect(findRoomByName(rooms, '')).toBeNull()
  })
})

describe('Wetter', () => {
  it('Schnee und Regen vor Wind und Frost', () => {
    expect(weatherChoice({ code: 73, windMax: 50, tempMin: -5, tempMax: -1 })).toBe('Snow')
    expect(weatherChoice({ code: 61, windMax: 50, tempMin: 5, tempMax: 9 })).toBe('Rain')
    expect(weatherChoice({ code: 3, windMax: 45, tempMin: -2, tempMax: 4 })).toBe('Wind')
    expect(weatherChoice({ code: 3, windMax: 10, tempMin: -2, tempMax: 4 })).toBe('Frost')
    expect(weatherChoice({ code: 2, windMax: 10, tempMin: 2, tempMax: 9 })).toBe('Cloudy')
    expect(weatherChoice({ code: 0, windMax: 10, tempMin: 2, tempMax: 9 })).toBe('Sunny')
  })
})

describe('Fehlermeldungen auf Deutsch', () => {
  it('übersetzt die häufigen Datenbankfehler', () => {
    expect(friendlyError({ code: '42501', message: 'new row violates row-level security policy' })).toMatch(/keinen Zugriff/)
    expect(friendlyError({ message: 'permission denied for table diary_entries' })).toMatch(/Migrationen/)
    expect(friendlyError({ code: '23505', message: 'dup' })).toMatch(/existiert bereits/)
    expect(friendlyError({ code: 'P0002', message: 'Category not found' })).toBe('Die Kategorie wurde nicht gefunden.')
    expect(friendlyError({ message: 'TypeError: Failed to fetch' })).toMatch(/Internetverbindung/)
    expect(friendlyError({ message: 'Etwas anderes' })).toBe('Etwas anderes')
  })
})

describe('Heizwärmebedarf', () => {
  it('Energieklassen', () => {
    expect(energyClass(9)).toBe('A++')
    expect(energyClass(25)).toBe('A')
    expect(energyClass(300)).toBe('G')
  })

  it('U-Wert aus Schichten', () => {
    const wall = partType('wall')
    // 25 cm Ziegel (0,25) + 16 cm Dämmung (0,035)
    const u = layersU(wall, [{ d: 25, lambda: 0.25 }, { d: 16, lambda: 0.035 }])
    expect(u).toBeCloseTo(1 / (0.13 + 1 + 0.16 / 0.035 + 0.04), 6)
    expect(layersU(wall, [{ d: 0, lambda: 1 }])).toBeNull()
    expect(typeValues({ wall: { u: '0.2' } }, 'wall').u).toBe(0.2)
    expect(typeValues({ wall: { u: '' } }, 'wall').u).toBe(0.25)
  })

  it('besser gedämmt heißt weniger Heizwärme', () => {
    const data = (u) => ({
      building: { bgf: 200, volume: 600 },
      climate: {},
      elements: [{ type: 'wall', area: 250, u }, { type: 'window', area: 40, orientation: 180 }],
    })
    const poor = calculate(data(0.6))
    const good = calculate(data(0.15))
    expect(good.hwb).toBeGreaterThan(0)
    expect(good.hwb).toBeLessThan(poor.hwb)
  })
})

describe('Haus', () => {
  it('Flächen und Längen im Garten', () => {
    expect(polygonArea([[0, 0], [4, 0], [4, 3], [0, 3]])).toBe(12)
    expect(lineLength([[0, 0], [3, 4], [3, 10]])).toBe(11)
  })

  it('Sonnenstand: mittags im Süden, im Sommer hoch', () => {
    // Wien, 21. Juni, Mittag (MESZ)
    const summer = sunPosition(new Date('2026-06-21T13:05:00+02:00'), 48.2, 16.37)
    expect(summer.azimuth).toBeGreaterThan(170)
    expect(summer.azimuth).toBeLessThan(190)
    expect(summer.altitude).toBeCloseTo(65.2, 0)
    const winter = sunPosition(new Date('2026-12-21T12:05:00+01:00'), 48.2, 16.37)
    expect(winter.altitude).toBeCloseTo(18.4, 0)
    expect(compassName(202.5)).toBe('Südsüdwest')
    expect(compassName(359)).toBe('Nord')
  })

  it('Sonnenauf- und -untergang', () => {
    const { rise, set } = sunTimes(new Date(2026, 5, 21), 48.2, 16.37)
    expect(rise).not.toBeNull()
    expect(set.getTime() - rise.getTime()).toBeGreaterThan(15.5 * 3600e3)
  })

  it('Umgebung drehen ohne das Haus', () => {
    const context = { siteRotationDeg: 90, neighborhood: { buildings: [{ footprint: [[1, 0]] }], trees: [[1, 5, 0, 3]] } }
    const out = rotateSite(context)
    const [[x, z]] = out.neighborhood.buildings[0].footprint
    expect(x).toBeCloseTo(0, 9)
    expect(z).toBeCloseTo(1, 9)
    expect(out.neighborhood.trees[0][1]).toBe(5)
    expect(out).not.toHaveProperty('siteRotationDeg')
    // Das Original bleibt unverändert.
    expect(context.neighborhood.buildings[0].footprint).toEqual([[1, 0]])
    expect(rotateSite({ a: 1 })).toEqual({ a: 1 })
  })
})
