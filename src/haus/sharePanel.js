// "Teilen" behind the gear in the Haus tab: secret links that show one
// version on haus.html without a login, always as it is now. Plain DOM
// like the rest of the viewer.
//
// mountSharePanel(el, { shares, getVersion, getVersions, onChange })
//   shares       { list, create, move, revoke } (houseStore.js)
//   getVersion   () => the open version's row
//   getVersions  () => all version rows (for names)
//   onChange     (shares) => called after the list changed
// Returns { refresh() }: call it when the open version changed.
export function mountSharePanel(el, { shares, getVersion, getVersions, onChange }) {
  el.innerHTML = `
    <span class="label">Teilen</span>
    <p class="note">Wer einen Link hat, sieht die verlinkte Version ohne Login, immer im aktuellen Stand, mit Umgebung. Andere Versionen und der Rest des Bautagebuchs bleiben verborgen. Widerrufen beendet den Link sofort.</p>
    <ul class="slist" data-s="list"></ul>
    <div class="vform">
      <input data-s="label" maxlength="60" placeholder="Für wen? z. B. Architekt" aria-label="Bezeichnung des Links">
      <div class="row"><button type="button" class="btn" data-s="create">Link für diese Version erstellen</button></div>
    </div>
    <div class="vform" data-s="new" hidden>
      <input data-s="url" readonly aria-label="Neuer Link">
      <div class="row"><button type="button" class="btn primary" data-s="copy">Link kopieren</button></div>
      <p class="note">Der Link wird nur jetzt angezeigt. Geht er verloren, erstelle einfach einen neuen.</p>
    </div>
    <p class="msg" data-s="msg" role="status"></p>`
  const $ = (id) => el.querySelector(`[data-s="${id}"]`)
  let list = null
  let loading = false
  let armed = null

  const setMsg = (text, error) => {
    $('msg').textContent = text
    $('msg').className = error ? 'msg err' : 'msg'
  }

  async function load() {
    if (loading) return
    loading = true
    try {
      list = await shares.list()
      onChange?.(list)
      render()
    } catch (error) {
      setMsg(error.message, true)
    } finally {
      loading = false
    }
  }

  function render() {
    if (!list) {
      $('list').replaceChildren()
      return
    }
    const version = getVersion()
    const names = new Map(getVersions().map((v) => [v.id, v.name]))
    $('list').replaceChildren(
      ...list.map((share) => {
        const li = document.createElement('li')
        const text = document.createElement('span')
        text.className = 'sname'
        const label = document.createElement('b')
        label.textContent = share.label
        const target = document.createElement('span')
        target.className = 'vdate'
        target.textContent = names.get(share.version_id) ?? 'Version'
        text.append(label, target)
        const row = document.createElement('span')
        row.className = 'row'
        if (version && share.version_id !== version.id) {
          const move = document.createElement('button')
          move.type = 'button'
          move.className = 'btn'
          move.textContent = 'Diese Version zeigen'
          move.title = `Der Link zeigt dann „${version.name}“`
          move.addEventListener('click', () => moveTo(share, version))
          row.append(move)
        }
        const revoke = document.createElement('button')
        revoke.type = 'button'
        revoke.className = 'btn'
        revoke.textContent = armed === share.id ? 'Wirklich widerrufen?' : 'Widerrufen'
        revoke.addEventListener('click', () => revokeLink(share))
        row.append(revoke)
        li.append(text, row)
        return li
      }),
    )
    if (list.length === 0) {
      const li = document.createElement('li')
      li.className = 'empty'
      li.textContent = 'Noch keine Links.'
      $('list').append(li)
    }
  }

  async function moveTo(share, version) {
    armed = null
    try {
      const row = await shares.move(share.id, version.id)
      list = list.map((s) => (s.id === row.id ? row : s))
      onChange?.(list)
      setMsg(`„${share.label}“ zeigt jetzt „${version.name}“.`)
    } catch (error) {
      setMsg(error.message, true)
    }
    render()
  }

  async function revokeLink(share) {
    if (armed !== share.id) {
      armed = share.id
      render()
      return
    }
    armed = null
    try {
      await shares.revoke(share.id)
      list = list.filter((s) => s.id !== share.id)
      onChange?.(list)
      setMsg(`Link „${share.label}“ widerrufen.`)
    } catch (error) {
      setMsg(error.message, true)
    }
    render()
  }

  $('create').addEventListener('click', async () => {
    const version = getVersion()
    const label = $('label').value.trim()
    if (!version) return
    if (!label) {
      setMsg('Bitte angeben, für wen der Link ist.', true)
      $('label').focus()
      return
    }
    const button = $('create')
    button.disabled = true
    setMsg('Link wird erstellt …')
    try {
      const { share, url } = await shares.create({ label, versionId: version.id })
      list = [...(list ?? []), share]
      onChange?.(list)
      $('label').value = ''
      $('url').value = url
      $('new').hidden = false
      setMsg(`Link „${label}“ für „${version.name}“ erstellt.`)
      render()
    } catch (error) {
      setMsg(error.message, true)
    } finally {
      button.disabled = false
    }
  })
  $('label').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      $('create').click()
    }
  })
  $('copy').addEventListener('click', () => {
    const url = $('url').value
    navigator.clipboard
      .writeText(url)
      .then(() => setMsg('Link kopiert.'))
      .catch(() => {
        $('url').focus()
        $('url').select()
        setMsg('Link markiert, bitte manuell kopieren.')
      })
  })

  return {
    refresh() {
      if (!list) load()
      else render()
    },
  }
}
