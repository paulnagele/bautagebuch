const CALENDAR_ID =
  '68f105d43c95198db43b96965ea96496bbb0883f0c1e94fc7434d3c4ed0bf8bb@group.calendar.google.com'
const TIME_ZONE = 'Europe/Vienna'

const embedUrl =
  'https://calendar.google.com/calendar/embed?' +
  new URLSearchParams({ src: CALENDAR_ID, ctz: TIME_ZONE }).toString()

const agendaUrl = `${embedUrl}&mode=AGENDA`

function Timetable() {
  return (
    <section className="tab-content">
      <div className="card calendar-card">
        <div className="calendar-head">
          <h2>Construction timetable</h2>
          <a href={embedUrl} target="_blank" rel="noreferrer">
            Open in Google Calendar ↗
          </a>
        </div>
        {/* Month view on wide screens, agenda list on phones. */}
        <iframe
          className="calendar-frame calendar-month"
          title="Construction timetable (month view)"
          src={embedUrl}
          loading="lazy"
        />
        <iframe
          className="calendar-frame calendar-agenda"
          title="Construction timetable (agenda)"
          src={agendaUrl}
          loading="lazy"
        />
      </div>
    </section>
  )
}

export default Timetable
