import { useEffect, useState } from 'react'
import { calendarEmbedUrl, getCalendarId } from '../calendar.js'

function Timetable() {
  const [calendarId, setCalendarId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getCalendarId().then(setCalendarId, (err) => setError(err.message))
  }, [])

  if (error) {
    return (
      <section className="tab-content">
        <p className="card error">{error}</p>
      </section>
    )
  }
  if (!calendarId) return <section className="tab-content" />

  const embedUrl = calendarEmbedUrl(calendarId)
  return (
    <section className="tab-content">
      <div className="card calendar-card">
        <div className="calendar-head">
          <h2>Bauzeitplan</h2>
          <a href={embedUrl} target="_blank" rel="noreferrer">
            In Google Kalender öffnen ↗
          </a>
        </div>
        {/* Month view on wide screens, agenda list on phones. */}
        <iframe
          className="calendar-frame calendar-month"
          title="Bauzeitplan (Monatsansicht)"
          src={embedUrl}
          loading="lazy"
        />
        <iframe
          className="calendar-frame calendar-agenda"
          title="Bauzeitplan (Terminübersicht)"
          src={calendarEmbedUrl(calendarId, 'AGENDA')}
          loading="lazy"
        />
      </div>
    </section>
  )
}

export default Timetable
