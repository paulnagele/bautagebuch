import { useEffect, useRef, useState } from 'react'
import { ENTRY_TYPES, TYPE_KEYS, defaultDetails, entryType } from '../diaryTypes.js'
import { CALENDAR_HINTS, WEATHER_LABELS, WEATHER_OPTIONS, fieldOptions } from '../diaryForm.js'
import { newId } from '../storage.js'
import { siteWeather } from '../weather.js'
import PeopleInput from './PeopleInput.jsx'
import DrivePhoto from './DrivePhoto.jsx'

function DetailField({ field, value, options, lists, onChange }) {
  if (field.suggestFrom) {
    return <PeopleInput value={value} onChange={onChange} contacts={lists[field.suggestFrom] ?? []} />
  }
  if (field.kind === 'amount') {
    return (
      <input type="number" min="0" step="0.01" inputMode="decimal" value={value} onChange={onChange} />
    )
  }
  if (field.kind === 'select') {
    return (
      <select value={value} onChange={onChange}>
        {Object.entries(options).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    )
  }
  return <input type={field.kind} value={value} placeholder={field.placeholder} onChange={onChange} />
}

// The form for a new or edited diary entry. The parent keeps the form's
// state (see diaryForm.js) and saves it in onSubmit.
function EntryForm({ form, setForm, editing, busy, error, onClearError, lists, onSubmit, onCancel }) {
  const errorRef = useRef(null)
  const fileInput = useRef(null)
  const cameraInput = useRef(null)
  const attachInput = useRef(null)
  const formType = entryType(form.type)
  // 'loading' | 'done' | 'failed' | null, for the hint under "Wetter".
  const [weatherState, setWeatherState] = useState(null)
  const autoWeather = formType.siteInfo && form.weatherAuto && Boolean(form.date)
  // weatherFor: the date the weather was last filled in for.
  const needsWeather = autoWeather && form.weatherFor !== form.date

  // New status entries get the site's weather for their date, until the
  // weather or temperature is changed by hand.
  useEffect(() => {
    if (!needsWeather) return
    let cancelled = false
    const date = form.date
    // Only shows "loading" if the answer is not already cached.
    const pending = setTimeout(() => setWeatherState('loading'), 150)
    siteWeather(date).then(
      (found) => {
        clearTimeout(pending)
        if (cancelled) return
        setWeatherState(found ? 'done' : null)
        if (!found) return
        setForm((f) =>
          f.date === date && f.weatherAuto
            ? {
                ...f,
                weather: found.weather,
                weatherFor: date,
                details: { ...f.details, temperature: found.temperature },
              }
            : f,
        )
      },
      () => {
        clearTimeout(pending)
        if (!cancelled) setWeatherState('failed')
      },
    )
    return () => {
      cancelled = true
      clearTimeout(pending)
    }
  }, [needsWeather, form.date, setForm])

  // Bring a failed upload's message into view once the overlay closes.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])

  function setField(field) {
    return (e) => setForm({ ...form, [field]: e.target.value })
  }

  function setDetail(key) {
    return (e) => {
      const details = { ...form.details, [key]: e.target.value }
      // A choice that depends on this field no longer fits.
      for (const field of formType.fields) if (field.within === key) details[field.key] = ''
      // A temperature typed in by hand is kept.
      setForm({ ...form, details, weatherAuto: form.weatherAuto && key !== 'temperature' })
    }
  }

  function chooseType(type) {
    setForm({
      ...form,
      type,
      weather: form.weather || 'Sunny',
      details: defaultDetails(type, form.details),
    })
    onClearError()
  }

  // Photos are uploaded as picked, in full size and quality.
  function addPhotos(e) {
    const files = [...e.target.files].filter((f) => f.type.startsWith('image/'))
    e.target.value = ''
    if (files.length === 0) return
    onClearError()
    const added = files.map((file) => ({ key: newId(), blob: file }))
    setForm((f) => ({ ...f, photos: [...f.photos, ...added] }))
  }

  // Any kind of file (PDF, plan, offer, …), kept in Drive's file folder.
  function addAttachments(e) {
    const picked = [...e.target.files]
    e.target.value = ''
    if (picked.length === 0) return
    onClearError()
    const added = picked.map((file) => ({ key: newId(), blob: file, name: file.name }))
    setForm((f) => ({ ...f, files: [...f.files, ...added] }))
  }

  function removeFile(key) {
    setForm({ ...form, files: form.files.filter((f) => f.key !== key) })
  }

  function removePhoto(key) {
    setForm({ ...form, photos: form.photos.filter((p) => p.key !== key) })
  }

  return (
    <form className="card form-grid" onSubmit={onSubmit} noValidate>
      <h2>{editing ? 'Eintrag bearbeiten' : 'Neuer Tagebucheintrag'}</h2>

      <div className="full type-picker" role="radiogroup" aria-label="Art des Eintrags">
        {TYPE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={form.type === key}
            className={`type-option type-${key}${form.type === key ? ' selected' : ''}`}
            onClick={() => chooseType(key)}
            disabled={Boolean(busy)}
          >
            {ENTRY_TYPES[key].label}
          </button>
        ))}
      </div>

      <label>
        {formType.dateLabel}
        <input type="date" value={form.date} onChange={setField('date')} />
      </label>
      {formType.siteInfo && (
        <>
          <label>
            Wetter
            <select
              value={form.weather}
              onChange={(e) => setForm({ ...form, weather: e.target.value, weatherAuto: false })}
            >
              {WEATHER_OPTIONS.map((w) => (
                <option key={w} value={w}>
                  {WEATHER_LABELS[w]}
                </option>
              ))}
            </select>
            {autoWeather && weatherState && (
              <span className="field-hint muted">
                {weatherState === 'loading'
                  ? 'Wetter wird geladen…'
                  : weatherState === 'done'
                    ? 'Automatisch für den Ort der Baustelle'
                    : 'Wetter nicht verfügbar, bitte selbst wählen'}
              </span>
            )}
          </label>
          <label>
            Arbeiter vor Ort
            <input type="number" min="0" value={form.workers} onChange={setField('workers')} />
          </label>
        </>
      )}
      {formType.fields.map((field) => {
        const options =
          field.kind === 'select' ? fieldOptions(field, form.details[field.key], lists, form.details) : null
        if (field.within && Object.keys(options).length === 0) return null
        return (
          <label key={field.key}>
            {field.label}
            <DetailField
              field={field}
              value={form.details[field.key] ?? ''}
              options={options}
              lists={lists}
              onChange={setDetail(field.key)}
            />
          </label>
        )
      })}
      <label className="full">
        {formType.textLabel}
        <textarea rows="4" value={form.work} onChange={setField('work')} />
      </label>

      <div className="full photo-field">
        <span className="field-label">{formType.receipts ? 'Beleg (Foto oder PDF der Rechnung)' : 'Fotos und Dateien'}</span>
        {form.photos.length > 0 && (
          <ul className="thumb-grid">
            {form.photos.map((photo) => (
              <li key={photo.key} className="thumb">
                <DrivePhoto fileId={photo.fileId} blob={photo.blob} alt="" className="thumb-img" />
                <button
                  type="button"
                  className="thumb-remove"
                  aria-label="Foto entfernen"
                  onClick={() => removePhoto(photo.key)}
                  disabled={Boolean(busy)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {form.files.length > 0 && (
          <ul className="file-list">
            {form.files.map((file) => (
              <li key={file.key} className="file-chip">
                <span className="file-name">{file.name}</span>
                <button
                  type="button"
                  className="link danger"
                  aria-label={`${file.name} entfernen`}
                  onClick={() => removeFile(file.key)}
                  disabled={Boolean(busy)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={addPhotos} />
        {/* Opens the camera directly; the gallery picker on some phones has no camera option. */}
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={addPhotos}
        />
        <input ref={attachInput} type="file" multiple hidden onChange={addAttachments} />
        <div className="upload-buttons">
          <button
            type="button"
            className="secondary camera-button"
            onClick={() => cameraInput.current.click()}
            disabled={Boolean(busy)}
          >
            {formType.receipts ? 'Beleg fotografieren' : 'Foto aufnehmen'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => fileInput.current.click()}
            disabled={Boolean(busy)}
          >
            Fotos hinzufügen
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => attachInput.current.click()}
            disabled={Boolean(busy)}
          >
            Dateien hinzufügen
          </button>
        </div>
      </div>

      {CALENDAR_HINTS[form.type] && <p className="form-hint muted full">{CALENDAR_HINTS[form.type]}</p>}

      {error && (
        <p ref={errorRef} className="error full" role="alert">
          {error}
        </p>
      )}

      <div className="form-actions full">
        <button type="submit" disabled={Boolean(busy)}>
          {busy || (editing ? 'Änderungen speichern' : 'Eintrag hinzufügen')}
        </button>
        {editing && (
          <button type="button" className="secondary" onClick={onCancel} disabled={Boolean(busy)}>
            Abbrechen
          </button>
        )}
      </div>
    </form>
  )
}

export default EntryForm
