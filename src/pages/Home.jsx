function Home({ user, onLogout }) {
  return (
    <main className="home-page">
      <header>
        <h1>Bautagebuch</h1>
        <button type="button" className="secondary" onClick={onLogout}>
          Sign out
        </button>
      </header>
      <p>
        Welcome, <strong>{user.email}</strong>!
      </p>
    </main>
  )
}

export default Home
