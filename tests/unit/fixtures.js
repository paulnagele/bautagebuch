// Made-up data for the tests. No real people, addresses or figures.

let next = 1

// A diary entry in the shape the app works with (diaryEntries.fromRow).
export function entry({ type = 'status', date = '2026-11-01', work = 'Testeintrag', details = {}, ...rest } = {}) {
  return {
    id: `e${next++}`,
    type,
    date,
    weather: 'Sunny',
    workers: '',
    work,
    details,
    photoIds: [],
    files: [],
    author: 'Erika Beispiel',
    createdAt: `${date}T10:00:00Z`,
    ...rest,
  }
}

export const todo = (due, state = 'open', extra = {}) =>
  entry({ type: 'todo', details: { state, due, ...extra } })

export const defect = (deadline, state = 'open', extra = {}) =>
  entry({ type: 'defect', details: { state, deadline, ...extra } })

export const appointment = (date, time = '', extra = {}) =>
  entry({ type: 'appointment', date, details: { time, ...extra } })

export const expense = (amount, payment = 'paid', extra = {}) =>
  entry({ type: 'expense', details: { category: 'Rohbau', amount, payment, ...extra } })
