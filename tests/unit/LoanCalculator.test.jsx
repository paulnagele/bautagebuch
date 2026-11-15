import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import LoanCalculator from '../../src/components/LoanCalculator.jsx'

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const cents = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
// Intl puts a narrow no-break space before "€"; the tests compare plain text.
const plain = (text) => text.replace(/\s/g, ' ')

function show(props = {}) {
  render(
    <LoanCalculator
      suggested={300000}
      planned={500000}
      funding={200000}
      format={euro.format}
      formatCents={cents.format}
      {...props}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Kreditrechner/ }))
}

const field = (label) => screen.getByLabelText(label, { exact: false })
const stat = (label) =>
  plain(within(document.querySelector('.loan-results')).getByText(label).parentElement.querySelector('strong').textContent)

describe('Kreditrechner (Finanzen)', () => {
  it('rechnet mit der Summe aus dem Plan', () => {
    show()
    expect(field('Kreditsumme').value).toBe('300000')
    expect(screen.getByText(/Aus dem Plan:/).textContent).toMatch(/500.000.*200.000/)
    fireEvent.change(field('Zinssatz'), { target: { value: '3.5' } })
    fireEvent.change(field('Laufzeit (Jahre)'), { target: { value: '25' } })
    expect(stat('Monatsrate')).toBe('1.501,87 €')
    expect(stat('Laufzeit')).toBe('25 Jahre')
  })

  it('eigene Summe und zurück zum Plan', () => {
    show()
    fireEvent.change(field('Kreditsumme'), { target: { value: '120000' } })
    expect(screen.getByText(/Eigene Summe/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Aus Plan übernehmen/ }))
    expect(field('Kreditsumme').value).toBe('300000')
  })

  it('warnt, wenn die Rate die Zinsen nicht deckt', () => {
    show()
    fireEvent.change(field('Zinssatz'), { target: { value: '4' } })
    fireEvent.click(screen.getByLabelText('Monatsrate'))
    fireEvent.change(field('Monatsrate (€)'), { target: { value: '500' } })
    expect(plain(screen.getByText(/wird der Kredit nicht/).textContent)).toMatch(/1.000,00 € Zinsen/)
  })

  it('zeigt über 40 % vom Einkommen rot', () => {
    show()
    fireEvent.change(field('Nettoeinkommen'), { target: { value: '3000' } })
    expect(screen.getByText(/über 40 %/)).toBeTruthy()
    fireEvent.change(field('Nettoeinkommen'), { target: { value: '6000' } })
    expect(screen.queryByText(/über 40 %/)).toBeNull()
    expect(screen.getByText(/bleiben .* im Monat/)).toBeTruthy()
  })

  it('ist der Plan gedeckt, braucht es eine eigene Summe', () => {
    show({ suggested: -5000 })
    expect(screen.getByText(/Plan ist durch die gesicherte Finanzierung gedeckt/)).toBeTruthy()
  })

  it('merkt sich die Eingaben auf dem Gerät', () => {
    show()
    fireEvent.change(field('Zinssatz'), { target: { value: '2.9' } })
    expect(JSON.parse(localStorage.getItem('loan.inputs')).rate).toBe('2.9')
  })
})
