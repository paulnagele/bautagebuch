function SetupNeeded({ missing }) {
  return (
    <main className="login-page">
      <div className="login-card">
        <h1>Bautagebuch</h1>
        <p className="subtitle">Einrichtung nicht abgeschlossen</p>
        <div className="notice">
          <p>In diesem Build fehlen folgende Einstellungen:</p>
          <ul>
            {missing.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
          <p>
            Siehe „Setup“ in der{' '}
            <a href="https://github.com/paulnagele/bautagebuch#setup">README</a>.
          </p>
        </div>
      </div>
    </main>
  )
}

export default SetupNeeded
