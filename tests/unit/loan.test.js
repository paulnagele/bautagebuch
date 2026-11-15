import { describe, expect, it } from 'vitest'
import { addMonths, monthlyPayment, monthsToRepay, schedule } from '../../src/loan.js'

describe('Kreditrechner', () => {
  it('rechnet die Annuität wie ein Kreditrechner', () => {
    // 300.000 € über 25 Jahre zu 3,5 %: 1.501,87 € im Monat.
    expect(monthlyPayment(300000, 3.5, 300)).toBeCloseTo(1501.87, 2)
  })

  it('teilt ohne Zinsen einfach durch die Monate', () => {
    expect(monthlyPayment(12000, 0, 120)).toBe(100)
  })

  it('gibt 0 für leere Eingaben', () => {
    expect(monthlyPayment(0, 3, 120)).toBe(0)
    expect(monthlyPayment(100000, 3, 0)).toBe(0)
    expect(monthlyPayment(Number.NaN, 3, 120)).toBe(0)
  })

  it('findet die Laufzeit zur Rate', () => {
    const rate = monthlyPayment(300000, 3.5, 300)
    expect(monthsToRepay(300000, 3.5, rate)).toBe(300)
    expect(monthsToRepay(12000, 0, 100)).toBe(120)
  })

  it('erkennt, wenn die Rate nicht einmal die Zinsen deckt', () => {
    // 3 % von 120.000 € sind 300 € Zinsen im Monat.
    expect(monthsToRepay(120000, 3, 300)).toBe(Infinity)
    expect(monthsToRepay(120000, 3, 0)).toBe(Infinity)
  })

  it('zahlt im Tilgungsplan alles zurück, die letzte Rate ist der Rest', () => {
    const rate = 1000
    const plan = schedule(50000, 4, rate)
    expect(plan.balanceAfter(0)).toBe(50000)
    expect(plan.balanceAfter(plan.months)).toBe(0)
    expect(plan.totalPaid).toBeCloseTo(50000 + plan.totalInterest, 6)
    expect(plan.months).toBe(monthsToRepay(50000, 4, rate))
    // Vor dem letzten Monat ist noch etwas offen, aber weniger als eine Rate.
    expect(plan.balanceAfter(plan.months - 1)).toBeGreaterThan(0)
    expect(plan.balanceAfter(plan.months - 1)).toBeLessThan(rate)
  })

  it('zählt Monate über den Jahreswechsel', () => {
    expect(addMonths('2026-12', 5)).toBe('2027-05')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-11', 0)).toBe('2026-11')
  })
})
