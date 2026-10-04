// Contacts (contacts table), kept on the Kontakte tab and suggested in
// the diary's people fields and for quote companies.

export function contactFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role ?? '',
    company: row.company ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    notes: row.notes ?? '',
    pinned: row.pinned ?? false,
  }
}

export function contactToRow(contact) {
  return {
    name: contact.name,
    role: contact.role,
    company: contact.company,
    phone: contact.phone,
    email: contact.email,
    notes: contact.notes,
    pinned: contact.pinned,
  }
}
