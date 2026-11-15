import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import PeopleInput from '../../src/components/PeopleInput.jsx'

const contacts = [
  { id: '1', name: 'Bernd Beispiel', role: 'Elektrik', company: 'Strom & Co', pinned: false },
  { id: '2', name: 'Anna Muster', role: 'Architektin', company: 'Atelier', pinned: false },
  { id: '3', name: 'Zoe Probe', role: 'Bauleitung', company: 'Bau GmbH', pinned: true },
]

function Field({ start = '' }) {
  const [value, setValue] = useState(start)
  return <PeopleInput value={value} onChange={(e) => setValue(e.target.value)} contacts={contacts} />
}

const options = () => screen.queryAllByRole('option').map((o) => o.textContent)

describe('Personenfeld mit Kontaktvorschlägen', () => {
  it('schlägt angeheftete Kontakte zuerst vor', () => {
    render(<Field />)
    fireEvent.focus(screen.getByRole('combobox'))
    expect(options()[0]).toMatch(/^Zoe Probe ★/)
    expect(options()).toHaveLength(3)
  })

  it('sucht auch nach Rolle und Firma', () => {
    render(<Field />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'elektr' } })
    expect(options()).toEqual(['Bernd BeispielElektrik · Strom & Co'])
  })

  it('übernimmt einen Vorschlag und bietet ihn nicht noch einmal an', () => {
    render(<Field />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Hr. Gruber, ann' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('Hr. Gruber, Anna Muster, ')
    expect(options().some((o) => o.startsWith('Anna'))).toBe(false)
  })

  it('Pfeiltasten wählen, Escape schließt', () => {
    render(<Field />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    // Second in the list: Anna Muster (after the pinned one).
    expect(input.value).toBe('Anna Muster, ')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(options()).toEqual([])
  })

  it('freier Text bleibt, wie er ist', () => {
    render(<Field />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Nachbar Hans' } })
    expect(input.value).toBe('Nachbar Hans')
    expect(options()).toEqual([])
  })
})
