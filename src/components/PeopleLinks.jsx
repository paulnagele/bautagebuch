import { Fragment } from 'react'

// The contact a typed name stands for: same name (ignoring case), or else
// the only contact of that company ("Elektro Maier").
function findContact(name, contacts) {
  const key = name.trim().toLowerCase()
  if (!key) return null
  const byName = contacts.find((c) => c.name.trim().toLowerCase() === key)
  if (byName) return byName
  const byCompany = contacts.filter((c) => c.company?.trim().toLowerCase() === key)
  return byCompany.length === 1 ? byCompany[0] : null
}

// People as typed ("Sabine Maier, Hr. Gruber"); names that match a contact
// become links to it, anything else stays plain text.
function PeopleLinks({ text, contacts, onOpen }) {
  return text.split(',').map((part, i) => {
    const contact = onOpen && findContact(part, contacts)
    return (
      <Fragment key={i}>
        {i > 0 && ','}
        {contact ? (
          <>
            {part.match(/^\s*/)[0]}
            <button type="button" className="link contact-link" onClick={() => onOpen(contact)}>
              {part.trim()}
            </button>
          </>
        ) : (
          part
        )}
      </Fragment>
    )
  })
}

export default PeopleLinks
