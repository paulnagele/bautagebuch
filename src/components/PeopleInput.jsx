import { useState } from 'react'

// Free text for one or more people ("Hr. Gruber, Elektro Maier"), with
// contacts suggested for the name being typed after the last comma.
// Picking a suggestion puts the contact's name there; anything typed by
// hand stays as it is. The value is plain text.
const MAX_SUGGESTIONS = 6

function splitLast(value) {
  const cut = value.lastIndexOf(',') + 1
  return { before: value.slice(0, cut), current: value.slice(cut).trim() }
}

function describe(contact) {
  return [contact.role, contact.company].filter(Boolean).join(' · ')
}

function PeopleInput({ value, onChange, contacts }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const { before, current } = splitLast(value)
  const listed = new Set(
    before
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  )
  const query = current.toLowerCase()
  const suggestions = contacts
    .filter((c) => !listed.has(c.name.toLowerCase()))
    .filter((c) => c.name.toLowerCase() !== query)
    .filter((c) => [c.name, c.role, c.company].some((text) => text.toLowerCase().includes(query)))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    .slice(0, MAX_SUGGESTIONS)
  const shown = open && suggestions.length > 0
  const activeIndex = Math.min(active, suggestions.length - 1)

  function change(next) {
    onChange({ target: { value: next } })
  }

  function pick(contact) {
    const prefix = before ? `${before.trimEnd()} ` : ''
    change(`${prefix}${contact.name}, `)
    setActive(0)
  }

  function handleKeyDown(e) {
    if (!shown) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((activeIndex + step + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(suggestions[activeIndex])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="people-input">
      <input
        type="text"
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={shown}
        aria-autocomplete="list"
        placeholder="Name oder Kontakt wählen"
        onChange={(e) => {
          change(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />
      {shown && (
        <ul className="people-suggestions" role="listbox">
          {suggestions.map((contact, i) => (
            <li
              key={contact.id}
              role="option"
              aria-selected={i === activeIndex}
              className={i === activeIndex ? 'active' : undefined}
              // mousedown, so the input keeps focus and does not close the list first
              onMouseDown={(e) => {
                e.preventDefault()
                pick(contact)
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{contact.name}</span>
              {describe(contact) && <span className="muted">{describe(contact)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default PeopleInput
