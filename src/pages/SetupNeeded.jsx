function SetupNeeded({ missing }) {
  return (
    <main className="login-page">
      <div className="login-card">
        <h1>Bautagebuch</h1>
        <p className="subtitle">Setup not finished</p>
        <div className="notice">
          <p>This build is missing the following settings:</p>
          <ul>
            {missing.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
          <p>
            See “Setup” in the{' '}
            <a href="https://github.com/paulnagele/bautagebuch#setup">README</a>.
          </p>
        </div>
      </div>
    </main>
  )
}

export default SetupNeeded
