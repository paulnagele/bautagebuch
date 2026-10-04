import { Fragment } from 'react'
import { entryType, isOpen, isOverdue, typeKey } from '../diaryTypes.js'
import { WEATHER_LABELS, fieldOptions } from '../diaryForm.js'
import { driveFileUrl } from '../drive.js'
import { canMarkPhotos } from '../documents.js'
import { formatDate } from '../storage.js'
import PeopleLinks from './PeopleLinks.jsx'
import DrivePhoto from './DrivePhoto.jsx'

// The extra fields of an entry as short texts for the list ("14:00 Uhr", …).
// People who are contacts link to them.
function detailSummaries(entry, lists, onOpenContact, skip) {
  return entryType(entry.type)
    .fields.filter((field) => !field.pill && field.key !== skip && entry.details[field.key])
    .map((field) => {
      let value = entry.details[field.key]
      if (field.within) return fieldOptions(field, value, lists, entry.details)[value] ?? null
      if (field.suggestFrom) {
        value = (
          <PeopleLinks text={value} contacts={lists[field.suggestFrom] ?? []} onOpen={onOpenContact} />
        )
      }
      if (field.summary) return field.summary(value)
      return field.kind === 'select' ? (field.options?.[value] ?? value) : value
    })
}

// One diary entry in the list, with its photos, files and actions.
function EntryCard({
  entry,
  editing,
  todayDate,
  lists,
  onOpenContact,
  onOpenPhoto,
  onToggleDone,
  documentIds,
  onToggleDocument,
  onEdit,
  onDelete,
}) {
  const type = entryType(entry.type)
  const key = typeKey(entry.type)
  // To-dos are headed by when they are due; the entry date moves to the
  // small text.
  const due = type.dueHeadline ? entry.details[type.progress.due] : ''
  const overdue = isOverdue(entry, todayDate)
  const meta = [
    due && `eingetragen am ${formatDate(entry.date)}`,
    ...(type.siteInfo
      ? [
          WEATHER_LABELS[entry.weather] ?? entry.weather,
          entry.workers !== '' && `${entry.workers} Arbeiter`,
        ]
      : []),
    ...detailSummaries(entry, lists, onOpenContact, due && type.progress.due),
    entry.author,
  ].filter(Boolean)
  const pills = type.fields.filter(
    (f) => f.pill && entry.details[f.key] && entry.details[f.key] !== f.quiet,
  )

  return (
    <li id={`entry-${entry.id}`} className={`card entry type-${key}${editing ? ' editing' : ''}`}>
      <div className="entry-head">
        <span className="entry-title">
          <span className={`type-badge type-${key}`}>{type.label}</span>
          {due ? (
            <strong className={overdue ? 'overdue-date' : undefined}>bis {formatDate(due)}</strong>
          ) : (
            <strong>{formatDate(entry.date)}</strong>
          )}
          {pills.map((f) => (
            <span key={f.key} className={`state-pill state-${entry.details[f.key]}`}>
              {f.options[entry.details[f.key]] ?? entry.details[f.key]}
            </span>
          ))}
          {overdue && <span className="state-pill state-overdue">Überfällig</span>}
          {key === 'appointment' && entry.date >= todayDate && (
            <span className="state-pill state-upcoming">Bevorstehend</span>
          )}
        </span>
        <span className="muted">
          {meta.map((part, i) => (
            <Fragment key={i}>
              {i > 0 && ' · '}
              {part}
            </Fragment>
          ))}
        </span>
      </div>
      <p className="entry-text">{entry.work}</p>
      {entry.photoIds.length > 0 && (
        <ul className="thumb-grid entry-photos">
          {entry.photoIds.map((fileId, i) => {
            const alt = `Foto ${i + 1} vom ${formatDate(entry.date)}`
            const isDocument = documentIds.has(fileId)
            return (
              <li key={fileId} className="thumb">
                <DrivePhoto
                  fileId={fileId}
                  alt={alt}
                  className="thumb-img"
                  onOpen={(src) => onOpenPhoto({ src, alt })}
                />
                {canMarkPhotos(entry) && (
                  <button
                    type="button"
                    className={isDocument ? 'thumb-document marked' : 'thumb-document'}
                    aria-pressed={isDocument}
                    title={isDocument ? 'Ist ein Dokument (antippen zum Entfernen)' : 'Als Dokument markieren'}
                    aria-label={`Foto ${i + 1} als Dokument`}
                    onClick={() => onToggleDocument(fileId)}
                  >
                    {isDocument ? '📄 Dokument' : '+ 📄'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {entry.files.length > 0 && (
        <ul className="file-list entry-files">
          {entry.files.map((file) => (
            <li key={file.id}>
              <a className="file-chip" href={driveFileUrl(file.id)} target="_blank" rel="noreferrer">
                <span aria-hidden="true">📄</span>
                <span className="file-name">{file.name}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className="entry-actions">
        {type.progress && (
          <button type="button" className="link" onClick={() => onToggleDone(entry)}>
            {isOpen(entry) ? type.progress.markDone : type.progress.reopen}
          </button>
        )}
        <button type="button" className="link" onClick={() => onEdit(entry)}>
          Bearbeiten
        </button>
        <button type="button" className="link danger" onClick={() => onDelete(entry)}>
          Löschen
        </button>
      </div>
    </li>
  )
}

export default EntryCard
