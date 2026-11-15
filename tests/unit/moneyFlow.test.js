import { describe, expect, it } from 'vitest'
import { flowSources, flowTargets, sumBy } from '../../src/moneyFlow.js'

const tx = (category, amount, description = category) => ({ category, amount, description })

describe('Geldfluss (Sankey)', () => {
  it('summiert je Kategorie', () => {
    const totals = sumBy([tx('A', 1), tx('B', 2), tx('A', 3)], 'category')
    expect(Object.fromEntries(totals)).toEqual({ A: 4, B: 2 })
  })

  it('zeigt Quellen in Listenreihenfolge mit fester Farbe', () => {
    const nodes = flowSources(['Eigenmittel', 'Bank'], [tx('Bank', 100), tx('Eigenmittel', 50)], 0)
    expect(nodes.map((n) => n.name)).toEqual(['Eigenmittel', 'Bank'])
    expect(nodes[0].color).toBe('var(--series-1)')
    expect(nodes[1].color).toBe('var(--series-2)')
  })

  it('fasst ab der neunten Quelle zu „Weitere Quellen“ zusammen', () => {
    const names = Array.from({ length: 10 }, (_, i) => `Quelle ${i + 1}`)
    const nodes = flowSources(names, names.map((n) => tx(n, 10)), 0)
    expect(nodes).toHaveLength(9)
    expect(nodes.at(-1)).toMatchObject({ name: 'Weitere Quellen', value: 20 })
  })

  it('zeigt die Finanzierungslücke', () => {
    const nodes = flowSources(['Bank'], [tx('Bank', 100)], 40)
    expect(nodes.at(-1)).toMatchObject({ name: 'Noch nicht finanziert', value: 40, kind: 'unfunded' })
  })

  it('nennt pro Knoten die größten Posten und fasst den Rest zusammen', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((d, i) => tx('Bank', 10 * (i + 1), d))
    const [node] = flowSources(['Bank'], items, 0)
    expect(node.details.map((d) => d.name)).toEqual(['e', 'd', 'c', '+ 2 weitere'])
    expect(node.details.at(-1).value).toBe(30)
  })

  it('zeigt Ausgaben je Kategorie mit offenem Plan und Rest', () => {
    const categories = [
      { name: 'Rohbau', plannedAmount: 100 },
      { name: 'Dach', plannedAmount: null },
    ]
    const nodes = flowTargets([tx('Dach', 30), tx('Rohbau', 40)], categories, 200)
    expect(nodes.map((n) => n.name)).toEqual(['Rohbau', 'Dach', 'Noch nicht verplant'])
    expect(nodes[0]).toMatchObject({ spent: 40, planned: 60, value: 100 })
    expect(nodes[1]).toMatchObject({ spent: 30, planned: 0, value: 30 })
    expect(nodes[2].value).toBe(70)
  })

  it('übertriebene Ausgaben lassen keinen negativen Plan', () => {
    const nodes = flowTargets([tx('Rohbau', 150)], [{ name: 'Rohbau', plannedAmount: 100 }], 0)
    expect(nodes).toEqual([expect.objectContaining({ name: 'Rohbau', planned: 0, value: 150 })])
  })

  it('sagt „Noch nicht ausgegeben“, solange nichts geplant ist', () => {
    const nodes = flowTargets([tx('Rohbau', 10)], [{ name: 'Rohbau', plannedAmount: null }], 50)
    expect(nodes.at(-1)).toMatchObject({ name: 'Noch nicht ausgegeben', value: 40 })
  })
})
