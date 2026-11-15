// Made-up project for the browser tests: no real people, figures, address
// or house. Each test gets a fresh copy (demoTables()).

export const USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'demo@example.com',
  name: 'Max Muster',
}

const ts = (date, time = '09:00') => `${date}T${time}:00+00:00`
let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

function build() {
  n = 100
  const categories = [
    ['Planung', 22000],
    ['Rohbau', 128000],
    ['Dach', 46000],
    ['Fenster & Türen', 38000],
  ].map(([name, planned], i) => ({
    id: id(), type: 'expense', name, sort_order: i + 1, planned_amount: planned, created_at: ts('2026-03-01'),
  }))
  const funding = ['Eigenmittel', 'Bankkredit'].map((name, i) => ({
    id: id(), type: 'funding', name, sort_order: i + 1, planned_amount: null, created_at: ts('2026-03-01'),
  }))
  const cat = (name) => categories.find((c) => c.name === name)
  const budget_items = [
    { id: id(), category_id: cat('Rohbau').id, name: 'Baumeister', planned_amount: 108000, sort_order: 1, created_at: ts('2026-03-02') },
    { id: id(), category_id: cat('Fenster & Türen').id, name: 'Fenster', planned_amount: 30000, sort_order: 2, created_at: ts('2026-03-02') },
  ]
  const contacts = [
    ['Thomas Probe', 'Bauleitung', 'Baumeister Probe GmbH', true],
    ['Lena Beispiel', 'Architektin', 'Atelier Beispiel', false],
  ].map(([name, role, company, pinned], i) => ({
    id: id(), name, role, company, phone: `+43 660 000 ${1100 + i}`, email: `kontakt${i}@example.com`,
    notes: '', pinned, created_by: USER.id, created_at: ts('2026-03-03'),
  }))

  const diary_entries = []
  const transactions = []
  const entry = (entry_type, entry_date, work, details = {}, extra = {}) => {
    const row = {
      id: id(), entry_date, weather: '', workers: null, work, photo_ids: [], files: [],
      created_by: USER.id, author_name: USER.name, created_at: ts(entry_date, '17:30'),
      updated_at: ts(entry_date, '17:31'), entry_type, details, ...extra,
    }
    diary_entries.push(row)
    return row
  }
  entry('status', '2026-09-21', 'Mauerwerk Erdgeschoss fertig.', { category: 'Rohbau' }, { weather: 'Cloudy', workers: 5 })
  entry('status', '2026-07-30', 'Baubewilligung ist da.', {}, {
    weather: 'Sunny', files: [{ id: 'doc-bescheid', name: 'Baubescheid.pdf' }],
  })
  entry('defect', '2026-11-13', 'Fensteranschluss Küche undicht.', {
    state: 'open', responsible: 'Thomas Probe', deadline: '2026-11-22', category: 'Fenster & Türen',
  })
  entry('todo', '2026-11-10', 'Fliesen fürs Bad aussuchen', { state: 'open', due: '2026-11-19', responsible: 'Max Muster' })
  entry('appointment', '2026-11-17', 'Baubesprechung Fenster', {
    time: '08:00', location: 'Baustelle', participants: 'Thomas Probe',
  })
  const expense = (date, work, category, amount, paid, payBy = '', file = null) => {
    const row = entry('expense', date, work, { category, amount, payment: paid ? 'paid' : 'open', payBy }, {
      files: file ? [{ id: `doc-${file}`, name: file }] : [],
    })
    transactions.push({
      id: id(), tx_date: date, type: 'expense', category, description: work, amount,
      created_by: USER.id, created_at: row.created_at, diary_entry_id: row.id, budget_item_id: null,
      paid, has_receipt: Boolean(file),
    })
  }
  expense('2026-07-15', 'Honorar Einreichplanung', 'Planung', 14800, true, '', 'Honorarnote.pdf')
  expense('2026-09-05', 'Baumeister 1. Teilrechnung', 'Rohbau', 48000, true, '', 'TR1.pdf')
  expense('2026-10-15', 'Baumeister 2. Teilrechnung', 'Rohbau', 36000, false, '2026-11-28', 'TR2.pdf')
  transactions.push({
    id: id(), tx_date: '2026-03-01', type: 'funding', category: 'Eigenmittel', description: 'Erspartes',
    amount: 160000, created_by: USER.id, created_at: ts('2026-03-01'), diary_entry_id: null,
    budget_item_id: null, paid: true, has_receipt: false,
  })

  const document_types = [
    ['Rechnungen', 'receipts'],
    ['Angebote', 'quotes'],
    ['Genehmigungen', null],
  ].map(([name, holds]) => ({ id: id(), name, holds, created_by: null, created_at: ts('2026-03-01') }))

  return {
    members: [{ email: USER.email, added_at: ts('2026-03-01') }],
    app_settings: [
      { key: 'drive_folder_id', value: 'demo-folder' },
      { key: 'calendar_id', value: 'demo@group.calendar.google.com' },
    ],
    finance_categories: [...categories, ...funding],
    budget_items,
    quotes: [],
    contacts,
    diary_entries,
    transactions,
    milestones: [
      { id: id(), name: 'Baubeginn', due_date: '2026-08-24', reached: true, calendar_event_id: null, created_by: USER.id, created_at: ts('2026-03-05') },
      { id: id(), name: 'Einzug', due_date: '2027-06-01', reached: false, calendar_event_id: null, created_by: USER.id, created_at: ts('2026-03-05') },
    ],
    schedule_slots: [
      { id: id(), category_id: cat('Rohbau').id, name: 'Mauerwerk', start_date: '2026-09-07', end_date: '2026-10-09', created_at: ts('2026-03-05') },
    ],
    document_types,
    document_assignments: [],
    interior_rooms: [{ id: id(), name: 'Wohnen', folder: 'Wohnen', sort_order: 0, created_by: USER.id, created_at: ts('2026-11-01') }],
    interior_items: [],
    house_versions: [],
    house_context: [],
    house_chat: [],
    house_shares: [],
    house_share_versions: [],
    heat_demand: [],
  }
}

export function demoTables() {
  return build()
}
