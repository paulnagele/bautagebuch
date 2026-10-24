// The Haus tab's 3D viewer: the house model (walls, openings, slabs, roof,
// stairs, furniture, terrain) drawn with three.js, plus the site around it
// (terrain from the laser scan, neighbouring houses, roads, trees, power
// line). Ported from the Haus3D page; the model format is unchanged.
//
// mountViewer(host, opts) fills `host` with the scene and its panel and
// returns a function that removes everything again (WebGL context, event
// listeners), so leaving the tab frees the graphics memory.
//   opts.model      the model of the version to show first
//   opts.context    site data ({ terrain, neighborhood }) or null
//   opts.versions   version list (houseStore.listVersions)
//   opts.currentId  id of opts.model
//   opts.store      { load, save, rename, remove, setCurrent } (houseStore.js)
//   opts.shares     { list, create, add, remove, revoke } for "Teilen" (houseStore.js), optional
//   opts.readOnly   true on the shared page (haus.html): the shared versions,
//                   display options open, nothing can be saved or changed
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { mountSharePanel } from './sharePanel.js'
import { buildGarden, gardenInfo, gardenSummary } from './garden.js'

const VIEW_HTML = `
<div class="stage" data-h="stage"></div>
<div class="walkhud" data-h="walkhud" hidden role="status"><span data-h="walkmsg"></span><button type="button" data-h="walkexit">Beenden</button></div>
<div class="joy" data-h="joy" hidden aria-hidden="true"><i></i></div>
<div class="loading" data-h="loading">L A D E N …</div>
<div class="fail" data-h="fail" hidden role="alert"><div class="box"><div data-h="failmsg">Die 3D-Ansicht konnte nicht geladen werden.</div><small data-h="faildetail"></small><button type="button" data-h="failreload">Neu laden</button></div></div>

<aside class="panel" data-h="panel" aria-label="Steuerung">
  <header>
    <div class="headrow"><span class="state" data-h="state">Version</span><button type="button" class="sheetbtn" data-h="sheetbtn" aria-expanded="false">Mehr</button></div>
    <h2 data-h="title"></h2>
    <span class="addr" data-h="addr"></span>
  </header>

  <section class="vsec" aria-label="Versionen">
    <div class="vhead"><span class="label">Versionen</span><button type="button" class="dirty" data-h="dirty" hidden>ungespeicherte Änderung</button></div>
    <ul class="vlist" data-h="vlist"></ul>
    <div class="vsettings" data-h="vsettings" hidden>
      <div class="row" data-h="vactions"><button type="button" class="btn" data-h="vren">Umbenennen</button><button type="button" class="btn" data-h="vdefault" hidden>Als Standard festlegen</button><button type="button" class="btn" data-h="vdel" hidden>Version löschen</button></div>
      <div class="vform" data-h="vrenform" hidden>
        <input data-h="vrenname" maxlength="80" aria-label="Neuer Name der Version">
        <input data-h="vrennote" maxlength="300" placeholder="Was ist anders? (optional)" aria-label="Notiz zur Version">
        <div class="row"><button type="button" class="btn primary" data-h="vrensave">Übernehmen</button><button type="button" class="btn" data-h="vrencancel">Abbrechen</button></div>
      </div>
      <details data-h="vsavebox">
        <summary><span class="label">Aktuellen Stand als Version speichern</span></summary>
        <div class="vform">
          <input data-h="vname" maxlength="80" placeholder="Name, z. B. Variante A – offene Küche" aria-label="Name der Version">
          <input data-h="vnote" maxlength="300" placeholder="Was ist anders? (optional)" aria-label="Notiz zur Version">
          <div class="row"><button type="button" class="btn primary" data-h="vsavebtn">Speichern</button></div>
        </div>
      </details>
      <div class="vsub">
        <span class="label">Anzeige</span>
        <div class="row">
          <button type="button" class="chip" data-h="t-roof" aria-pressed="true">Dach</button>
          <button type="button" class="chip" data-h="t-terrain" aria-pressed="true">Gelände</button>
          <button type="button" class="chip" data-h="t-labels" aria-pressed="true">Raumnamen</button>
          <button type="button" class="chip" data-h="t-edges" aria-pressed="false">Kanten</button>
          <button type="button" class="chip" data-h="t-furn" aria-pressed="true">Möbel</button>
          <button type="button" class="chip" data-h="t-garden" aria-pressed="true" hidden>Garten</button>
          <button type="button" class="chip" data-h="t-cutfill" aria-pressed="false" hidden>Auf-/Abtrag</button>
          <button type="button" class="chip" data-h="t-contours" aria-pressed="false">Höhenlinien</button>
        </div>
        <div class="levelmeta" data-h="cutfillnote" hidden></div>
        <div class="levelmeta" data-h="gardennote" hidden></div>
      </div>
      <div class="vsub" data-h="ctxsec">
        <span class="label">Umgebung</span>
        <div class="row">
          <button type="button" class="chip" data-h="c-neighbors" aria-pressed="true">Nachbarhäuser</button>
          <button type="button" class="chip" data-h="c-roads" aria-pressed="true">Wege &amp; Bäche</button>
          <button type="button" class="chip" data-h="c-power" aria-pressed="true">Stromleitung</button>
          <button type="button" class="chip" data-h="c-trees" aria-pressed="true">Bäume</button>
          <button type="button" class="chip" data-h="c-addr" aria-pressed="false">Adressen</button>
        </div>
        <p class="note">Gelände aus Laserscan (BEV ALS 1 m bis ±64 m, 5 m bis ±300 m). Gebäudehöhen und Bäume aus dem Oberflächenmodell. Höhenlinien alle 1 m, alle 5 m kräftiger (m ü. A.).</p>
      </div>
      <div class="vsub" data-h="sharesec" hidden></div>
    </div>
    <p class="msg" data-h="vmsg" role="status"></p>
  </section>

  <section class="lvsec">
    <span class="label">Geschoss</span>
    <div class="seg" role="group" aria-label="Geschoss wählen">
      <button type="button" data-h="lv-all" aria-pressed="true">Alles</button>
      <button type="button" data-h="lv-DG" aria-pressed="false">DG</button>
      <button type="button" data-h="lv-EG" aria-pressed="false">EG</button>
      <button type="button" data-h="lv-KG" aria-pressed="false">KG</button>
    </div>
    <div><div class="levelname" data-h="lvname">Gesamtes Haus</div><div class="levelmeta" data-h="lvmeta"></div></div>
  </section>

  <section class="cutsec">
    <span class="label">Schnitt</span>
    <div class="cut">
      <select data-h="cutmode" aria-label="Schnittrichtung">
        <option value="off">Aus</option>
        <option value="x">Quer (A–A)</option>
        <option value="z">Längs</option>
      </select>
      <input type="range" data-h="cutpos" min="-11" max="9" step="0.05" value="0" aria-label="Schnittposition" disabled>
      <span class="mono" data-h="cutval">—</span>
    </div>
  </section>

  <section class="viewsec">
    <span class="label">Ansicht</span>
    <div class="row">
      <button type="button" class="btn" data-view="persp">Perspektive</button>
      <button type="button" class="btn" data-view="NW">NW</button>
      <button type="button" class="btn" data-view="NO">NO</button>
      <button type="button" class="btn" data-view="SO">SO</button>
      <button type="button" class="btn" data-view="SW">SW</button>
      <button type="button" class="btn" data-view="top">Grundriss</button>
      <button type="button" class="btn" data-view="site">Umgebung</button>
      <button type="button" class="btn" data-h="walkbtn" aria-pressed="false" title="In Augenhöhe durch das Haus gehen">Begehen</button>
    </div>
  </section>

  <section class="infosec">
    <div class="vhead"><span class="label">Auswahl</span><button type="button" class="sheetx" data-h="infoclose" aria-label="Auswahl schließen" hidden>×</button></div>
    <div class="info" data-h="info"><span class="empty">Wand, Fenster oder Bauteil antippen, um Maße und ID zu sehen.</span></div>
  </section>

  <section class="editsec" data-h="editsec">
    <details>
      <summary><span class="label">Modelldaten bearbeiten</span></summary>
      <div>
        <p class="note">Alle Bauteile stammen aus diesem JSON (Meter; x längs, z quer, y Höhe, 0.00 = EG-Fußboden). „Anwenden“ zeigt die Änderung als Vorschau; unter „Versionen“ speicherst du sie dauerhaft.</p>
        <textarea data-h="json" spellcheck="false" aria-label="Modelldaten JSON"></textarea>
        <div class="row">
          <button type="button" class="btn primary" data-h="apply">Anwenden</button>
          <button type="button" class="btn" data-h="reset">Zurücksetzen</button>
          <button type="button" class="btn" data-h="copy">Kopieren</button>
        </div>
        <p class="msg" data-h="editmsg" role="status"></p>
      </div>
    </details>
  </section>
</aside>

<div class="compass" aria-hidden="true">
  <svg viewBox="-32 -32 64 64"><circle r="30"/><g data-h="needle"><path d="M0,-24 L6,4 L0,0 L-6,4 Z"/><text x="0" y="-8" text-anchor="middle" dy="-18">N</text></g></svg>
</div>
<div class="corner">
  <button type="button" class="fullbtn" data-h="fullbtn" aria-pressed="false" title="Vollbild">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg><span class="txt">Vollbild</span></button>
  <a class="earth" data-h="earth" href="https://earth.google.com/web/" target="_blank" rel="noopener" title="Diese Ansicht in Google Earth öffnen" hidden>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9M12 3c-2.6 2.6-3.8 5.6-3.8 9s1.2 6.4 3.8 9"/></svg><span class="txt">Google Earth</span></a>
</div>
<div class="scalebar">Ziehen: drehen · Rechts/zwei Finger: verschieben · Rad: zoomen</div>
`

// The GPU's name, e.g. "PowerVR D-Series DXT-48-1536", or '' if the
// browser doesn't tell.
function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return String(name ?? '')
  } catch {
    return ''
  }
}

// Shows the viewer's error box with the reason, for an error that ended
// mountViewer before the model was drawn.
export function showFailure(host, error) {
  const $ = (id) => host.querySelector(`[data-h="${id}"]`)
  if (!$('fail')) return
  $('faildetail').textContent = error?.message ?? String(error)
  $('fail').hidden = false
  $('loading').hidden = true
}

export async function mountViewer(host, opts) {
  const { store } = opts
  const ORIGINAL = opts.model
  const CONTEXT = opts.context ?? null
  // Own wrapper (no box of its own), so a second viewer in the same host
  // (React mounts effects twice in development) never touches this one.
  const view = document.createElement('div')
  view.style.display = 'contents'
  view.innerHTML = VIEW_HTML
  host.classList.add('haus3d')
  host.append(view)
  const $ = (id) => view.querySelector(`[data-h="${id}"]`)

  // Everything that has to be undone when the tab is left.
  let disposed = false, rafId = 0
  const offs = []
  function on(target, type, fn, options) { target.addEventListener(type, fn, options); offs.push(() => target.removeEventListener(type, fn, options)) }
  function fail(msg, detail) {
    if (msg) $('failmsg').textContent = msg
    $('faildetail').textContent = detail || ''
    $('fail').hidden = false; $('loading').hidden = true
  }
  $('failreload').addEventListener('click', () => window.location.reload())
  // Vollbild: the model covers the screen (Esc or the button again leaves it).
  function setFull(full) {
    host.classList.toggle('full', full); $('fullbtn').setAttribute('aria-pressed', String(full))
    document.documentElement.classList.toggle('haus-full', full)
  }
  $('fullbtn').addEventListener('click', () => setFull(!host.classList.contains('full')))
  function dispose() {
    if (disposed) return
    disposed = true
    cancelAnimationFrame(rafId); clearTimeout(ctxLostTimer)
    offs.forEach((off) => off()); ro?.disconnect(); controls?.dispose()
    scene?.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose?.(); m.dispose?.() }) })
    _terrainTex?.dispose()
    if (renderer) { renderer.dispose(); renderer.forceContextLoss(); }
    host.classList.remove('full', 'walking'); document.documentElement.classList.remove('haus-full')
    view.remove()
  }

  let DATA = structuredClone(ORIGINAL);

  // ---------- renderer / scene ----------
  const stage = $('stage');
  const PHONE = matchMedia('(max-width: 700px), (pointer: coarse)').matches;
  // Light mode: no shadows, no antialiasing, fewer pixels. Used on GPUs
  // that crash with the full view (the Pixel 10's PowerVR) and after the
  // GPU dropped the view once on this device.
  const LITE = Boolean(opts.lite) || /powervr/i.test(gpuName());
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: !LITE, powerPreference: PHONE ? 'low-power' : 'default' }); }
  catch {
    // Some phone GPUs refuse a context with antialiasing: try once without.
    try { renderer = new THREE.WebGLRenderer({ antialias: false }); }
    catch (e) { fail('Dieses Gerät oder dieser Browser kann die 3D-Ansicht nicht anzeigen (WebGL nicht verfügbar).', e.message); throw e; }
  }
  renderer.setPixelRatio(LITE ? 1 : Math.min(window.devicePixelRatio, PHONE ? 1.5 : 2));
  renderer.shadowMap.enabled = !LITE;
  renderer.shadowMap.type = PHONE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = false;
  // A shader the device's GPU driver rejects would otherwise only show a
  // grey box: say so, with the driver's message.
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    const log = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)]
    fail('Die Grafik dieses Geräts kann die 3D-Ansicht nicht zeichnen.', log.map((l) => l?.trim()).filter(Boolean).join(' ').slice(0, 300))
  }
  stage.appendChild(renderer.domElement);
  // the GPU can drop the WebGL context (memory pressure on phones, app in background): wait for it to come back and rebuild,
  // otherwise offer a reload instead of leaving a blank canvas
  let ctxLost = false, ctxLostTimer = 0;
  on(renderer.domElement, 'webglcontextlost', e => {
    e.preventDefault(); ctxLost = true; $('loading').hidden = false;
    // Dropped while in view (not because the app went to the background):
    // start again in light mode.
    if (!LITE && !document.hidden && opts.onLost) { opts.onLost(); return; }
    clearTimeout(ctxLostTimer); ctxLostTimer = setTimeout(() => fail('Die Grafik wurde vom Gerät zurückgesetzt (zu wenig Speicher).', 'Neu laden zeigt das Modell wieder an.'), 8000);
  });
  on(renderer.domElement, 'webglcontextrestored', () => {
    clearTimeout(ctxLostTimer); ctxLost = false;
    try { if (_terrainTex) { paintTerrain(); } build(DATA); setLevel(state.level); $('loading').hidden = true; kick(1000); }
    catch (e) { fail('Die 3D-Ansicht konnte nach einem Grafik-Reset nicht neu aufgebaut werden.', e.message); }
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.53;
  controls.minDistance = 3;
  controls.maxDistance = 700;

  scene.add(new THREE.HemisphereLight(0xf4f7ff, 0x6b6250, 1.15));
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(PHONE ? 1024 : 2048, PHONE ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 120 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  function cssVar(n) { return getComputedStyle(host).getPropertyValue(n.replace(/^--/, '--h-')).trim(); }
  function applyTheme() {
    const bg = new THREE.Color(cssVar('--scene') || '#e2e6e0');
    scene.background = bg;
    scene.fog = new THREE.Fog(bg, 220, 950);
    if (edgeMat) edgeMat.color.set(cssVar('--edge') || '#27302b');
  }
  let edgeMat = null;
  on(matchMedia('(prefers-color-scheme: dark)'), 'change', applyTheme);

  // ---------- textures ----------
  function canvasTex(w, h, draw, repeatX = 1, repeatY = 1) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeatX, repeatY);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  function tileTexture(base) {
    return canvasTex(128, 128, (g, w, h) => {
      const c = new THREE.Color(base);
      g.fillStyle = '#' + c.getHexString(); g.fillRect(0, 0, w, h);
      for (let row = 0; row < 4; row++) {
        const y = row * 32;
        g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, y + 28, w, 4);
        const off = row % 2 ? 16 : 0;
        for (let x = off; x < w + 32; x += 32) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, y, 2, 30); }
        g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, y, w, 6);
      }
    });
  }
  function boardTexture(base, vertical = true) {
    return canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.28)';
      for (let i = 0; i < 64; i += 8) { if (vertical) g.fillRect(i, 0, 1.5, h); else g.fillRect(0, i, w, 1.5); }
    });
  }
  // floor finishes: texture covers 1.2 x 1.2 m (repeat = 1 / 1.2 per metre of shape coordinates)
  function parquetTexture() {   // oak planks 15 cm wide, 1.2 m long, staggered joints
    return canvasTex(512, 512, (g, w, h) => {
      const n = 8, pw = w / n;
      for (let i = 0; i < n; i++) {
        const off = ((i * 37) % 8) / 8 * h;
        for (let k = -1; k < 2; k++) {
          const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453 % 1, l = 58 + 6 * Math.abs(v);
          g.fillStyle = `hsl(33, 42%, ${l}%)`; g.fillRect(i * pw, off + k * h, pw, h);
          g.fillStyle = 'rgba(90,60,30,0.08)'; for (let s = 0; s < 6; s++) g.fillRect(i * pw + 4 + s * pw / 6, off + k * h, 1, h);
          g.fillStyle = 'rgba(60,40,20,0.35)'; g.fillRect(i * pw, off + k * h, pw, 2);
        }
        g.fillStyle = 'rgba(60,40,20,0.35)'; g.fillRect(i * pw, 0, 1.5, h);
      }
    }, 1 / 1.2, 1 / 1.2);
  }
  function tileTextureWhite(a = '#f4f4f1', b = '#f0f0ec', grout = '#c9c9c4') {   // 60 x 60 cm tiles (default white, light grey grout)
    return canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = grout; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? a : b; g.fillRect(i * w / 2 + 1, j * h / 2 + 1, w / 2 - 2, h / 2 - 2); }
    }, 1 / 1.2, 1 / 1.2);
  }
  function louvreTexture(base) {
    return canvasTex(32, 64, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 6) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(2, y, w - 4, 2); }
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, 2, h); g.fillRect(w - 2, 0, 2, h);
    });
  }

  // ---------- roof model ----------
  function makeRoof(r) {
    const k = Math.tan(r.pitch * Math.PI / 180), R = r.ridgeHeight;
    const ez = r.eaves.z[1], eaveH = R - k * ez;
    const crosses = (r.crossGables || []).map(cg => {
      const half = cg.width / 2;
      const kc = cg.pitch != null ? Math.tan(cg.pitch * Math.PI / 180) : (cg.ridgeHeight - eaveH) / half;
      const Rc = cg.ridgeHeight != null ? cg.ridgeHeight : eaveH + kc * half;
      const s = cg.side === '+z' ? 1 : -1;
      const zv0 = Math.max(0, (R - Rc) / k);
      return { ...cg, half, kc, Rc, s, zv0, zOut: Math.abs(cg.extendTo) };
    });
    // shed dormers: front wall in the facade (outer face at |z| = wallZ), roof rising inward at `pitch` until it meets the main roof at |z| = a
    const dormers = (r.dormers || []).map(d => {
      const s = d.side === '+z' ? 1 : -1, kd = Math.tan(d.pitch * Math.PI / 180);
      const a = (R - d.eaveHeight - kd * d.wallZ) / (k - kd), ov = d.overhang ?? 0.4, sov = d.sideOverhang ?? 0.25;
      return { ...d, s, kd, a, ov, sov, x0: d.x[0], x1: d.x[1], h: sz => d.eaveHeight + kd * (d.wallZ - sz) };
    });
    const main = (x, z) => (x >= r.eaves.x[0] - 1e-6 && x <= r.eaves.x[1] + 1e-6 && Math.abs(z) <= ez + 1e-6) ? R - k * Math.abs(z) : -Infinity;
    function top(x, z, wallsOnly = false) {
      let h = main(x, z);
      for (const c of crosses) {
        if (wallsOnly && !c.raisesWalls) continue;
        const a = Math.abs(x - c.center), sz = c.s * z;
        if (a <= c.half + 1e-6 && sz >= c.zv0 - 1e-6 && sz <= c.zOut + 1e-6) h = Math.max(h, c.Rc - c.kc * a);
      }
      for (const d of dormers) {
        const sz = d.s * z;
        if (x >= d.x0 - 1e-6 && x <= d.x1 + 1e-6 && sz >= d.a - 1e-6 && sz <= d.wallZ + 1e-6) h = Math.max(h, d.h(sz));
      }
      return h;
    }
    return { k, R, ez, eaveH, crosses, dormers, main, top, r };
  }

  // ---------- geometry helpers ----------
  // prism from a 2D polygon in (x,z) with per-vertex top height and constant vertical thickness
  function prismGeometry(outline, holes, topFn, thickness, uvFn) {
    const v2 = p => new THREE.Vector2(p[0], p[1]);
    let contour = outline.map(v2);
    if (THREE.ShapeUtils.isClockWise(contour)) contour = contour.reverse();
    const hs = (holes || []).map(h => { let a = h.map(v2); if (!THREE.ShapeUtils.isClockWise(a)) a = a.reverse(); return a; });
    const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
    const pts = contour.concat(...hs);
    const bot = typeof thickness === 'function' ? thickness : (x, z) => topFn(x, z) - thickness;
    const pos = [], uv = [];
    const push = (x, y, z) => { pos.push(x, y, z); const t = uvFn ? uvFn(x, y, z) : [x, z]; uv.push(t[0], t[1]); };
    for (const [a, b, c] of tris) {
      for (const i of [a, b, c]) push(pts[i].x, topFn(pts[i].x, pts[i].y), pts[i].y);
      for (const i of [a, c, b]) push(pts[i].x, bot(pts[i].x, pts[i].y), pts[i].y);
    }
    for (const ring of [contour, ...hs]) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        const pt = topFn(p.x, p.y), qt = topFn(q.x, q.y), pb = bot(p.x, p.y), qb = bot(q.x, q.y);
        push(p.x, pt, p.y); push(q.x, qb, q.y); push(q.x, qt, q.y);
        push(p.x, pt, p.y); push(p.x, pb, p.y); push(q.x, qb, q.y);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }
  function box(w, h, d, mat) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = m.receiveShadow = true; return m; }


  // ---------- site context (context/terrain.json + neighborhood.json) ----------
  function bilinear(G, x, z) {
    const f = (arr, v) => { let i = 0; while (i < arr.length - 2 && v > arr[i + 1]) i++; return [i, Math.min(1, Math.max(0, (v - arr[i]) / (arr[i + 1] - arr[i])))]; };
    const [xi, tx] = f(G.xs, x), [zi, tz] = f(G.zs, z), r = G.heights;
    const a = r[zi][xi] * (1 - tx) + r[zi][xi + 1] * tx, b = r[zi + 1][xi] * (1 - tx) + r[zi + 1][xi + 1] * tx;
    return a * (1 - tz) + b * tz;
  }
  function terrainHeightFn(T, CT) {
    const near = (x, z) => bilinear(T, x, z);
    if (!CT) return near;
    const r0 = CT.blend?.innerRadius ?? 20, r1 = CT.blend?.outerRadius ?? 40;
    const F = CT.fine, fe = F ? Math.min(-F.xs[0], F.xs[F.xs.length - 1], -F.zs[0], F.zs[F.zs.length - 1]) : 0;
    const scan = (x, z) => { const c = bilinear(CT, x, z); if (!F) return c; const e = Math.max(Math.abs(x), Math.abs(z)); if (e >= fe) return c;
      const f = bilinear(F, x, z); if (e <= fe - 6) return f; const t = (e - fe + 6) / 6; return f * (1 - t) + c * t; };
    return (x, z) => { const r = Math.hypot(x, z); if (r <= r0) return near(x, z); const far = scan(x, z); if (r >= r1) return far;
      const t = (r - r0) / (r1 - r0), s = t * t * (3 - 2 * t); return near(x, z) * (1 - s) + far * s; };
  }
  // terrain edits per version (D.grading): level areas and sloped areas with a Böschung (batter 1:n) to the existing ground,
  // retaining walls stop the Böschung (vertical step at the wall). Applied in order on top of the measured terrain.
  function polyInside(poly, x, z) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
  function polyNearest(poly, x, z) { let best = [Infinity, x, z]; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [ax, az] = poly[j], [bx, bz] = poly[i]; const vx = bx - ax, vz = bz - az; const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1))); const qx = ax + t * vx, qz = az + t * vz, d = Math.hypot(x - qx, z - qz); if (d < best[0]) best = [d, qx, qz]; } return best; }
  function segCross(p1, p2, p3, p4) { const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const d1 = o(p3, p4, p1), d2 = o(p3, p4, p2), d3 = o(p1, p2, p3), d4 = o(p1, p2, p4); return d1 * d2 < 0 && d3 * d4 < 0; }
  function gradeFn(H0, grading) {
    const areas = (grading || []).filter(g => (g.type === 'level' || g.type === 'slope' || g.type === 'pool') && g.outline?.length >= 3)
      .map(g => g.type === 'pool' ? { ...g, type: 'level', height: g.top - g.depth, batter: 0.01 } : g);
    if (!areas.length) return H0;
    const walls = (grading || []).filter(g => g.type === 'wall' && g.points?.length >= 2);
    const items = areas.map(a => {
      const n = a.batter ?? 1.5, xs = a.outline.map(p => p[0]), zs = a.outline.map(p => p[1]), R = a.reach ?? 25;
      let h = () => a.height;
      if (a.type === 'slope') { const [x0, z0, y0] = a.from, [x1, z1, y1] = a.to, vx = x1 - x0, vz = z1 - z0, L2 = vx * vx + vz * vz || 1;
        h = (x, z) => y0 + (y1 - y0) * Math.max(0, Math.min(1, ((x - x0) * vx + (z - z0) * vz) / L2)); }
      return { a, n, h, bb: [Math.min(...xs) - R, Math.max(...xs) + R, Math.min(...zs) - R, Math.max(...zs) + R] };
    });
    const blocked = (x, z, qx, qz) => walls.some(w => w.points.some((p, i) => i > 0 && segCross([x, z], [qx, qz], w.points[i - 1], p)));
    return (x, z) => {
      let y = H0(x, z);
      for (const it of items) {
        if (x < it.bb[0] || x > it.bb[1] || z < it.bb[2] || z > it.bb[3]) continue;
        if (polyInside(it.a.outline, x, z)) { y = it.h(x, z); continue; }
        const [d, qx, qz] = polyNearest(it.a.outline, x, z), t = it.h(qx, qz);
        if (Math.abs(y - t) * it.n <= d) continue;
        if (walls.length && blocked(x, z, qx, qz)) continue;
        y = Math.max(t - d / it.n, Math.min(t + d / it.n, y));
      }
      return y;
    };
  }
  function terrainExtent(T, CT) { const G = CT || T; return [G.xs[0], G.xs[G.xs.length - 1], G.zs[0], G.zs[G.zs.length - 1]]; }
  const LANDUSE = { forest: '#55703f', shrub: '#6d8a50', wood: '#55703f', farmland: '#b3ad74', crop: '#b3ad74', meadow: '#98ae6f', grass: '#90ad67',
    garden: '#8aa866', residential: '#a3a78a', farmyard: '#a69e83', plant_nursery: '#7f9b5c', park: '#8fae6a' };
  const ROADCOL = { service: '#bdb7aa', unclassified: '#b3ada1', residential: '#b3ada1', track: '#b9a37c', path: '#c8b48f' };
  let _terrainTex = null;
  function terrainTexture() {
    if (_terrainTex) return _terrainTex;
    const c = document.createElement('canvas'); c.width = c.height = PHONE ? 1024 : 2048;
    _terrainTex = new THREE.CanvasTexture(c); _terrainTex.colorSpace = THREE.SRGBColorSpace; _terrainTex.anisotropy = PHONE ? 4 : 8; _terrainTex.userData.keep = true;
    paintTerrain(); return _terrainTex;
  }
  function paintTerrain() {
    if (!_terrainTex) return;
    const c = _terrainTex.image, g = c.getContext('2d'), N = CONTEXT?.neighborhood, ext = terrainExtent(DATA.terrain, CONTEXT?.terrain);
    const sx = c.width / (ext[1] - ext[0]), sz = c.height / (ext[3] - ext[2]);
    const P = p => [(p[0] - ext[0]) * sx, (p[p.length === 3 ? 2 : 1] - ext[2]) * sz];
    g.fillStyle = DATA.materials.terrain; g.fillRect(0, 0, c.width, c.height);
    const ring = (pts) => { pts.forEach((p, i) => { const [u, v] = P(p); if (i) g.lineTo(u, v); else g.moveTo(u, v); }); g.closePath(); };
    for (const a of N?.areas || []) {
      if (!a.outline) continue;
      const key = a.layer === 'water' ? 'water' : (a.class || a.subtype);
      const col = key === 'water' ? '#5fa3c4' : LANDUSE[key] || LANDUSE[a.subtype];
      if (!col) continue;
      g.beginPath(); ring(a.outline); for (const h of a.holes || []) ring(h);
      g.fillStyle = col; g.fill('evenodd');
    }
    g.lineCap = g.lineJoin = 'round';
    if (state.roads) {
      for (const a of N?.areas || []) if (a.line) { g.beginPath(); a.line.forEach((p, i) => { const [u, v] = P(p); if (i) g.lineTo(u, v); else g.moveTo(u, v); }); g.strokeStyle = '#4f86a8'; g.lineWidth = 1.6 * sx; g.stroke(); }
      for (const r of N?.roads || []) { g.beginPath(); r.points.forEach((p, i) => { const [u, v] = P(p); if (i) g.lineTo(u, v); else g.moveTo(u, v); });
        g.strokeStyle = ROADCOL[r.class] || '#b3ada1'; g.lineWidth = Math.max(1.5, r.width || 3) * sx; g.stroke(); }
    }
    _terrainTex.needsUpdate = true;
  }
  const ctxGroups = { buildings: new THREE.Group(), power: new THREE.Group(), addresses: new THREE.Group(), trees: new THREE.Group() };
  const ctxPickables = [];
  // trees the camera is inside (or right next to) are hidden so they never fill the whole view
  let treeCull = null;
  const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
  function cullTrees() {
    if (!treeCull || !ctxGroups.trees.visible) return;
    const { trees, trunks, crowns, hidden } = treeCull, c = camera.position; let dirty = false;
    trees.forEach((t, i) => {
      const near = Math.hypot(c.x - t.x, c.z - t.z) < t.r + 3 && c.y < t.y + t.h + 2;
      if (near === hidden.has(i)) return;
      dirty = true; if (near) hidden.add(i); else hidden.delete(i);
      trunks.setMatrixAt(i, near ? ZERO_M : t.mTrunk); crowns.setMatrixAt(i, near ? ZERO_M : t.mCrown);
    });
    if (dirty) { trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true; trunks.computeBoundingSphere(); crowns.computeBoundingSphere(); }
  }
  function buildContext() {
    const N = CONTEXT?.neighborhood; if (!N) return;
    for (const g of Object.values(ctxGroups)) scene.add(g);
    const wallM = new THREE.MeshStandardMaterial({ color: 0xe4ded3, roughness: 0.95, side: THREE.DoubleSide });
    const roofM = new THREE.MeshStandardMaterial({ color: 0x9b5c46, roughness: 0.9, side: THREE.DoubleSide });
    const flatM = new THREE.MeshStandardMaterial({ color: 0x8e8a84, roughness: 0.9, side: THREE.DoubleSide });
    const ctxEdge = new THREE.LineBasicMaterial({ color: 0x27302b, transparent: true, opacity: 0.25 });
    for (const b of N.buildings) {
      const fp = b.footprint; if (!fp || fp.length < 3) continue;
      const base = b.baseY, n = fp.length;
      let top, outline = fp, halves = null;
      if (b.roofShape === 'gable' && b.ridgeDir && b.ridgeHeight > b.eaveHeight) {
        const [rx, rz] = b.ridgeDir, nx = -rz, nz = rx, dot = p => p[0] * nx + p[1] * nz;
        const ds = fp.map(dot), dmin = Math.min(...ds), dmax = Math.max(...ds), dm = (dmin + dmax) / 2, half = (dmax - dmin) / 2;
        const k = (b.ridgeHeight - b.eaveHeight) / half;
        top = (x, z) => base + b.ridgeHeight - k * Math.abs(x * nx + z * nz - dm);
        outline = [];
        for (let i = 0; i < n; i++) { const p = fp[i], q = fp[(i + 1) % n], dp = dot(p) - dm, dq = dot(q) - dm; outline.push(p);
          if (dp * dq < 0) { const t = dp / (dp - dq); outline.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); } }
        const clip = sgn => outline.filter(p => sgn * (dot(p) - dm) >= -1e-6);
        halves = [clip(1), clip(-1)].filter(h => h.length >= 3);
      } else { const h = base + Math.max(b.eaveHeight || 3, b.ridgeHeight || 0); top = () => h; }
      const tag = m => { m.userData = { kind: 'neighbor', data: b }; ctxPickables.push(m); m.receiveShadow = true; ctxGroups.buildings.add(m); return m; };
      const body = tag(new THREE.Mesh(prismGeometry(outline, [], (x, z) => top(x, z) - 0.03, () => base - 0.6), wallM));
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry, 30), ctxEdge); ctxGroups.buildings.add(e);
      if (halves) for (const h of halves) tag(new THREE.Mesh(prismGeometry(h, [], (x, z) => top(x, z) + 0.22, 0.22), roofM));
      else tag(new THREE.Mesh(prismGeometry(fp, [], (x, z) => top(x, z) + 0.15, 0.15), flatM));
    }
    const wood = new THREE.MeshStandardMaterial({ color: 0x5d4632, roughness: 0.9 });
    const wire = new THREE.LineBasicMaterial({ color: 0x2b2b2b });
    for (const it of N.infrastructure || []) {
      if (it.point) { const [x, y, z] = it.point; const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 9, 8), wood); m.position.set(x, y + 4.5, z); m.userData = { kind: 'infra', data: it }; ctxPickables.push(m); ctxGroups.power.add(m); }
      if (it.line) { const g = new THREE.BufferGeometry().setFromPoints(it.line.map(([x, y, z]) => new THREE.Vector3(x, y + 8.6, z))); ctxGroups.power.add(new THREE.Line(g, wire)); }
    }
    // trees from the ALS surface model: [x, groundY, z, height, crownRadius], drawn within 150 m
    const trees = (N.trees || []).filter(t => Math.hypot(t[0], t[2]) <= 150).map(([x, y, z, h, r]) => ({ x, y, z, h, r }));
    if (trees.length) {
      const trunkM = new THREE.MeshStandardMaterial({ color: 0x5a4532, roughness: 0.95 });
      const crownM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
      const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 1, 1, 6), trunkM, trees.length);
      const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), crownM, trees.length);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
      trees.forEach((t, i) => {
        const ch = Math.max(1.5, Math.min(t.h * 0.75, t.h - 1.2)), cy = t.y + t.h - ch / 2, tr = 0.12 + 0.012 * t.h, th = cy - t.y + 0.6;
        t.mTrunk = mtx.compose(new THREE.Vector3(t.x, t.y - 0.6 + th / 2, t.z), q, new THREE.Vector3(tr, th, tr)).clone(); trunks.setMatrixAt(i, t.mTrunk);
        t.mCrown = mtx.compose(new THREE.Vector3(t.x, cy, t.z), q, new THREE.Vector3(t.r, ch / 2, t.r)).clone(); crowns.setMatrixAt(i, t.mCrown);
        const v = Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453 % 1;
        crowns.setColorAt(i, col.setHSL(0.24 + 0.05 * v, 0.38, 0.27 + 0.06 * Math.abs(v)));
      });
      trunks.castShadow = crowns.castShadow = true; crowns.receiveShadow = true;
      trunks.userData = crowns.userData = { kind: 'tree', items: trees };
      ctxGroups.trees.add(trunks, crowns); ctxPickables.push(trunks, crowns);
      treeCull = { trees, trunks, crowns, hidden: new Set() };
    }
    for (const a of N.addresses || []) {
      const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d');
      g.font = '500 44px Barlow, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 9;
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.fillStyle = '#1d2420'; g.strokeText(a.label, 256, 48); g.fillText(a.label, 256, 48);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
      const y = CONTEXT.terrain ? bilinear(CONTEXT.terrain, a.x, a.z) : 0;
      sp.position.set(a.x, y + 9, a.z); sp.scale.set(0.12, 0.0225, 1); sp.material.sizeAttenuation = false; sp.renderOrder = 9;
      ctxGroups.addresses.add(sp);
    }
  }

  // ---------- contour lines (Höhenlinien) on the terrain mesh: every 1 m, every 5 m bold, absolute heights (m ü. A.) ----------
  function buildContours() {
    const geo = terrainMesh.geometry, P = geo.attributes.position.array, I = geo.index.array;
    const base = CONTEXT?.neighborhood?.meta?.georef?.egFloorAbsoluteM ?? 0;   // model y + base = height above sea level
    const minor = [], major = [], lift = 0.06;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ya = P[a + 1] + base, yb = P[b + 1] + base, yc = P[c + 1] + base;
      const lo = Math.ceil(Math.min(ya, yb, yc)), hi = Math.floor(Math.max(ya, yb, yc));
      for (let L = lo; L <= hi; L++) {
        const pts = [];
        for (const [p, q, yp, yq] of [[a, b, ya, yb], [b, c, yb, yc], [c, a, yc, ya]]) {
          if ((yp < L) === (yq < L) || yp === yq) continue;
          const k = (L - yp) / (yq - yp);
          pts.push(P[p] + (P[q] - P[p]) * k, L - base + lift, P[p + 2] + (P[q + 2] - P[p + 2]) * k);
        }
        if (pts.length === 6) (L % 5 === 0 ? major : minor).push(...pts);
      }
    }
    contourGroup = new THREE.Group(); contourGroup.renderOrder = 3;
    const add = (arr, color, opacity) => { if (!arr.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity })); l.renderOrder = 3; contourGroup.add(l); };
    add(minor, 0x4a3b28, 0.45); add(major, 0x2e2416, 0.9);
    terrainMesh.parent.add(contourGroup);
  }

  // ---------- build ----------
  let terrainMesh = null, contourGroup = null;
  let root = null, groups = {}, labelSprites = [], pickables = [], edgeLines = []; let furnGroups = []; let cutfillGroup = null, cutfillVol = null;
  const FACADE = { NO: [1, 0], SW: [-1, 0], SO: [0, 1], NW: [0, -1] };

  function build(D) {
    if (root) {
      scene.remove(root);
      root.traverse(o => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach(m => { if (!m.map?.userData?.keep) m.map?.dispose?.(); m.dispose?.(); }); });
    }
    root = new THREE.Group(); scene.add(root);
    groups = {}; labelSprites = []; pickables = []; edgeLines = []; furnGroups = [];
    for (const id of ['KG', 'EG', 'DG', 'roof', 'terrain', 'ceiling', 'garden']) { groups[id] = new THREE.Group(); groups[id].name = id; root.add(groups[id]); }
    const M = D.materials;
    const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, ...extra });
    const mats = {
      plaster: mat(M.plaster), plasterKG: mat(M.plasterKG), interior: mat(M.interior), slab: mat(M.slab),
      stone: mat(M.stone), roof: mat(0xffffff, { map: tileTexture(M.roof) }), roofUnder: mat(M.roofUnder),
      wood: mat(M.wood), woodBoards: mat(0xffffff, { map: boardTexture(M.wood) }), frame: mat(M.frame, { roughness: 0.6 }),
      glass: new THREE.MeshStandardMaterial({ color: M.glass, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
      shutter: mat(0xffffff, { map: louvreTexture(M.shutter) }), terrain: CONTEXT ? new THREE.MeshStandardMaterial({ color: 0xffffff, map: terrainTexture(), roughness: 1, side: THREE.DoubleSide }) : mat(M.terrain, { side: THREE.FrontSide }), chimney: mat(M.chimney),
      glassRoof: new THREE.MeshStandardMaterial({ color: 0x3c4c58, roughness: 0.2, metalness: 0.2 }),
    };
    edgeMat = new THREE.LineBasicMaterial({ color: cssVar('--edge') || '#27302b', transparent: true, opacity: 0.35 });
    const addEdges = (mesh, parent, angle = 28) => {
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, angle), edgeMat);
      l.position.copy(mesh.position); l.rotation.copy(mesh.rotation); l.scale.copy(mesh.scale);
      l.userData.isEdge = true; parent.add(l); edgeLines.push(l);
    };

    const levels = Object.fromEntries(D.levels.map(l => [l.id, l]));
    const roof = makeRoof(D.roof);

    // walls
    for (const w of D.walls) {
      const lvl = levels[w.level], g = groups[w.level];
      const [ax, az] = w.start, [bx, bz] = w.end;
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 1e-3) continue;
      const ux = dx / L, uz = dz / L, nx = -uz, nz = ux, t = w.thickness;
      let topPts;
      if (typeof w.top === 'number') topPts = [[L, w.top], [0, w.top]];
      else {
        const N = Math.max(2, Math.ceil(L / 0.1)); topPts = [];
        for (let i = N; i >= 0; i--) {
          const u = L * i / N, px = ax + ux * u, pz = az + uz * u;
          let h = Math.min(roof.top(px + nx * t / 2, pz + nz * t / 2, true), roof.top(px - nx * t / 2, pz - nz * t / 2, true)) - 0.03;
          if (w.topCap != null) h = Math.min(h, w.topCap);
          if (!isFinite(h)) h = (w.topCap ?? lvl.floor + 2.6);
          topPts.push([u, h]);
        }
      }
      // lowest wall top between u0 and u1 (top profile is piecewise linear, sampled from L down to 0)
      const topAt = u => { for (let i = 0; i + 1 < topPts.length; i++) { const [ua, ha] = topPts[i], [ub, hb] = topPts[i + 1]; if (u <= ua + 1e-9 && u >= ub - 1e-9) return ua === ub ? Math.min(ha, hb) : ha + (hb - ha) * (ua - u) / (ua - ub); } return topPts[topPts.length - 1][1]; };
      const minTopIn = (u0, u1) => Math.min(topAt(u0), topAt(u1), ...topPts.filter(p => p[0] > u0 && p[0] < u1).map(p => p[1]));
      const ops = (w.openings || []).map(o => ({ o, u0: o.at - o.width / 2, u1: o.at + o.width / 2, h0: lvl.floor + o.sill, h1: lvl.floor + o.sill + o.height }))
        .map(p => ({ ...p, u0: Math.max(0.02, p.u0), u1: Math.min(L - 0.02, p.u1) }))
        .map(p => ({ ...p, h1: Math.min(p.h1, minTopIn(p.u0, p.u1) - 0.05) }))
        .sort((a, b) => a.u0 - b.u0);
      const shape = new THREE.Shape();
      shape.moveTo(0, w.base);
      for (const p of ops.filter(p => p.h0 <= w.base + 0.005)) {
        shape.lineTo(p.u0, w.base); shape.lineTo(p.u0, p.h1); shape.lineTo(p.u1, p.h1); shape.lineTo(p.u1, w.base);
      }
      shape.lineTo(L, w.base);
      for (const [u, h] of topPts) shape.lineTo(u, h);
      shape.closePath();
      for (const p of ops.filter(p => p.h0 > w.base + 0.005)) {
        const hole = new THREE.Path();
        hole.moveTo(p.u0, p.h0); hole.lineTo(p.u0, p.h1); hole.lineTo(p.u1, p.h1); hole.lineTo(p.u1, p.h0); hole.closePath();
        shape.holes.push(hole);
      }
      const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 });
      geo.translate(0, 0, -t / 2);
      const ext = w.kind === 'exterior';
      const mesh = new THREE.Mesh(geo, ext ? (w.level === 'KG' ? mats.plasterKG : mats.plaster) : mats.interior);
      mesh.position.set(ax, 0, az); mesh.rotation.y = Math.atan2(-dz, dx);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData = { kind: 'wall', data: w };
      g.add(mesh); pickables.push(mesh); addEdges(mesh, g);

      // inserts (windows, doors, shutters) in the wall's local frame
      const F = FACADE[w.facade];
      const out = F ? Math.sign(nx * F[0] + nz * F[1]) || 1 : 1;
      const local = new THREE.Group(); local.position.copy(mesh.position); local.rotation.copy(mesh.rotation); g.add(local);
      for (const p of ops) {
        const o = p.o, wd = p.u1 - p.u0, ht = p.h1 - p.h0, cu = (p.u0 + p.u1) / 2, ch = (p.h0 + p.h1) / 2;
        const tag = (m) => { m.userData = { kind: 'opening', data: o, wall: w }; pickables.push(m); return m; };
        if (o.type === 'window' || o.style === 'glazed') {
          if (!ext) continue;
          const zf = out * (t / 2 - 0.12), f = 0.06, fd = 0.07;
          const fr = new THREE.Group(); fr.position.set(cu, ch, zf); local.add(fr);
          fr.add(tag(box(wd, f, fd, mats.frame)).translateY(ht / 2 - f / 2));
          fr.add(tag(box(wd, f, fd, mats.frame)).translateY(-ht / 2 + f / 2));
          fr.add(tag(box(f, ht, fd, mats.frame)).translateX(-wd / 2 + f / 2));
          fr.add(tag(box(f, ht, fd, mats.frame)).translateX(wd / 2 - f / 2));
          if (o.fixedLower) fr.add(tag(box(wd - 2 * f, f, fd, mats.frame)).translateY(-ht / 2 + o.fixedLower));  // two-part: fixed lower glazing
          const gl = tag(new THREE.Mesh(new THREE.BoxGeometry(wd - 2 * f, ht - 2 * f, 0.02), mats.glass)); fr.add(gl);
          if (o.type === 'window') {
            const sill = box(wd + 0.08, 0.04, 0.2, mats.stone); sill.position.set(cu, p.h0 - 0.02, out * (t / 2 + 0.04)); local.add(tag(sill));
          }
          if (o.shutters) {
            for (const sgn of [-1, 1]) {
              const sh = tag(box(wd / 2, ht, 0.035, mats.shutter));
              sh.position.set(cu + sgn * (wd * 0.75 + 0.03), ch, out * (t / 2 + 0.03)); local.add(sh);
            }
          }
        } else if (o.style === 'entrance' || o.style === 'garage') {
          const leafM = o.color ? new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.45, metalness: 0.25 }) : mats.woodBoards;
          const leaf = tag(box(wd, ht, 0.06, leafM));
          leaf.position.set(cu, ch, out * (t / 2 - 0.1)); local.add(leaf);
          if (o.design === 'modern') {   // flush leaf, narrow vertical glass strip, long stainless bar handle
            const zf = out * (t / 2 - 0.1);
            const strip = tag(box(0.12, ht * 0.78, 0.07, mats.glass)); strip.position.set(cu - wd * 0.28, p.h0 + ht * 0.5, zf); local.add(strip);
            const steel = new THREE.MeshStandardMaterial({ color: 0xc9ccce, roughness: 0.25, metalness: 0.9 });
            const bar = tag(box(0.035, 1.3, 0.035, steel)); bar.position.set(cu + wd * 0.36, p.h0 + 1.05, zf + out * 0.09); local.add(bar);
            for (const dy of [-0.5, 0.5]) { const st = tag(box(0.02, 0.02, 0.09, steel)); st.position.set(cu + wd * 0.36, p.h0 + 1.05 + dy, zf + out * 0.045); local.add(st); }
          } else if (o.style === 'entrance') { const win = tag(box(wd * 0.45, ht * 0.18, 0.07, mats.glass)); win.position.set(cu, p.h0 + ht * 0.78, out * (t / 2 - 0.1)); local.add(win); }
        }
      }
    }

    // facade insulation (D.insulation: {level, outline, thickness, base, top: number | 'roof', material}): a skin on the outer
    // footprint, one piece per edge, extended over convex corners, with the exterior wall openings of that level cut out
    for (const ins of D.insulation || []) {
      const lvl = levels[ins.level], g = groups[ins.level], P = ins.outline, n = P.length, t = ins.thickness;
      if (!lvl || n < 3) continue;
      let area = 0; for (let i = 0; i < n; i++) { const [x1, z1] = P[i], [x2, z2] = P[(i + 1) % n]; area += x1 * z2 - x2 * z1; }
      const sgn = Math.sign(area), dir = i => { const [x1, z1] = P[i % n], [x2, z2] = P[(i + 1) % n], L = Math.hypot(x2 - x1, z2 - z1); return [(x2 - x1) / L, (z2 - z1) / L, L]; };
      const convex = i => { const [ax, az] = dir((i + n - 1) % n), [bx, bz] = dir(i); return Math.sign(ax * bz - az * bx) === sgn; };   // at vertex i
      const extW = D.walls.filter(w => w.level === ins.level && w.kind === 'exterior');
      const imat = mats[ins.material] || mats.plaster;
      for (let i = 0; i < n; i++) {
        const [ux, uz, L] = dir(i), [x0, z0] = P[i];
        let nx = uz, nz = -ux; if (!polyInside(P, x0 + ux * L / 2 - nx * 0.05, z0 + uz * L / 2 - nz * 0.05)) { nx = -nx; nz = -nz; }   // outward
        const e0 = convex(i) ? t : 0, e1 = convex((i + 1) % n) ? t : 0, u0 = -e0, u1 = L + e1;
        const ox = x0 + nx * t, oz = z0 + nz * t;                 // outer face line
        const topOf = u => { if (typeof ins.top === 'number') return ins.top;
          const ho = roof.top(ox + ux * u, oz + uz * u, true), hi = roof.top(x0 + ux * u - nx * 0.02, z0 + uz * u - nz * 0.02, true);
          const h = (hi > ho + 0.5 ? hi : ho) - 0.03; return isFinite(h) ? h : lvl.floor + 2.6; };   // hi: dormer front walls in the facade line rise above the main roof
        const shape = new THREE.Shape(); shape.moveTo(u0, ins.base); shape.lineTo(u1, ins.base);
        const N = typeof ins.top === 'number' ? 1 : Math.max(2, Math.ceil((u1 - u0) / 0.1));
        for (let k = N; k >= 0; k--) { const u = u0 + (u1 - u0) * k / N; shape.lineTo(u, topOf(u)); }
        // openings of exterior walls lying on this edge (outer face within 3 cm of the edge line)
        for (const w of extW) {
          const [ax, az] = w.start, [bx, bz] = w.end, wl = Math.hypot(bx - ax, bz - az); if (wl < 1e-3) continue;
          const wx = (bx - ax) / wl, wz = (bz - az) / wl; if (Math.abs(wx * ux + wz * uz) < 0.99) continue;
          const fx = ax + nx * w.thickness / 2, fz = az + nz * w.thickness / 2;
          if (Math.abs((fx - x0) * nx + (fz - z0) * nz) > 0.03) continue;
          for (const o of w.openings || []) {
            const pa = o.at - o.width / 2, pb = o.at + o.width / 2;
            const qa = (ax + wx * pa - x0) * ux + (az + wz * pa - z0) * uz, qb = (ax + wx * pb - x0) * ux + (az + wz * pb - z0) * uz;
            const a = Math.max(u0 + 0.01, Math.min(qa, qb)), b = Math.min(u1 - 0.01, Math.max(qa, qb)); if (b - a < 0.05) continue;
            const h0 = Math.max(ins.base + 0.01, lvl.floor + o.sill), h1 = Math.min(lvl.floor + o.sill + o.height, Math.min(topOf(a), topOf(b)) - 0.01); if (h1 - h0 < 0.05) continue;
            const hole = new THREE.Path(); hole.moveTo(a, h0); hole.lineTo(b, h0); hole.lineTo(b, h1); hole.lineTo(a, h1); hole.lineTo(a, h0); shape.holes.push(hole);
          }
        }
        const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
        const m = new THREE.Mesh(geo, imat);
        // local x = edge direction, y = up, z = outward normal; origin at the original outline vertex
        m.matrixAutoUpdate = false;
        m.matrix.set(ux, 0, nx, x0, 0, 1, 0, 0, uz, 0, nz, z0, 0, 0, 0, 1);
        m.castShadow = m.receiveShadow = true; m.userData = { kind: 'insulation', data: ins };
        g.add(m); pickables.push(m);
      }
    }

    // slabs
    for (const s of D.slabs) {
      const g = s.ceiling ? groups.ceiling : groups[s.level];
      const geo = prismGeometry(s.outline, s.holes, () => s.top, s.thickness);
      const m = new THREE.Mesh(geo, s.material ? mats[s.material] : mats.slab);
      m.castShadow = m.receiveShadow = true; m.userData = { kind: 'slab', data: s };
      g.add(m); pickables.push(m); addEdges(m, g);
    }

    // floor finishes (D.floors: {level, finish: 'oak' | 'tile', outline, holes?}) as thin layers on the slab, later entries on top
    if (D.floors?.length) {
      const fmats = { oak: new THREE.MeshStandardMaterial({ map: parquetTexture(), roughness: 0.55 }), tile: new THREE.MeshStandardMaterial({ map: tileTextureWhite(), roughness: 0.3 }),
        tileGrey: new THREE.MeshStandardMaterial({ map: tileTextureWhite('#8e8f8c', '#8a8b88', '#6f706d'), roughness: 0.45 }) };
      D.floors.forEach((fl, i) => {
        const lvl = levels[fl.level]; if (!lvl || !fl.outline?.length) return;
        const shape = new THREE.Shape(fl.outline.map(([x, z]) => new THREE.Vector2(x, -z)));
        for (const h of fl.holes || []) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
        const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), fmats[fl.finish] || fmats.oak);
        m.rotation.x = -Math.PI / 2; m.position.y = (fl.y ?? lvl.floor) + 0.004 + i * 0.002; m.receiveShadow = true;
        m.userData = { kind: 'floor', data: fl }; groups[fl.level].add(m);
      });
    }

    // stairs
    for (const st of D.stairs) {
      const g = groups[st.level];
      const sm = mats[st.material] || mats.stone;   // st.material: e.g. "wood" for a timber stair
      const rise = (st.to - st.from) / st.steps;
      const addStep = (x0, x1, z0, z1, top) => {
        const h = Math.abs(rise) + 0.06;
        const m = box(x1 - x0, h, Math.abs(z1 - z0), sm);
        m.position.set((x0 + x1) / 2, top - h / 2, (z0 + z1) / 2); m.userData = { kind: 'stair', data: st }; g.add(m); pickables.push(m);
      };
      if (st.type === 'spiral') {
        // spiral stair: steps = risers from 'from' (top) to 'to'; steps-1 wedge treads, first tread centred on startAngle (deg, x -> z), stepAngle per tread
        const [cx, cz] = st.center, R = st.radius, n = st.steps - 1, da = st.stepAngle * Math.PI / 180, a0 = st.startAngle * Math.PI / 180, r = Math.abs(rise);
        const top = Math.max(st.from, st.to), bot = Math.min(st.from, st.to), tag = o => { o.userData = { kind: 'stair', data: st }; o.castShadow = o.receiveShadow = true; g.add(o); pickables.push(o); return o; };
        const col = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, top + 0.95 - bot, 16), mats.frame)); col.position.set(cx, (top + 0.95 + bot) / 2, cz);
        const rail = [];
        if (st.landingAngle != null) {   // top landing flush with the upper floor/deck, before the first tread (spiral stair kits: "Austrittspodest")
          const c = st.landingAngle * Math.PI / 180, len = Math.abs(da) * 1.4, lo = c - len / 2;
          const t = tag(new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.05, 24, 1, false, Math.PI / 2 - lo - len, len), mats.wood)); t.position.set(cx, st.from - 0.025, cz);
          const s = Math.sign(da) || 1, bx = cx + (R - 0.04) * Math.cos(c + s * len / 2), bz = cz + (R - 0.04) * Math.sin(c + s * len / 2);
          const b = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6), mats.frame)); b.position.set(bx, st.from + 0.45, bz);
          rail.push(new THREE.Vector3(bx, st.from + 0.9, bz));
        }
        for (let k = 0; k < n; k++) {
          const c = a0 + k * da, lo = c - Math.abs(da) / 2 - 0.03, len = Math.abs(da) + 0.06, y = st.from - (k + 1) * r * Math.sign(st.from - st.to);
          const t = tag(new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.05, 24, 1, false, Math.PI / 2 - lo - len, len), mats.wood));
          t.position.set(cx, y - 0.025, cz);
          const bx = cx + (R - 0.04) * Math.cos(c), bz = cz + (R - 0.04) * Math.sin(c);
          const b = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6), mats.frame)); b.position.set(bx, y + 0.45, bz);
          rail.push(new THREE.Vector3(bx, y + 0.9, bz));
        }
        if (rail.length > 1) tag(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rail), rail.length * 6, 0.022, 6), mats.frame));
        continue;
      }
      if (st.type === 'dogleg') {
        const [x0, x1] = st.x, [z0, z1] = st.z, xm = (x0 + x1) / 2;
        const ld = (x1 - x0) / 2, m = st.steps / 2;
        const lz0 = st.landing === '-z' ? z0 : z1 - ld, lz1 = lz0 + ld;
        const runStart = st.landing === '-z' ? z1 : z0, runEnd = st.landing === '-z' ? lz1 : lz0;
        const run = (runEnd - runStart) / m;
        const halves = st.firstFlight === '+x' ? [[xm, x1], [x0, xm]] : [[x0, xm], [xm, x1]];
        for (let i = 1; i < m; i++) { const za = runStart + run * (i - 1), zb = za + run; addStep(halves[0][0], halves[0][1], Math.min(za, zb), Math.max(za, zb), st.from + rise * i); }
        const lh = st.from + rise * m;
        const land = box(x1 - x0, 0.2, ld, sm); land.position.set((x0 + x1) / 2, lh - 0.1, (lz0 + lz1) / 2); land.userData = { kind: 'stair', data: st }; g.add(land); pickables.push(land);
        for (let i = 1; i < m; i++) { const za = runEnd - run * (i - 1), zb = za - run; addStep(halves[1][0], halves[1][1], Math.min(za, zb), Math.max(za, zb), lh + rise * i); }
      } else if (st.startAt === '+x' || st.startAt === '-x') {
        const [x0, x1] = st.x, [z0, z1] = st.z, n = st.steps;
        const startX = st.startAt === '+x' ? x1 : x0, dir = st.startAt === '+x' ? -1 : 1, run = Math.abs(x1 - x0) / n;
        for (let i = 0; i < n; i++) { const xa = startX + dir * run * i, xb = xa + dir * run; addStep(Math.min(xa, xb), Math.max(xa, xb), z0, z1, st.from + rise * (i + 1)); }
      } else {
        const [x0, x1] = st.x, [z0, z1] = st.z, n = st.steps;
        const startZ = st.startAt === '+z' ? z1 : z0, dir = st.startAt === '+z' ? -1 : 1, run = Math.abs(z1 - z0) / n;
        for (let i = 0; i < n; i++) { const za = startZ + dir * run * i, zb = za + dir * run; addStep(x0, x1, Math.min(za, zb), Math.max(za, zb), st.from + rise * (i + 1)); }
      }
    }

    // roof
    {
      const r = D.roof, g = groups.roof, th = r.thickness;
      const [x0, x1] = r.eaves.x;
      for (const s of [-1, 1]) {
        const pts = [[x0, 0], [x1, 0], [x1, s * roof.ez]];
        // eave notches, walked from +x to -x: cross gables (triangular valley) and dormers that run down to the facade (rectangular cut)
        const notches = [
          ...roof.crosses.filter(c => c.s === s).map(c => ({ at: c.center, pts: [[c.center + c.half, s * roof.ez], [c.center, s * c.zv0], [c.center - c.half, s * roof.ez]] })),
          ...roof.dormers.filter(d => d.s === s && d.flushEaves).map(d => ({ at: (d.x0 + d.x1) / 2, pts: [[d.x1, s * roof.ez], [d.x1, s * d.a], [d.x0, s * d.a], [d.x0, s * roof.ez]] })),
        ].sort((a, b) => b.at - a.at);
        for (const n of notches) pts.push(...n.pts);
        pts.push([x0, s * roof.ez]);
        const holes = roof.dormers.filter(d => d.s === s && !d.flushEaves).map(d => [[d.x0, s * d.a], [d.x1, s * d.a], [d.x1, s * d.wallZ], [d.x0, s * d.wallZ]]);
        const geo = prismGeometry(pts, holes, (x, z) => roof.R - roof.k * Math.abs(z), th, (x, y, z) => [x * 0.75, Math.abs(z) / Math.cos(Math.atan(roof.k)) * 3.2]);
        const m = new THREE.Mesh(geo, mats.roof); m.castShadow = m.receiveShadow = true; m.userData = { kind: 'roof', data: { id: 'Hauptdach', pitch: r.pitch, ridgeHeight: r.ridgeHeight, eaveHeight: +roof.eaveH.toFixed(2) } };
        g.add(m); pickables.push(m); addEdges(m, g, 40);
      }
      for (const d of roof.dormers) {
        const s = d.s, zi = d.a - 0.05, zo = d.wallZ + d.ov, data = { name: d.name || 'Schleppgaube', pitch: d.pitch, ridgeHeight: +d.h(d.a).toFixed(2), eaveHeight: d.eaveHeight, width: d.x1 - d.x0 };
        const pts = [[d.x0 - d.sov, s * zi], [d.x1 + d.sov, s * zi], [d.x1 + d.sov, s * zo], [d.x0 - d.sov, s * zo]];
        const geo = prismGeometry(pts, [], (x, z) => d.h(s * z) + th * 0.5, th, (x, y, z) => [x * 0.75, Math.abs(z) / Math.cos(Math.atan(d.kd)) * 3.2]);
        const m = new THREE.Mesh(geo, mats.roof); m.castShadow = m.receiveShadow = true; m.userData = { kind: 'roof', data }; g.add(m); pickables.push(m); addEdges(m, g, 40);
        // cheek walls: between the main roof surface and the dormer roof, on top of the load-bearing walls
        const ct = d.cheekThickness ?? 0.2;
        for (const xc of [d.x0 + ct / 2, d.x1 - ct / 2]) {
          const sh = new THREE.Shape(), zw = d.wallZ;
          sh.moveTo(s * d.a, roof.R - roof.k * d.a); sh.lineTo(s * zw, roof.R - roof.k * zw); sh.lineTo(s * zw, d.h(zw)); sh.closePath();
          const cg = new THREE.ExtrudeGeometry(sh, { depth: ct, bevelEnabled: false });
          const cm = new THREE.Mesh(cg, mats.plaster); cm.rotation.y = -Math.PI / 2; cm.position.x = xc + ct / 2;
          cm.castShadow = cm.receiveShadow = true; cm.userData = { kind: 'roof', data }; g.add(cm); pickables.push(cm); addEdges(cm, g);
        }
        // cheek insulation (when the DG has a facade insulation skin): outside both cheeks, wrapping round the front corners
        const dIns = (D.insulation || []).find(i => i.level === 'DG');
        if (dIns) {
          const t = dIns.thickness, zw = d.wallZ + t, sh = new THREE.Shape();
          sh.moveTo(s * d.a, roof.R - roof.k * d.a); sh.lineTo(s * zw, roof.R - roof.k * zw); sh.lineTo(s * zw, d.h(zw) - 0.03); sh.closePath();
          for (const xr of [d.x0, d.x1 + t]) {
            const im = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false }), mats[dIns.material] || mats.plaster);
            im.rotation.y = -Math.PI / 2; im.position.x = xr; im.castShadow = im.receiveShadow = true; im.userData = { kind: 'insulation', data: dIns }; g.add(im); pickables.push(im);
          }
        }
      }
      for (const c of roof.crosses) {
        for (const hs of [-1, 1]) {
          const pts = [[c.center, c.s * c.zv0], [c.center, c.s * c.zOut], [c.center + hs * c.half, c.s * c.zOut], [c.center + hs * c.half, c.s * roof.ez]];
          const geo = prismGeometry(pts, [], (x) => c.Rc - c.kc * Math.abs(x - c.center), th, (x, y, z) => [z * 0.75, Math.abs(x - c.center) / Math.cos(Math.atan(c.kc)) * 3.2]);
          const m = new THREE.Mesh(geo, mats.roof); m.castShadow = m.receiveShadow = true; m.userData = { kind: 'roof', data: c };
          g.add(m); pickables.push(m); addEdges(m, g, 40);
        }
        if (c.gableInfill) {
          const zf = c.s * (c.zOut - 0.3), yb = roof.eaveH, hb = (c.Rc - th - yb) / c.kc;
          const sh = new THREE.Shape(); sh.moveTo(-hb, yb); sh.lineTo(hb, yb); sh.lineTo(0, c.Rc - th); sh.closePath();
          const gm = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: false }), mats.woodBoards);
          gm.position.set(c.center, 0, zf); gm.castShadow = true; gm.userData = { kind: 'roof', data: c }; g.add(gm); pickables.push(gm);
          const beam = box(c.width - 0.3, 0.2, 0.16, mats.wood); beam.position.set(c.center, yb - 0.1, zf); g.add(beam);
        }
      }
      for (const sk of r.skylights || []) {
        const s = Math.sign(sk.z) || 1, ang = Math.atan(roof.k);
        const m = box(sk.w, 0.1, sk.l, mats.glassRoof);
        m.position.set(sk.x, roof.R - roof.k * Math.abs(sk.z) + 0.04, sk.z); m.rotation.x = s > 0 ? ang : -ang;
        m.userData = { kind: 'skylight', data: sk }; g.add(m); pickables.push(m);
      }
      // photovoltaics (r.pv: {side, x:[x0,x1], z:[z0,z1] horizontal band, panel:[along x, along slope], gap, wp}): grid of modules centred in the band, 12 cm above the tiles
      if (r.pv?.length) {
        const cv = document.createElement('canvas'); cv.width = 128; cv.height = 192; const cx = cv.getContext('2d');
        cx.fillStyle = '#1c2533'; cx.fillRect(0, 0, 128, 192); cx.strokeStyle = '#3a4a60'; cx.lineWidth = 1.5;
        for (let i = 1; i < 6; i++) { cx.beginPath(); cx.moveTo(i * 128 / 6, 0); cx.lineTo(i * 128 / 6, 192); cx.stroke(); }
        for (let j = 1; j < 10; j++) { cx.beginPath(); cx.moveTo(0, j * 19.2); cx.lineTo(128, j * 19.2); cx.stroke(); }
        cx.strokeStyle = '#b9c0c8'; cx.lineWidth = 4; cx.strokeRect(2, 2, 124, 188);
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
        const pvMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.25, metalness: 0.3 }), pvSide = mat(0xb9c0c8);
        const ang = Math.atan(roof.k), cs = Math.cos(ang);
        for (const a of r.pv) {
          const s = a.side === '-z' ? -1 : 1, [pw, pl] = a.panel || [1.134, 1.722], gap = a.gap ?? 0.02;
          const sl0 = Math.min(...a.z.map(Math.abs)) / cs, sl1 = Math.max(...a.z.map(Math.abs)) / cs;   // distance along the slope from the ridge line
          const cols = a.cols ?? Math.floor((a.x[1] - a.x[0] + gap) / (pw + gap)), rows = a.rows ?? Math.floor((sl1 - sl0 + gap) / (pl + gap));
          const ux = (a.x[0] + a.x[1]) / 2 - (cols * (pw + gap) - gap) / 2 + pw / 2, us = (sl0 + sl1) / 2 - (rows * (pl + gap) - gap) / 2 + pl / 2;
          const info = { ...a, modules: cols * rows, kwp: +(cols * rows * (a.wp ?? 430) / 1000).toFixed(1) };   // copy: D must stay unmodified (dirty check)
          for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
            const sd = us + j * (pl + gap), z = s * sd * cs, y = roof.R - roof.k * sd * cs + 0.12 / cs;
            const mats6 = [pvSide, pvSide, pvMat, pvSide, pvSide, pvSide];
            const m = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.035, pl), mats6); m.castShadow = m.receiveShadow = true;
            m.position.set(ux + i * (pw + gap), y, z); m.rotation.x = s > 0 ? ang : -ang;
            m.userData = { kind: 'pv', data: info }; g.add(m); pickables.push(m);
          }
        }
      }
      const ch = r.chimney;
      if (ch) {
        const rt = roof.top(ch.x, ch.z);
        const pieces = [['KG', levels.KG.floor, -0.35], ['EG', 0, 2.60], ['DG', 2.95, rt - 0.2]];
        for (const [lv, y0, y1] of pieces) { const m = box(ch.shaft[0], y1 - y0, ch.shaft[1], mats.chimney); m.position.set(ch.x, (y0 + y1) / 2, ch.z); m.userData = { kind: 'chimney', data: ch }; groups[lv].add(m); pickables.push(m); }
        const head = box(ch.head[0], ch.top - (rt - 0.4), ch.head[1], mats.chimney); head.position.set(ch.x, (ch.top + rt - 0.4) / 2, ch.z); head.userData = { kind: 'chimney', data: ch }; g.add(head); pickables.push(head); addEdges(head, g);
        const cap = box(ch.head[0] + 0.12, 0.08, ch.head[1] + 0.12, mats.slab); cap.position.set(ch.x, ch.top + 0.04, ch.z); g.add(cap);
      }
    }

    // railings (rl.style: 'glass' = frameless glass with a slim steel handrail, 'cable' = steel posts with horizontal cables
    // and a wooden handrail, default = wooden balusters)
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.45, metalness: 0.6 });
    const railGlass = new THREE.MeshStandardMaterial({ color: 0xcfe0e4, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
    for (const rl of D.railings) {
      const g = groups[rl.level];
      for (let i = 0; i + 1 < rl.points.length; i++) {
        const [ax, az] = rl.points[i], [bx, bz] = rl.points[i + 1];
        const L = Math.hypot(bx - ax, bz - az), ang = Math.atan2(-(bz - az), bx - ax);
        const seg = new THREE.Group(); seg.position.set(ax, rl.base, az); seg.rotation.y = ang; g.add(seg);
        const tagRail = (m) => { m.userData = { kind: 'railing', data: rl }; pickables.push(m); return m; };
        if (rl.style === 'glass') {
          const pane = tagRail(box(L, rl.height - 0.05, 0.02, railGlass)); pane.position.set(L / 2, (rl.height - 0.05) / 2, 0); seg.add(pane);
          const cap = tagRail(box(L + 0.03, 0.04, 0.04, steel)); cap.position.set(L / 2, rl.height - 0.02, 0); seg.add(cap);
          continue;
        }
        if (rl.style === 'cable') {
          const n = Math.max(1, Math.ceil(L / 1.3));
          for (let j = 0; j <= n; j++) { const post = tagRail(box(0.04, rl.height - 0.04, 0.04, steel)); post.position.set(j * L / n, (rl.height - 0.04) / 2, 0); seg.add(post); }
          const cap = tagRail(box(L + 0.06, 0.04, 0.09, mats.wood)); cap.position.set(L / 2, rl.height - 0.02, 0); seg.add(cap);
          for (let k = 1; k <= 9; k++) { const c = tagRail(box(L, 0.008, 0.008, steel)); c.position.set(L / 2, k * (rl.height - 0.1) / 10, 0); seg.add(c); }
          continue;
        }
        const top = box(L + 0.06, 0.06, 0.1, mats.wood); top.position.set(L / 2, rl.height - 0.03, 0); seg.add(top);
        const bot = box(L, 0.05, 0.06, mats.wood); bot.position.set(L / 2, 0.1, 0); seg.add(bot);
        const n = Math.max(1, Math.floor(L / 0.11));
        const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.075, rl.height - 0.12, 0.022), mats.wood, n);
        const mtx = new THREE.Matrix4();
        for (let j = 0; j < n; j++) { mtx.makeTranslation((j + 0.5) * L / n, (rl.height - 0.12) / 2 + 0.06, 0); inst.setMatrixAt(j, mtx); }
        inst.castShadow = true; inst.userData = { kind: 'railing', data: rl }; seg.add(inst); pickables.push(inst);
        top.userData = bot.userData = { kind: 'railing', data: rl }; pickables.push(top, bot);
      }
    }
    for (const p of D.posts) { const m = box(p.size, p.top - p.base, p.size, p.material === 'steel' ? steel : mats[p.material] || mats.wood); m.position.set(p.x, (p.top + p.base) / 2, p.z); m.userData = { kind: 'post', data: p }; groups[p.level].add(m); pickables.push(m); }
    for (const b of D.beams) {
      const [ax, az] = b.start, [bx, bz] = b.end, L = Math.hypot(bx - ax, bz - az);
      const m = box(L, b.top - b.bottom, b.width, mats.plaster); m.position.set((ax + bx) / 2, (b.top + b.bottom) / 2, (az + bz) / 2); m.rotation.y = Math.atan2(-(bz - az), bx - ax);
      m.userData = { kind: 'beam', data: b }; groups[b.level].add(m); pickables.push(m);
    }
    // louvred pergolas (D.pergolas: {level, x:[x0,x1], z:[z0,z1], base, top, post, frame, louvreAxis 'x'|'z', louvreAngle°, color, screens:[{side, drop 0..1}]})
    for (const pg of D.pergolas || []) {
      const g = groups[pg.level], ps = pg.post ?? 0.15, fh = pg.frame ?? 0.22, col = mat(new THREE.Color(pg.color || '#383e42').getHex(), { roughness: 0.45, metalness: 0.3 });
      const [x0, x1] = pg.x, [z0, z1] = pg.z, yb = pg.base ?? 0, yt = pg.top, tag = m => { m.userData = { kind: 'pergola', data: pg }; g.add(m); pickables.push(m); return m; };
      for (const px of [x0 + ps / 2, x1 - ps / 2]) for (const pz of [z0 + ps / 2, z1 - ps / 2]) { const m = tag(box(ps, yt - fh - yb, ps, col)); m.position.set(px, yb + (yt - fh - yb) / 2, pz); }
      for (const [cx, cz, w, d] of [[(x0 + x1) / 2, z0 + ps / 2, x1 - x0, ps], [(x0 + x1) / 2, z1 - ps / 2, x1 - x0, ps], [x0 + ps / 2, (z0 + z1) / 2, ps, z1 - z0 - 2 * ps], [x1 - ps / 2, (z0 + z1) / 2, ps, z1 - z0 - 2 * ps]]) {
        const m = tag(box(w, fh, d, col)); m.position.set(cx, yt - fh / 2, cz); addEdges(m, g); }
      const alongX = pg.louvreAxis !== 'z', span = alongX ? x1 - x0 - 2 * ps : z1 - z0 - 2 * ps, run = alongX ? z1 - z0 - 2 * ps : x1 - x0 - 2 * ps, lw = 0.2;
      const n = Math.floor(run / lw), a = (pg.louvreAngle ?? 45) * Math.PI / 180;
      for (let i = 0; i < n; i++) {
        const c = -run / 2 + (i + 0.5) * run / n, m = tag(box(alongX ? span : 0.18, 0.03, alongX ? 0.18 : span, col));
        m.position.set(alongX ? (x0 + x1) / 2 : (x0 + x1) / 2 + c, yt - fh / 2, alongX ? (z0 + z1) / 2 + c : (z0 + z1) / 2);
        if (alongX) m.rotation.x = a; else m.rotation.z = a;
      }
      const fab = new THREE.MeshStandardMaterial({ color: 0x5a5e60, roughness: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
      for (const sc of pg.screens || []) {   // ZIP screen between the posts of one side, cassette under the frame
        const sx = sc.side === '-x' || sc.side === '+x', pos = { '-x': x0 + ps / 2, '+x': x1 - ps / 2, '-z': z0 + ps / 2, '+z': z1 - ps / 2 }[sc.side];
        const w = (sx ? z1 - z0 : x1 - x0) - 2 * ps, hmax = yt - fh - yb, h = hmax * (sc.drop ?? 0.6);
        const cas = tag(box(sx ? 0.12 : w, 0.12, sx ? w : 0.12, col)); cas.position.set(sx ? pos : (x0 + x1) / 2, yt - fh - 0.06, sx ? (z0 + z1) / 2 : pos);
        if (h > 0.05) { const f = tag(new THREE.Mesh(new THREE.PlaneGeometry(w, h), fab)); f.position.set(sx ? pos : (x0 + x1) / 2, yt - fh - 0.12 - h / 2, sx ? (z0 + z1) / 2 : pos); if (sx) f.rotation.y = Math.PI / 2; f.renderOrder = 3; }
      }
    }

    // terrain: house.json grid near the house, blended into the wide DEM grid (context/terrain.json)
    {
      const T = D.terrain, g = groups.terrain, CT = CONTEXT?.terrain;
      const H0 = terrainHeightFn(T, CT), H = gradeFn(H0, D.grading); groundAt = H;
      const ext = terrainExtent(T, CT);
      const poly = T.cutout;
      const inside = (x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
      const dist = (x, z) => { let d = Infinity; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [ax, az] = poly[j], [bx, bz] = poly[i]; const vx = bx - ax, vz = bz - az; const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz))); d = Math.min(d, Math.hypot(x - ax - t * vx, z - az - t * vz)); } return d; };
      const axis = (a0, a1) => { const out = [], cuts = [...new Set([a0, -64, -16, 16, 64, a1].filter(v => v >= a0 && v <= a1))].sort((p, q) => p - q);
        for (let i = 0; i + 1 < cuts.length; i++) { const m = Math.abs((cuts[i] + cuts[i + 1]) / 2), st = m < 16 ? (PHONE ? 0.5 : 0.25) : m < 64 ? 1 : (PHONE ? 8 : 4);
          for (let v = cuts[i]; v < cuts[i + 1] - 1e-9; v += st) out.push(+v.toFixed(4)); }
        out.push(a1); return out; };
      const xs = axis(ext[0], ext[1]), zs = axis(ext[2], ext[3]), nx = xs.length, nz = zs.length;
      const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const x = xs[i], z = zs[j], k = j * nx + i;
        pos[k * 3] = x; pos[k * 3 + 1] = H(x, z); pos[k * 3 + 2] = z;
        uv[k * 2] = (x - ext[0]) / (ext[1] - ext[0]); uv[k * 2 + 1] = 1 - (z - ext[2]) / (ext[3] - ext[2]);
      }
      const idx = [];
      const keep = (ids) => { let cx = 0, cz = 0; for (const id of ids) { cx += pos[id * 3]; cz += pos[id * 3 + 2]; } cx /= 3; cz /= 3;
        if (Math.abs(cx) > 14 || Math.abs(cz) > 10) return true; return !(inside(cx, cz) && dist(cx, cz) > 0.14); };
      for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        if (keep([a, c, b])) idx.push(a, c, b);
        if (keep([b, c, d])) idx.push(b, c, d);
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mats.terrain); m.receiveShadow = true; m.userData = { kind: 'terrain', data: { note: T.note } }; g.add(m);
      terrainMesh = m; contourGroup = null;

      // cut/fill: overlay on the terrain (red = Abtrag, blue = Auftrag) and volumes on a 0.25 m grid
      cutfillGroup = null; cutfillVol = null;
      const G = (D.grading || []).filter(e => e.outline || e.points);
      if (G.length) {
        const pts = G.flatMap(e => e.outline || e.points);
        const R = 12;
        const bx0 = Math.min(...pts.map(p => p[0])) - R, bx1 = Math.max(...pts.map(p => p[0])) + R, bz0 = Math.min(...pts.map(p => p[1])) - R, bz1 = Math.max(...pts.map(p => p[1])) + R;
        const st = 0.25; let cut = 0, fill = 0;
        const cx = [], cz = []; for (let x = bx0; x <= bx1 + 1e-9; x += st) cx.push(x); for (let z = bz0; z <= bz1 + 1e-9; z += st) cz.push(z);
        const diff = new Float32Array(cx.length * cz.length);
        cz.forEach((z, j) => cx.forEach((x, i) => { const dd = H(x, z) - H0(x, z); diff[j * cx.length + i] = dd;
          if (!inside(x, z)) { if (dd > 0) fill += dd * st * st; else cut -= dd * st * st; } }));
        cutfillVol = { cut, fill };
        const pos = [], col = [], idx2 = [], c = new THREE.Color(), nx2 = cx.length;
        cz.forEach((z, j) => cx.forEach((x, i) => { const dd = diff[j * nx2 + i];
          pos.push(x, H(x, z) + 0.03, z);
          const w = 0.35 * (1 - Math.min(1, Math.abs(dd) / 0.4)); if (dd > 0.01) c.setRGB(0.15 + w, 0.35 + w, 0.9); else if (dd < -0.01) c.setRGB(0.9, 0.3 + w, 0.12 + w); else c.setRGB(0.95, 0.95, 0.95);
          col.push(c.r, c.g, c.b); }));
        for (let j = 0; j < cz.length - 1; j++) for (let i = 0; i < nx2 - 1; i++) {
          const a0 = j * nx2 + i, b0 = a0 + 1, c0 = a0 + nx2, d0 = c0 + 1;
          if (Math.max(Math.abs(diff[a0]), Math.abs(diff[b0]), Math.abs(diff[c0]), Math.abs(diff[d0])) < 0.02) continue;
          if (inside((cx[i] + cx[i + 1]) / 2, (cz[j] + cz[j + 1]) / 2)) continue;
          idx2.push(a0, c0, b0, b0, c0, d0);
        }
        const og = new THREE.BufferGeometry(); og.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); og.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); og.setIndex(idx2); og.computeVertexNormals();
        const om = new THREE.Mesh(og, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
        om.renderOrder = 2; cutfillGroup = new THREE.Group(); cutfillGroup.add(om); g.add(cutfillGroup);
      }
      // pools: basin walls, floor, coping and water on top of the terrain basin (rectangular outline)
      for (const pl of (D.grading || []).filter(e => e.type === 'pool' && e.outline?.length >= 3)) {
        const xs = pl.outline.map(p => p[0]), zs = pl.outline.map(p => p[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), W = x1 - x0, L = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const top = pl.top, bot = pl.top - pl.depth, t = 0.25, cw = pl.coping ?? 0.35;
        const tile = new THREE.MeshStandardMaterial({ color: 0x8fcbd8, roughness: 0.5 }), cop = new THREE.MeshStandardMaterial({ color: 0xdcd6c8, roughness: 0.8 });
        const water = new THREE.MeshStandardMaterial({ color: 0x2f9cc4, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.6, depthWrite: false });
        const put = (m, x, y, z) => { m.position.set(x, y, z); m.userData = { kind: 'pool', data: pl }; m.receiveShadow = true; g.add(m); pickables.push(m); return m; };
        put(box(W, 0.2, L, tile), cx, bot - 0.1, cz);
        for (const sx of [-1, 1]) put(box(t, pl.depth + 0.4, L + 2 * t, tile), cx + sx * (W / 2 + t / 2), bot + (pl.depth + 0.4) / 2 - 0.4, cz);
        for (const sz of [-1, 1]) put(box(W, pl.depth + 0.4, t, tile), cx, bot + (pl.depth + 0.4) / 2 - 0.4, cz + sz * (L / 2 + t / 2));
        for (const sx of [-1, 1]) put(box(cw, 0.05, L + 2 * cw, cop), cx + sx * (W / 2 + cw / 2), top + 0.025, cz);
        for (const sz of [-1, 1]) put(box(W, 0.05, cw, cop), cx, top + 0.025, cz + sz * (L / 2 + cw / 2));
        const wm = put(new THREE.Mesh(new THREE.PlaneGeometry(W, L), water), cx, top - (pl.freeboard ?? 0.15), cz); wm.rotation.x = -Math.PI / 2; wm.renderOrder = 3;
      }
      // retaining walls (Stützmauern): top given or at the higher side, footing 0.3 below the lower side
      for (const w of (D.grading || []).filter(e => e.type === 'wall' && e.points?.length >= 2)) {
        const th = w.thickness ?? 0.25;
        for (let i = 1; i < w.points.length; i++) {
          const [ax, az] = w.points[i - 1], [bx, bz] = w.points[i], L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
          const nx = -(bz - az) / L, nz = (bx - ax) / L, off = th / 2 + 0.2;
          let lo = Infinity, hi = -Infinity;
          for (let k = 0; k <= 8; k++) { const x = ax + (bx - ax) * k / 8, z = az + (bz - az) * k / 8;
            for (const sgn of [-1, 1]) { const y = H(x + sgn * nx * off, z + sgn * nz * off); lo = Math.min(lo, y); hi = Math.max(hi, y); } }
          const top = w.top ?? hi + 0.05, bot = lo - 0.3;
          const m = box(L + th, top - bot, th, mats.stone); m.position.set((ax + bx) / 2, (top + bot) / 2, (az + bz) / 2); m.rotation.y = Math.atan2(-(bz - az), bx - ax);
          m.userData = { kind: 'gradewall', data: { ...w, _top: top, _h: top - lo } }; g.add(m); pickables.push(m);
        }
      }
    }

    // furniture (optional, data-driven; simple low-detail shapes)
    if (D.furniture?.length) {
      const fm = {
        wood: mat(0xc9a77c), oak: mat(0xd8bf98), white: mat(0xf4f3ef, { roughness: 0.4 }), fabric: mat(0x9aa39c), fabric2: mat(0x6f8a96),
        linen: mat(0xeeeae2), dark: mat(0x2b2f31, { roughness: 0.5 }), worktop: mat(0x55534f, { roughness: 0.5 }), front: mat(0xe9e6df),
        glass: new THREE.MeshStandardMaterial({ color: 0xbfd6dd, roughness: 0.1, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
        green: mat(0x5f7f4f), pot: mat(0xb0705a), rug: mat(0xcfc6b4),
      };
      const byLevel = {};
      for (const f of D.furniture) {
        const lvl = levels[f.level]; if (!lvl) continue;
        if (!byLevel[f.level]) { const fg = new THREE.Group(); fg.name = 'furniture-' + f.level; groups[f.level].add(fg); furnGroups.push(fg); byLevel[f.level] = fg; }
        const facing = f.facing || '+z', alongX = facing === '+z' || facing === '-z';
        const ex = f.x[1] - f.x[0], ez = f.z[1] - f.z[0];
        const W = alongX ? ex : ez, Dp = alongX ? ez : ex;   // W across the front, Dp front-to-back
        const g = new THREE.Group();
        g.position.set((f.x[0] + f.x[1]) / 2, lvl.floor + (f.y ?? 0), (f.z[0] + f.z[1]) / 2);
        g.rotation.y = { '+z': 0, '-z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 }[facing] ?? 0;
        if (f.rot != null) g.rotation.y = f.rot * Math.PI / 180;   // free angle, e.g. 45° for a corner piece (0 = front to +z)
        const add = (w, h, d, m, x, y, z) => { const b = box(w, h, d, m); b.position.set(x, y, z); g.add(b); return b; };
        const cyl = (r, h, m, x, y, z) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), m); c.position.set(x, y, z); c.castShadow = c.receiveShadow = true; g.add(c); return c; };
        const legs = (w, d, h, m, t = 0.05) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(t, h, t, m, sx * (w / 2 - t), h / 2, sz * (d / 2 - t)); };
        const chair = (x, z, rot) => { const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = rot;
          const s1 = box(0.44, 0.04, 0.44, fm.oak); s1.position.y = 0.46; c.add(s1); const bk = box(0.44, 0.42, 0.04, fm.oak); bk.position.set(0, 0.69, -0.2); c.add(bk);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const l = box(0.035, 0.46, 0.035, fm.dark); l.position.set(sx * 0.19, 0.23, sz * 0.19); c.add(l); } g.add(c); };
        const H = f.h;
        switch (f.type) {
          case 'bed': {
            add(W, 0.28, Dp, fm.oak, 0, 0.14, 0); add(W - 0.04, 0.2, Dp - 0.12, fm.linen, 0, 0.38, 0.04);
            add(W, 0.95, 0.08, fm.oak, 0, 0.475, -Dp / 2 + 0.04);
            const n = W > 1.25 ? 2 : 1; for (let i = 0; i < n; i++) add(W / n - 0.14, 0.12, 0.38, fm.white, (i - (n - 1) / 2) * (W / n), 0.54, -Dp / 2 + 0.34);
            add(W - 0.02, 0.06, Dp * 0.62, fm.fabric2, 0, 0.51, Dp / 2 - Dp * 0.31); break; }
          case 'sofa': case 'armchair': {
            const h = H ?? 0.8; add(W, 0.42, Dp, fm.fabric, 0, 0.21, 0); add(W, h - 0.42, 0.22, fm.fabric, 0, 0.42 + (h - 0.42) / 2, -Dp / 2 + 0.11);
            for (const sx of (f.arms ?? [-1, 1])) add(0.18, 0.2, Dp, fm.fabric, sx * (W / 2 - 0.09), 0.52, 0);   // arms: local sides (-1/+1) that get an armrest
            add(W - 0.4, 0.1, Dp - 0.3, fm.linen, 0, 0.47, 0.08); break; }
          case 'table': case 'desk': {
            const h = H ?? 0.75; add(W, 0.04, Dp, f.type === 'desk' ? fm.white : fm.oak, 0, h - 0.02, 0); legs(W, Dp, h - 0.04, fm.dark, 0.05);
            const n = f.seats || 0, per = Math.ceil(n / 2);
            for (let i = 0; i < n; i++) { const side = i < per ? 1 : -1, k = i < per ? i : i - per, cnt = i < per ? per : n - per;
              chair((k - (cnt - 1) / 2) * (W / cnt), side * (Dp / 2 + 0.1), side > 0 ? Math.PI : 0); }
            if (f.chair) chair(0, Dp / 2 + 0.15, Math.PI); break; }
          case 'chair': { chair(0, 0, 0); break; }
          case 'heatpump': {   // air/water heat pump outdoor unit on a concrete plinth: light casing, fan grille on the front (+z local)
            const h = H ?? 1.0, pb = 0.12, casing = new THREE.MeshStandardMaterial({ color: 0xd9dcdc, roughness: 0.5, metalness: 0.2 });
            add(W + 0.1, pb, Dp + 0.2, mats.slab, 0, pb / 2, 0.05);
            add(W, h, Dp, casing, 0, pb + h / 2, 0);
            const fr = Math.min(W, h) * 0.36, fy = pb + h * 0.52;
            const grille = new THREE.Mesh(new THREE.CircleGeometry(fr, 32), fm.dark); grille.position.set(-W * 0.12, fy, Dp / 2 + 0.003); g.add(grille);
            for (const rr of [fr * 0.95, fr * 0.65, fr * 0.35]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.008, 6, 32), casing); ring.position.set(-W * 0.12, fy, Dp / 2 + 0.006); g.add(ring); }
            add(0.012, h * 0.9, 0.012, casing, -W * 0.12, fy, Dp / 2 + 0.008); add(fr * 2, 0.012, 0.012, casing, -W * 0.12, fy, Dp / 2 + 0.008);
            add(W * 0.18, h * 0.7, 0.01, fm.dark, W * 0.36, pb + h * 0.5, Dp / 2 + 0.003);
            break; }
          case 'stool': {   // bar stool: round seat at ~0.65, footring, steel column
            const h = H ?? 0.65; cyl(0.19, 0.05, fm.oak, 0, h - 0.025, 0); cyl(0.025, h - 0.05, fm.dark, 0, (h - 0.05) / 2, 0);
            cyl(0.2, 0.015, fm.dark, 0, 0.008, 0); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.01, 6, 20), fm.dark); ring.rotation.x = Math.PI / 2; ring.position.y = 0.3; g.add(ring); break; }
          case 'stove': {   // Schwedenofen: glass floor plate, steel body with window, flue pipe up to f.flue (ceiling)
            const h = H ?? 1.1, bw = 0.5, bd = 0.42, steel = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.55, metalness: 0.4 });
            const fire = new THREE.MeshStandardMaterial({ color: 0x3a2412, emissive: 0xc0541a, emissiveIntensity: 0.6, roughness: 0.3 });
            if (f.design !== 'column') add(0.85, 0.008, 0.85, fm.glass, 0, 0.004, 0.12);
            if (f.design === 'column') {   // stone-clad stove tower: plinth, black firebox band with window, two cladding blocks above
              const clad = new THREE.MeshStandardMaterial({ color: 0xe6e1d8, roughness: 0.8 }), fb0 = h * 0.35, fb1 = h * 0.6;
              add(W, fb0 - 0.01, Dp, clad, 0, (fb0 - 0.01) / 2, 0);
              add(W - 0.02, fb1 - fb0, Dp - 0.02, steel, 0, (fb0 + fb1) / 2, 0);
              add(W * 0.62, (fb1 - fb0) * 0.78, 0.01, fire, 0, (fb0 + fb1) / 2, Dp / 2 + 0.002);
              const top = h - fb1 - 0.01; add(W, top / 2 - 0.005, Dp, clad, 0, fb1 + 0.005 + top / 4, 0); add(W, top / 2 - 0.005, Dp, clad, 0, fb1 + 0.01 + top * 0.75, 0);
              add(W * 0.25, 0.01, 0.015, fm.dark, 0, fb0 - 0.03, Dp / 2 + 0.006);
              break;
            }
            if (f.design === 'modern') {   // slim cuboid, tall window, open log compartment below, flue connected at the back (none visible)
              add(bw, h, bd, steel, 0, h / 2, 0);
              add(bw - 0.08, h * 0.42, 0.01, fire, 0, h * 0.62, bd / 2 + 0.005);
              add(bw - 0.08, h * 0.24, 0.02, fm.dark, 0, h * 0.17, bd / 2 - 0.005);
              for (let i = 0; i < 3; i++) cyl(0.045, bw - 0.12, fm.oak, 0, 0.09 + i * 0.07, bd / 2 - 0.08).rotation.z = Math.PI / 2;
              break;
            }
            add(bw, 0.1, bd, steel, 0, 0.05, 0); add(bw, h - 0.1, bd, steel, 0, 0.1 + (h - 0.1) / 2, 0);
            add(bw * 0.7, h * 0.38, 0.01, fire, 0, 0.3 + h * 0.19, bd / 2 + 0.005);
            if (f.flue) cyl(0.075, f.flue - h, steel, 0, h + (f.flue - h) / 2, -0.03);
            break; }
          case 'bench': {   // bench seat with backrest on the back (-z local) side
            add(W, 0.4, Dp, fm.oak, 0, 0.2, 0); add(W - 0.02, 0.06, Dp - 0.08, fm.fabric, 0, 0.43, 0.04);
            add(W, 0.5, 0.08, fm.oak, 0, 0.65, -Dp / 2 + 0.04); break; }
          case 'counter': case 'island': {
            const h = H ?? 0.9, oh = f.overhang ?? 0, cd = Dp - oh, cz = oh / 2;   // overhang: open bar top on the back (local -z) side
            add(W, h - 0.14, cd - 0.05, fm.front, 0, 0.1 + (h - 0.14) / 2, cz + 0.025 * (f.type === 'island' || oh ? 0 : -1)); add(W - 0.02, 0.1, cd - 0.1, fm.dark, 0, 0.05, cz);
            if (oh) add(W - 0.02, h - 0.14, 0.02, fm.front, 0, 0.1 + (h - 0.14) / 2, cz - cd / 2 + 0.035);
            add(W + 0.01, 0.04, Dp + 0.02, fm.worktop, 0, h - 0.02, 0);
            if (f.sink != null) add(0.55, 0.012, 0.4, fm.white, f.sink - W / 2, h + 0.003, cz);
            if (f.hob != null) add(0.6, 0.012, 0.5, fm.dark, f.hob - W / 2, h + 0.003, cz);
            break; }
          case 'wardrobe': case 'cabinet': case 'sideboard': case 'nightstand': {
            const h = H ?? { wardrobe: 2.2, cabinet: 2.2, sideboard: 0.55, nightstand: 0.5 }[f.type];
            add(W, h, Dp - 0.02, f.type === 'wardrobe' || f.type === 'cabinet' ? fm.front : fm.oak, 0, h / 2, -0.01);
            const n = Math.max(1, Math.round(W / 0.5)); for (let i = 1; i < n; i++) add(0.008, h - 0.06, 0.02, fm.dark, -W / 2 + i * W / n, h / 2, Dp / 2 - 0.01);
            break; }
          case 'freezer': case 'fridge': {   // freestanding appliance: white body, door gap, vertical handle on the front (+z local)
            const h = H ?? 1.85; add(W, h, Dp - 0.04, fm.white, 0, h / 2, -0.02);
            add(W - 0.02, 0.006, 0.01, fm.dark, 0, 0.12, Dp / 2 - 0.035); add(0.025, Math.min(0.9, h * 0.45), 0.03, fm.dark, W / 2 - 0.06, h * 0.6, Dp / 2 - 0.02);
            break; }
          case 'shelf': {
            const h = H ?? 2.0; add(W, h, 0.02, fm.oak, 0, h / 2, -Dp / 2 + 0.01);
            for (const sx of [-1, 1]) add(0.025, h, Dp, fm.oak, sx * (W / 2 - 0.0125), h / 2, 0);
            const n = Math.max(2, Math.round(h / 0.38)); for (let i = 0; i <= n; i++) add(W, 0.025, Dp, fm.oak, 0, Math.min(h - 0.0125, 0.0125 + i * (h - 0.025) / n), 0);
            break; }
          case 'tv': { const h = H ?? 0.65; add(W, h, 0.05, fm.dark, 0, h / 2, 0); break; }
          case 'toilet': {
            add(0.38, 0.4, 0.15, fm.white, 0, 0.6, -Dp / 2 + 0.075); cyl(0.19, 0.4, fm.white, 0, 0.2, 0.08); add(0.36, 0.03, 0.42, fm.white, 0, 0.415, 0.06); break; }
          case 'basin': case 'vanity': {
            const h = H ?? 0.85; if (f.type === 'vanity') add(W, 0.45, Dp - 0.02, fm.oak, 0, h - 0.3, -0.01);
            add(W, 0.05, Dp, fm.white, 0, h - 0.025, 0);
            const n = f.basins || 1; for (let i = 0; i < n; i++) add(Math.min(0.5, W / n - 0.1), 0.012, Dp - 0.15, fm.linen, (i - (n - 1) / 2) * (W / n), h + 0.003, 0.02);
            add(W * 0.9, 0.7, 0.02, fm.glass, 0, h + 0.55, -Dp / 2 + 0.01); break; }
          case 'bathtub': { add(W, 0.55, Dp, fm.white, 0, 0.275, 0); add(W - 0.14, 0.01, Dp - 0.14, fm.linen, 0, 0.555, 0); break; }
          case 'shower': {
            add(W, 0.04, Dp, fm.white, 0, 0.02, 0); add(W, 2.0, 0.012, fm.glass, 0, 1.04, Dp / 2 - 0.006);
            cyl(0.12, 0.02, fm.dark, 0, 2.1, -Dp / 2 + 0.25); break; }
          case 'washer': { add(W, 0.85, Dp, fm.white, 0, 0.425, 0); cyl(0.17, 0.02, fm.dark, 0, 0.5, Dp / 2); break; }
          case 'rug': { add(W, 0.012, Dp, fm.rug, 0, 0.006, 0); break; }
          case 'plant': { cyl(Math.min(W, Dp) * 0.3, 0.4, fm.pot, 0, 0.2, 0); const sp = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.min(W, Dp) * 0.5, 1), fm.green); sp.position.y = 0.4 + Math.min(W, Dp) * 0.5; sp.castShadow = true; g.add(sp); break; }
          default: { const h = H ?? 0.75; add(W, h, Dp, fm[f.material] || fm.oak, 0, h / 2, 0); }
        }
        g.traverse(o => { if (o.isMesh) { o.userData = { kind: 'furniture', data: f }; pickables.push(o); } });
        byLevel[f.level].add(g);
      }
    }

    { const cb = $('t-cutfill'), cn = $('cutfillnote'); if (cb) cb.hidden = !cutfillGroup;
      if (cn) { cn.hidden = !cutfillVol; if (cutfillVol) cn.textContent = `Geländeänderung: Abtrag ${cutfillVol.cut.toFixed(1)} m³ · Auftrag ${cutfillVol.fill.toFixed(1)} m³`; } }
    { const fb = $('t-furn'); if (fb) fb.hidden = !D.furniture?.length; }
    // outdoor design (D.garden, see garden.js): on the graded terrain
    if (D.garden?.length) {
      const H = (x, z) => { const y = groundAt(x, z); return Number.isFinite(y) ? y : 0; };
      const gg = buildGarden(D.garden, { H, prism: prismGeometry, phone: PHONE });
      groups.garden.add(gg); gg.traverse(o => { if (o.isMesh) pickables.push(o); });
    }
    { const gb = $('t-garden'), gn = $('gardennote'), sum = gardenSummary(D.garden); if (gb) gb.hidden = !D.garden?.length;
      if (gn) { gn.hidden = !sum; gn.textContent = sum ? 'Garten: ' + sum : ''; } }
    // room labels
    for (const r of D.rooms) {
      const lvl = levels[r.level];
      const c = document.createElement('canvas'); c.width = 512; c.height = 160;
      const ctx = c.getContext('2d');
      ctx.font = '500 54px Spectral, Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.fillStyle = '#1d2420';
      ctx.strokeText(r.name, 256, 58); ctx.fillText(r.name, 256, 58);
      if (r.area) { ctx.font = '500 38px "IBM Plex Mono", monospace'; ctx.strokeText(r.area.toFixed(2) + ' m²', 256, 118); ctx.fillText(r.area.toFixed(2) + ' m²', 256, 118); }
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sp.position.set(r.label[0], (r.floor ?? lvl.floor) + 0.4, r.label[1]);
      { const k = matchMedia('(max-width: 700px)').matches ? 0.72 : 1; sp.scale.set(0.12 * k, 0.0375 * k, 1); } sp.material.sizeAttenuation = false; sp.renderOrder = 10;
      sp.userData.level = r.level; groups[r.level].add(sp); labelSprites.push(sp);
    }
    applyVisibility();
  }

  // ---------- UI state ----------
  const state = { level: 'all', roof: true, terrain: true, labels: true, edges: false, cut: 'off', cutPos: 0, neighbors: true, roads: true, power: true, addresses: false, trees: true, furniture: true, garden: true, cutfill: false, contours: false };
  const ORDER = ['KG', 'EG', 'DG'];
  function applyVisibility() {
    if (!root) return;
    const idx = state.level === 'all' ? 3 : ORDER.indexOf(state.level);
    ORDER.forEach((id, i) => groups[id].visible = i <= idx);
    groups.roof.visible = state.level === 'all' && state.roof;
    groups.ceiling.visible = state.level === 'all';
    groups.terrain.visible = state.terrain;
    groups.garden.visible = state.garden && state.terrain;
    for (const s of labelSprites) s.visible = state.labels && state.level !== 'all' && s.userData.level === state.level;
    for (const l of edgeLines) l.visible = state.edges;
    for (const g of furnGroups) g.visible = state.furniture;
    if (cutfillGroup) cutfillGroup.visible = state.cutfill && state.terrain;
    if (state.contours && !contourGroup && terrainMesh) buildContours();
    if (contourGroup) contourGroup.visible = state.contours && state.terrain;
    kick(800);
    ctxGroups.buildings.visible = state.neighbors; ctxGroups.power.visible = state.power; ctxGroups.addresses.visible = state.addresses; ctxGroups.trees.visible = state.trees;
    renderer.clippingPlanes = clipPlanes();
  }
  function clipPlanes() {
    if (state.cut === 'x') return [new THREE.Plane(new THREE.Vector3(-1, 0, 0), state.cutPos)];
    if (state.cut === 'z') return [new THREE.Plane(new THREE.Vector3(0, 0, -1), state.cutPos)];
    return [];
  }
  const LEVEL_TEXT = {
    all: ['Gesamtes Haus', () => `First +${DATA.roof.ridgeHeight.toFixed(2)} · ${DATA.roof.pitch}° Ziegeldach`],
    DG: ['Dachgeschoss', () => `FFB +2.95 · Wohnfläche ${DATA.meta.wohnflaeche?.DG ?? '–'} m²`],
    EG: ['Erdgeschoss', () => `FFB ±0.00 · Wohnfläche ${DATA.meta.wohnflaeche?.EG ?? '–'} m²`],
    KG: ['Kellergeschoss', () => { const k = DATA.levels.find(l => l.id === 'KG'); return `FFB ${k.floor.toFixed(2).replace('-', '−')} · RH ${k.clearHeight.toFixed(2)}`; }],
  };
  function setLevel(l) {
    state.level = l;
    for (const id of ['all', 'DG', 'EG', 'KG']) $('lv-' + id).setAttribute('aria-pressed', String(id === l));
    $('lvname').textContent = LEVEL_TEXT[l][0];
    $('lvmeta').textContent = LEVEL_TEXT[l][1]();
    applyVisibility();
  }
  for (const id of ['all', 'DG', 'EG', 'KG']) $('lv-' + id).addEventListener('click', () => setLevel(id));
  for (const [id, key] of [['t-roof', 'roof'], ['t-terrain', 'terrain'], ['t-labels', 'labels'], ['t-edges', 'edges'], ['t-furn', 'furniture'], ['t-garden', 'garden'], ['t-cutfill', 'cutfill'], ['t-contours', 'contours'], ['c-neighbors', 'neighbors'], ['c-roads', 'roads'], ['c-power', 'power'], ['c-addr', 'addresses'], ['c-trees', 'trees']]) {
    const b = $(id); if (!b) continue;
    b.setAttribute('aria-pressed', String(state[key]));
    b.addEventListener('click', () => { state[key] = !state[key]; b.setAttribute('aria-pressed', String(state[key])); if (key === 'roads') paintTerrain(); applyVisibility(); });
  }
  const cutmode = $('cutmode'), cutpos = $('cutpos'), cutval = $('cutval');
  function updCut() {
    state.cut = cutmode.value; cutpos.disabled = state.cut === 'off';
    if (state.cut === 'x') { cutpos.min = -11; cutpos.max = 9; } else if (state.cut === 'z') { cutpos.min = -8; cutpos.max = 7.5; }
    state.cutPos = +cutpos.value;
    cutval.textContent = state.cut === 'off' ? '—' : `${state.cut} ${state.cutPos >= 0 ? '+' : ''}${state.cutPos.toFixed(2)}`;
    applyVisibility();
  }
  cutmode.addEventListener('change', () => { cutpos.value = 0; updCut(); });
  cutpos.addEventListener('input', updCut);

  // camera presets
  const target = new THREE.Vector3(0, 1.2, 0);
  const fitTarget = () => target.set(0, camera.aspect < 0.8 ? -3.5 : 1.2, 0);
  const VIEWS = { persp: [17, 9, 24], NW: [0, 3, -30], NO: [30, 3, 0], SO: [0, 3, 30], SW: [-30, 3, 0], top: [0, 42, 0.01], site: [150, 120, 200] };
  let anim = null, groundAt = () => -Infinity;
  const viewScale = () => Math.min(2.4, Math.max(1, 0.95 / camera.aspect));
  function goView(v) {
    fitTarget(); const to = new THREE.Vector3(...VIEWS[v]).multiplyScalar(viewScale());
    // plan view on a portrait phone: rotated so the 15 m facade runs up the screen, house above the bottom bar
    if (v === 'top' && camera.aspect < 0.8) { to.set(0.51, 56, 0); target.set(0.5, 0, 0); }
    to.y = Math.max(to.y, groundAt(to.x, to.z) + 2.5); const from = camera.position.clone(); const tFrom = controls.target.clone();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { camera.position.copy(to); controls.target.copy(target); return; }
    const t0 = performance.now();
    anim = (now) => { const k = Math.min(1, (now - t0) / 700), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      camera.position.lerpVectors(from, to, e); controls.target.lerpVectors(tFrom, target, e); if (k >= 1) anim = null; };
  }
  view.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => goView(b.dataset.view)));

  // mobile bottom sheet
  const panelEl = $('panel'), sheetBtn = $('sheetbtn');
  const smallScreen = matchMedia('(max-width: 700px)');
  function setSheet(open) { panelEl.classList.toggle('mini', smallScreen.matches && !open); sheetBtn.setAttribute('aria-expanded', String(open)); sheetBtn.textContent = open ? 'Weniger' : 'Mehr'; if (!open) panelEl.scrollTop = 0; }
  sheetBtn.addEventListener('click', () => setSheet(panelEl.classList.contains('mini')));
  on(smallScreen, 'change', () => setSheet(false));
  setSheet(false);
  $('infoclose').addEventListener('click', () => select(null));

  // picking
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let down = null, selected = null, selMat = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > (e.pointerType === 'touch' ? 12 : 5)) return;
    if (walk.pending) { walkPick(e); return; }
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const planes = clipPlanes();
    const hits = ray.intersectObjects(pickables.concat(ctxPickables).filter(o => { let p = o; while (p) { if (!p.visible) return false; p = p.parent; } return true; }), false)
      .filter(h => planes.every(pl => pl.distanceToPoint(h.point) >= 0));
    select(hits[0]?.object || null, hits[0]?.instanceId);
  });
  function select(obj, inst) {
    if (selected) { selected.material = selMat; selected = null; }
    const info = $('info');
    $('panel').classList.toggle('has-sel', !!obj); $('infoclose').hidden = !obj;
    if (!obj) { info.innerHTML = '<span class="empty">Wand, Fenster oder Bauteil antippen, um Maße und ID zu sehen.</span>'; return; }
    if (obj.isMesh && !obj.isInstancedMesh) { selected = obj; selMat = obj.material; obj.material = obj.material.clone(); obj.material.emissive = new THREE.Color(cssVar('--accent') || '#2d6a55'); obj.material.emissiveIntensity = 0.45; }
    info.innerHTML = describe(obj.userData.items && inst != null ? { kind: obj.userData.kind, data: obj.userData.items[inst] } : obj.userData);
  }
  const f2 = v => (typeof v === 'number' ? v.toFixed(2) : v);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function dl(pairs) { return '<dl>' + pairs.filter(p => p[1] != null && p[1] !== '').map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>'; }
  function opLine(o) { return `${o.type === 'door' ? 'Tür' : 'Fenster'} ${o.label ?? (o.width * 100 + '/' + o.height * 100)} · bei ${f2(o.at)} m · Brüstung ${f2(o.sill)}`; }
  function describe(u) {
    const d = u.data || {};
    switch (u.kind) {
      case 'wall': {
        const L = Math.hypot(d.end[0] - d.start[0], d.end[1] - d.start[1]);
        return `<h3>${d.kind === 'exterior' ? 'Außenwand' : 'Innenwand'} ${esc(d.id)}</h3>` + dl([
          ['Geschoss', d.level], ['Fassade', d.facade], ['Länge', f2(L) + ' m'], ['Dicke', f2(d.thickness) + ' m'],
          ['Von', `${f2(d.start[0])}, ${f2(d.start[1])}`], ['Bis', `${f2(d.end[0])}, ${f2(d.end[1])}`],
          ['Unterkante', f2(d.base)], ['Oberkante', typeof d.top === 'number' ? f2(d.top) : 'Dachschräge' + (d.topCap ? ` (max ${f2(d.topCap)})` : '')]]) +
          (d.openings?.length ? '<ul>' + d.openings.map(o => `<li>${esc(opLine(o))}</li>`).join('') + '</ul>' : '') + (d.note ? `<p class="note">${esc(d.note)}</p>` : '');
      }
      case 'opening': return `<h3>${d.type === 'door' ? 'Tür' : 'Fenster'} ${esc(d.label ?? '')}</h3>` + dl([
        ['In Wand', u.wall.id], ['Breite', f2(d.width) + ' m'], ['Höhe', f2(d.height) + ' m'], ['Brüstung', f2(d.sill) + ' m'],
        ['Position', f2(d.at) + ' m ab Wandanfang'], ['Unterteil fix', d.fixedLower ? f2(d.fixedLower) + ' m' : null], ['Läden', d.shutters ? 'ja' : null]]) + (d.note ? `<p class="note">${esc(d.note)}</p>` : '');
      case 'insulation': return `<h3>${esc(d.name || 'Fassadendämmung')}</h3>` + dl([['Geschoss', d.level], ['Stärke', f2(d.thickness) + ' m'], ['Aufbau', d.note || '']]);
      case 'slab': return `<h3>${esc(d.name)}</h3>` + dl([['ID', d.id], ['OK', f2(d.top)], ['Stärke', f2(d.thickness) + ' m']]);
      case 'roof': return `<h3>${esc(d.name || d.id)}</h3>` + dl([['Neigung', (d.pitch ?? DATA.roof.pitch) + '°'], ['First', f2(d.Rc ?? d.ridgeHeight)], ['Traufe', f2(d.eaveHeight ?? makeRoof(DATA.roof).eaveH)], ['Breite', d.width ? f2(d.width) + ' m' : null]]);
      case 'stair': return `<h3>${d.type === 'spiral' ? 'Wendeltreppe' : 'Treppe'} ${esc(d.id)}</h3>` + dl([['Durchmesser', d.radius ? f2(d.radius * 2) + ' m' : null], ['Von', f2(d.from)], ['Bis', f2(d.to)], ['Stufen', d.steps], ['Steigung', f2(Math.abs(d.to - d.from) / d.steps * 100) + ' cm']]);
      case 'neighbor': return `<h3>Nachbargebäude</h3>` + dl([['Art', d.kind], ['Grundfläche', Math.round(d.areaM2) + ' m²'], ['Entfernung', Math.round(d.distanceM) + ' m'],
        ['Traufe / First', `${f2(d.eaveHeight)} / ${f2(d.ridgeHeight)} m${d.heightEstimated ? ' (geschätzt)' : ''}`], ['Dach', d.roofShape], ['Quelle', d.source], ['ID', d.id]]);
      case 'tree': return '<h3>Baum</h3>' + dl([['Höhe', f2(d.h) + ' m'], ['Kronenradius', f2(d.r) + ' m'], ['Lage', `${f2(d.x)}, ${f2(d.z)}`], ['Quelle', 'ALS-Oberflächenmodell 2023 (BEV)']]);
      case 'infra': return '<h3>Strommast</h3>' + dl([['Lage', `${f2(d.point[0])}, ${f2(d.point[2])}`]]);
      case 'skylight': return '<h3>Dachflächenfenster 78/98</h3>' + dl([['Lage', `${f2(d.x)}, ${f2(d.z)}`]]);
      case 'pv': return `<h3>${esc(d.name || 'Photovoltaik')}</h3>` + dl([['Module', `${d.modules} × ${d.wp ?? 430} Wp`], ['Leistung', `${d.kwp} kWp`], ['Hinweis', d.note]]);
      case 'chimney': return '<h3>Kamin</h3>' + dl([['Lage', `${f2(d.x)}, ${f2(d.z)}`], ['Zug', `${d.shaft[0] * 100}/${d.shaft[1] * 100} cm`], ['OK Kopf', f2(d.top)]]);
      case 'railing': return `<h3>Geländer ${esc(d.id)}</h3>` + dl([['Höhe', f2(d.height) + ' m'], ['Hinweis', d.note]]);
      case 'pergola': return `<h3>${esc(d.name || 'Pergola')}</h3>` + dl([['Größe', `${f2(d.x[1] - d.x[0])} × ${f2(d.z[1] - d.z[0])} m`], ['Höhe', f2(d.top - (d.base ?? 0)) + ' m'], ['Hinweis', d.note]]);
      case 'post': return `<h3>Stütze ${esc(d.id)}</h3>` + dl([['Querschnitt', `${d.size * 100}/${d.size * 100} cm`], ['Höhe', f2(d.top - d.base) + ' m']]);
      case 'pool': return `<h3>${esc(d.name || 'Pool')}</h3>` + dl([['Maße', `${f2(Math.max(...d.outline.map(p => p[0])) - Math.min(...d.outline.map(p => p[0])))} × ${f2(Math.max(...d.outline.map(p => p[1])) - Math.min(...d.outline.map(p => p[1])))} m`], ['Tiefe', f2(d.depth) + ' m'], ['Beckenrand', f2(d.top)], ['Hinweis', d.note]]);
      case 'gradewall': return `<h3>${esc(d.name || 'Stützmauer')}</h3>` + dl([['ID', d.id], ['Höhe über Gelände', f2(d._h) + ' m'], ['OK', f2(d._top)], ['Stärke', f2(d.thickness ?? 0.25) + ' m'], ['Hinweis', d.note]]);
      case 'furniture': return `<h3>${esc(d.name || d.type)}</h3>` + dl([['Raum', d.room], ['Maße', `${f2(Math.abs(d.x[1] - d.x[0]))} × ${f2(Math.abs(d.z[1] - d.z[0]))} m`], ['Hinweis', d.note]]);
      case 'garden': { const g = gardenInfo(d); return `<h3>${esc(g.title)}</h3>` + dl(g.rows) + (g.note ? `<p class="note">${esc(g.note)}</p>` : ''); }
      case 'beam': return `<h3>Unterzug ${esc(d.id)}</h3>` + dl([['Breite', f2(d.width) + ' m'], ['UK', f2(d.bottom)]]);
      default: return '<span class="empty">Kein Bauteil.</span>';
    }
  }

  // editor
  const ta = $('json'), msg = $('editmsg');
  const fillEditor = () => { ta.value = JSON.stringify(DATA, null, 1); };
  $('apply').addEventListener('click', () => {
    try { const d = JSON.parse(ta.value); build(d); DATA = d; setLevel(state.level); renderVersions(); msg.className = 'msg'; msg.textContent = isDirty() ? 'Übernommen als Vorschau. Unter „Versionen“ speichern, um sie zu behalten.' : 'Keine Änderung gegenüber der geöffneten Version.'; }
    catch (err) { msg.className = 'msg err'; msg.textContent = 'Nicht übernommen: ' + err.message; try { build(DATA); } catch {} }
  });
  $('reset').addEventListener('click', async () => { await openVersion(currentId); msg.className = 'msg'; msg.textContent = 'Auf die geöffnete Version zurückgesetzt.'; });
  $('copy').addEventListener('click', () => {
    navigator.clipboard.writeText(ta.value).then(() => { msg.className = 'msg'; msg.textContent = 'JSON kopiert.'; })
      .catch(() => { ta.focus(); ta.select(); msg.className = 'msg'; msg.textContent = 'Text markiert, bitte manuell kopieren.'; });
  });


  // ---------- versions (Supabase table house_versions, see houseStore.js) ----------
  // The list holds names and dates only; a version's model is loaded when it is opened.
  let versions = opts.versions, currentId = opts.currentId, currentJson = JSON.stringify(ORIGINAL), delArmed = false;
  const models = new Map([[currentId, structuredClone(ORIGINAL)]]);
  const vlistEl = $('vlist'), vmsg = $('vmsg');
  const vnameIn = $('vname'), vnoteIn = $('vnote'), vdelBtn = $('vdel'), vdefBtn = $('vdefault');
  const vrenBtn = $('vren'), vrenForm = $('vrenform'), vrenName = $('vrenname'), vrenNote = $('vrennote');
  // Everything about the open version (rename, save, default, delete) and the display
  // options sit behind the gear on the open version; the panel stays open across versions.
  const vsetEl = $('vsettings');
  // The shared page shows one version with its display options; nothing to save or change.
  const READ_ONLY = Boolean(opts.readOnly);
  if (READ_ONLY) {
    for (const id of ['vactions', 'vrenform', 'vsavebox', 'editsec']) $(id).hidden = true;
    vsetEl.hidden = false;
    if (opts.versions.length === 1) host.querySelector('.vsec .vhead .label').textContent = 'Version';
  }
  // Links of the share panel, to hide "Version löschen" for shared versions.
  let sharedIds = new Set();
  const sharePanel = opts.shares && !READ_ONLY ? mountSharePanel($('sharesec'), {
    shares: opts.shares,
    getVersion: () => versions.find(v => v.id === currentId),
    getVersions: () => versions,
    onChange: list => { sharedIds = new Set(list.flatMap(s => s.versionIds)); renderVersions(); },
  }) : null;
  if (sharePanel) $('sharesec').hidden = false;
  const GEAR = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>';
  function toggleSettings(open = vsetEl.hidden) {
    vsetEl.hidden = !open; if (!open) { closeRename(); delArmed = false; }
    renderVersions();
  }
  const fmtDate = iso => { try { return new Date(iso).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };
  const setVmsg = (t, err) => { vmsg.textContent = t; vmsg.className = err ? 'msg err' : 'msg'; };
  function isDirty() { return JSON.stringify(DATA) !== currentJson; }
  function renderVersions() {
    vlistEl.replaceChildren(...versions.map(v => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.className = 'vitem'; b.setAttribute('aria-current', String(v.id === currentId));
      const head = document.createElement('span'); head.className = 'vhead';
      const n = document.createElement('span'); n.className = 'vname'; n.textContent = v.name || v.id;
      const d = document.createElement('span'); d.className = 'vdate'; d.textContent = fmtDate(v.created_at);
      head.append(n, d); b.append(head);
      if (v.is_current) { const t = document.createElement('span'); t.className = 'vtag'; t.textContent = 'Standard: öffnet sich zuerst'; b.append(t); }
      if (v.note) { const no = document.createElement('span'); no.className = 'vnote'; no.textContent = v.note; b.append(no); }
      b.addEventListener('click', () => openVersion(v.id));
      li.append(b);
      if (v.id === currentId && !READ_ONLY) {
        const g = document.createElement('button');
        g.type = 'button'; g.className = 'vgear'; g.innerHTML = GEAR;
        g.setAttribute('aria-label', 'Einstellungen'); g.title = 'Einstellungen'; g.setAttribute('aria-expanded', String(!vsetEl.hidden));
        g.addEventListener('click', () => toggleSettings());
        li.append(g);
      }
      return li;
    }));
    const curEl = vlistEl.querySelector('[aria-current="true"]');
    if (curEl) vlistEl.scrollTop = curEl.offsetTop - vlistEl.offsetTop - 4;
    const cur = versions.find(v => v.id === currentId);
    $('state').textContent = cur ? cur.name : 'Version';
    $('dirty').hidden = READ_ONLY || !isDirty();
    if (sharePanel && !vsetEl.hidden) sharePanel.refresh();
    vdelBtn.hidden = !cur || cur.is_current || cur.locked || sharedIds.has(cur.id); vdelBtn.textContent = delArmed ? 'Wirklich löschen?' : 'Version löschen';
    vdefBtn.hidden = !cur || cur.is_current;
    vrenBtn.hidden = !cur || !vrenForm.hidden;
    $('dirty').title = vsetEl.hidden ? 'Zum Speichern öffnen' : '';
  }
  function closeRename() { vrenForm.hidden = true; }
  async function openVersion(id) {
    delArmed = false; closeRename();
    if (isDirty() && id !== currentId) setVmsg('Die ungespeicherte Vorschau wurde verworfen.');
    let d = models.get(id);
    if (!d) {
      setVmsg('Version wird geladen …');
      try { d = await store.load(id); } catch (e) { setVmsg(e.message, true); return; }
      if (disposed) return;
      models.set(id, structuredClone(d)); setVmsg('');
    } else d = structuredClone(d);
    try { build(d); } catch (e) { setVmsg('Version lässt sich nicht darstellen: ' + e.message, true); build(DATA); return; }
    DATA = d; currentId = id; currentJson = JSON.stringify(d); fillEditor(); setLevel(state.level); select(null);
    renderVersions();
  }
  $('vsavebtn').addEventListener('click', async () => {
    const name = vnameIn.value.trim();
    if (!name) { setVmsg('Bitte einen Namen für die Version eingeben.', true); vnameIn.focus(); return; }
    let d;
    try { d = JSON.parse(ta.value); build(d); } catch (e) { setVmsg('Nicht gespeichert, die Modelldaten sind fehlerhaft: ' + e.message, true); try { build(DATA); } catch {} return; }
    const btn = $('vsavebtn'); btn.disabled = true; setVmsg('Wird gespeichert …');
    try {
      const row = await store.save({ name, note: vnoteIn.value.trim(), parentId: currentId, model: d });
      if (disposed) return;
      models.set(row.id, structuredClone(d)); versions = [row, ...versions];
      DATA = d; currentId = row.id; currentJson = JSON.stringify(d);
      vnameIn.value = ''; vnoteIn.value = ''; setLevel(state.level);
      setVmsg(`„${name}“ gespeichert.`); renderVersions();
    } catch (e) {
      setVmsg(e.message, true);
    } finally { btn.disabled = false; }
  });
  // Renaming changes only the name and the note, so locked versions can be renamed too.
  vrenBtn.addEventListener('click', () => {
    const cur = versions.find(v => v.id === currentId); if (!cur) return;
    delArmed = false; vrenName.value = cur.name || ''; vrenNote.value = cur.note || '';
    vrenForm.hidden = false; renderVersions(); vrenName.focus(); vrenName.select();
  });
  $('dirty').addEventListener('click', () => { $('vsavebox').open = true; toggleSettings(true); vnameIn.focus(); });
  $('vrencancel').addEventListener('click', () => { closeRename(); renderVersions(); });
  async function saveRename() {
    const cur = versions.find(v => v.id === currentId); if (!cur) return;
    const name = vrenName.value.trim(), note = vrenNote.value.trim();
    if (!name) { setVmsg('Bitte einen Namen für die Version eingeben.', true); vrenName.focus(); return; }
    if (name === cur.name && note === (cur.note || '')) { closeRename(); renderVersions(); return; }
    const btn = $('vrensave'); btn.disabled = true; setVmsg('Wird gespeichert …');
    try {
      const row = await store.rename(cur.id, { name, note }); if (disposed) return;
      versions = versions.map(v => v.id === row.id ? { ...v, name: row.name, note: row.note } : v);
      closeRename(); setVmsg(`Umbenannt in „${row.name}“.`); renderVersions();
    } catch (e) {
      setVmsg(e.message, true);
    } finally { btn.disabled = false; }
  }
  $('vrensave').addEventListener('click', saveRename);
  for (const input of [vrenName, vrenNote]) input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveRename(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRename(); renderVersions(); }
  });
  vdelBtn.addEventListener('click', async () => {
    const cur = versions.find(v => v.id === currentId);
    if (!cur || cur.is_current || cur.locked) return;
    if (!delArmed) { delArmed = true; renderVersions(); return; }
    delArmed = false;
    try {
      await store.remove(cur.id); if (disposed) return;
      versions = versions.filter(v => v.id !== cur.id); models.delete(cur.id);
      setVmsg(`„${cur.name}“ gelöscht.`);
      const def = versions.find(v => v.is_current) ?? versions[0];
      if (def) await openVersion(def.id); else renderVersions();
    } catch (e) { setVmsg(e.message, true); renderVersions(); }
  });
  vdefBtn.addEventListener('click', async () => {
    const cur = versions.find(v => v.id === currentId); if (!cur) return;
    try {
      await store.setCurrent(cur.id); if (disposed) return;
      versions = versions.map(v => ({ ...v, is_current: v.id === cur.id }));
      setVmsg(`„${cur.name}“ öffnet sich ab jetzt zuerst.`); renderVersions();
    } catch (e) { setVmsg(e.message, true); }
  });

  // compass
  const needle = $('needle');
  const NXZ = CONTEXT?.neighborhood?.meta?.georef?.trueNorthInModelXZ;
  const north = NXZ ? new THREE.Vector3(NXZ[0], 0, NXZ[1]).normalize() : new THREE.Vector3(Math.sin((DATA.meta.northAngleDeg ?? 45) * Math.PI / 180), 0, -Math.cos((DATA.meta.northAngleDeg ?? 45) * Math.PI / 180));
  function updCompass() {
    const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1).applyQuaternion(camera.quaternion).setY(0);
    if (f.lengthSq() < 1e-6) { camera.up.set(0, 1, 0); f.set(0, 0, -1); }
    f.normalize(); const r = new THREE.Vector3(-f.z, 0, f.x);
    const a = Math.atan2(north.dot(r), north.dot(f)) * 180 / Math.PI;
    needle.setAttribute('transform', `rotate(${a.toFixed(1)})`);
  }

  // ---------- walk mode: first person at eye height, collision against walls/furniture, follows floors and stairs ----------
  const EYE = 1.65, RAD = 0.28, STEP = 0.45, DOWN = new THREE.Vector3(0, -1, 0);
  const walk = { active: false, pending: false, yaw: 0, pitch: 0, feet: 0, vy: 0, keys: new Set(), joy: [0, 0], look: null, saved: null, last: 0, dirty: false, root: null, ground: [], block: [] };
  const walkHud = $('walkhud'), walkMsg = $('walkmsg'), walkBtn = $('walkbtn');
  const joyEl = $('joy'), joyKnob = joyEl.querySelector('i'), wray = new THREE.Raycaster();
  const GROUND_KINDS = new Set(['slab', 'floor', 'stair']), BLOCK_KINDS = new Set(['wall', 'opening', 'furniture', 'railing', 'post', 'pergola', 'insulation', 'chimney', 'gradewall']);
  const WALK_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
  const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  function walkLists() {   // meshes to stand on and meshes that stop you (doors are walked through, rugs ignored); world bounding spheres for a cheap near-filter
    walk.root = root; walk.ground = []; walk.block = [];
    root.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh) return; const k = o.userData?.kind, d = o.userData?.data;
      if (GROUND_KINDS.has(k) || (k === 'garden' && o.userData.walk === 'ground')) walk.ground.push(o);
      else if (k === 'garden') { if (o.userData.walk === 'block') walk.block.push(o); }
      else if (BLOCK_KINDS.has(k) && !(k === 'opening' && d?.type === 'door') && !(k === 'furniture' && d?.type === 'rug')) walk.block.push(o);
    });
    root.updateMatrixWorld(true);
    for (const o of walk.ground.concat(walk.block)) { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); o.userData._ws = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld); }
  }
  const nearXZ = (list, x, z, r) => list.filter(o => { const c = o.userData._ws; return Math.hypot(c.center.x - x, c.center.z - z) < c.radius + r && shown(o); });
  const insideHouse = (x, z) => { const c = DATA.terrain?.cutout; return !!c && polyInside(c, x, z); };
  function groundBelow(x, z, fromY) {   // highest walkable surface below fromY: house floors, slabs, stairs, else the (graded) terrain outside the house
    wray.set(new THREE.Vector3(x, fromY, z), DOWN); wray.far = 60;
    const h = wray.intersectObjects(nearXZ(walk.ground, x, z, 0.05), false)[0];
    let y = h ? h.point.y : -Infinity;
    if (!insideHouse(x, z)) { const t = groundAt(x, z); if (isFinite(t) && t <= fromY + 1e-3) y = Math.max(y, t); }
    return y;
  }
  function blocked(x, z, dx, dz) {   // knee and chest rays in the direction of travel
    const d = Math.hypot(dx, dz); if (d < 1e-6) return false;
    const dir = new THREE.Vector3(dx / d, 0, dz / d), cand = nearXZ(walk.block, x, z, d + RAD + 0.5);
    for (const hgt of [0.5, 1.2]) {
      wray.set(new THREE.Vector3(x, walk.feet + hgt, z), dir); wray.far = d + RAD;
      if (wray.intersectObjects(cand, false).length) return true;
    }
    return false;
  }
  function walkSetCam() {
    camera.position.y = walk.feet + EYE; camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
    const f = new THREE.Vector3(0, 0, -2).applyEuler(camera.rotation); controls.target.copy(camera.position).add(f);   // keeps the Google Earth link meaningful
  }
  function walkStep(now) {
    const dt = Math.min(0.05, Math.max(0, (now - (walk.last || now)) / 1000)); walk.last = now;
    if (walk.root !== root) walkLists();
    const K = walk.keys; let f = 0, s = 0, turn = 0;
    if (K.has('KeyW') || K.has('ArrowUp')) f += 1; if (K.has('KeyS') || K.has('ArrowDown')) f -= 1;
    if (K.has('KeyD')) s += 1; if (K.has('KeyA')) s -= 1;
    if (K.has('ArrowLeft') || K.has('KeyQ')) turn += 1; if (K.has('ArrowRight') || K.has('KeyE')) turn -= 1;
    f -= walk.joy[1]; s += walk.joy[0];
    let changed = walk.dirty || turn !== 0; walk.dirty = false;
    walk.yaw += turn * 1.8 * dt;
    const len = Math.hypot(f, s), p = camera.position;
    if (len > 0.02) {
      const sp = (K.has('ShiftLeft') || K.has('ShiftRight') ? 2.8 : 1.4) * Math.min(1, len) / len * dt;
      const sy = Math.sin(walk.yaw), cy = Math.cos(walk.yaw);
      const dx = (-sy * f + cy * s) * sp, dz = (-cy * f - sy * s) * sp;
      if (!blocked(p.x, p.z, dx, 0)) p.x += dx;
      if (!blocked(p.x, p.z, 0, dz)) p.z += dz;
      changed = true;
    }
    const g = groundBelow(p.x, p.z, walk.feet + STEP);
    if (isFinite(g)) {
      if (g >= walk.feet - 0.6 && walk.vy === 0) { const nf = walk.feet + (g - walk.feet) * Math.min(1, dt * 14); if (Math.abs(nf - walk.feet) > 1e-4) changed = true; walk.feet = Math.abs(g - nf) < 0.002 ? g : nf; }
      else { walk.vy -= 9.81 * dt; walk.feet = Math.max(g, walk.feet + walk.vy * dt); if (walk.feet === g) walk.vy = 0; changed = true; }
    }
    if (changed) walkSetCam();
    return changed;
  }
  function walkHelp() { walkMsg.textContent = PHONE ? 'Ziehen: umsehen · Kreis unten links: gehen' : 'Ziehen: umsehen · W A S D / Pfeile: gehen · Shift: schneller · Esc: beenden'; }
  function enterWalk(x, feet, z, yaw) {
    if (!walk.saved) walk.saved = { pos: camera.position.clone(), tgt: controls.target.clone(), fov: camera.fov, near: camera.near, level: walk.pendingLevel ?? state.level };
    walk.pending = false; walk.active = true; anim = null; controls.enabled = false;
    camera.fov = PHONE ? 72 : 66; camera.near = 0.05; camera.updateProjectionMatrix();
    select(null); if (state.level !== 'all') setLevel('all');
    walkLists();
    camera.position.set(x, feet + EYE, z); walk.feet = feet; walk.vy = 0; walk.yaw = yaw; walk.pitch = -0.05; walk.last = 0; walkSetCam();
    host.classList.add('walking'); walkHud.hidden = false; joyEl.hidden = !PHONE; walkBtn.setAttribute('aria-pressed', 'true'); walkHelp(); kick(1500);
  }
  function exitWalk() {
    const sv = walk.saved; walk.active = walk.pending = false; walk.keys.clear(); walk.joy = [0, 0]; walk.look = null; walk.saved = null; walk.pendingLevel = undefined;
    controls.enabled = true; host.classList.remove('walking'); walkHud.hidden = true; joyEl.hidden = true; walkBtn.setAttribute('aria-pressed', 'false');
    if (sv) { camera.fov = sv.fov; camera.near = sv.near; camera.updateProjectionMatrix(); camera.position.copy(sv.pos); controls.target.copy(sv.tgt); controls.update(); if (state.level !== sv.level) setLevel(sv.level); }
    kick(1000);
  }
  function startWalkPick() {
    walk.pending = true; walk.pendingLevel = state.level; walk.saved = { pos: camera.position.clone(), tgt: controls.target.clone(), fov: camera.fov, near: camera.near, level: state.level };
    if (state.level === 'all') setLevel('EG');
    setSheet(false); goView('top');
    walkMsg.textContent = PHONE ? 'Tippe in einen Raum oder ins Gelände.' : 'Klicke in einen Raum oder ins Gelände, um dort zu stehen. Das Geschoss wählst du links.';
    walkHud.hidden = false; walkBtn.setAttribute('aria-pressed', 'true'); kick(1000);
  }
  function walkPick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const planes = clipPlanes();
    const hit = ray.intersectObject(root, true).find(h => h.object.isMesh && !h.object.isSprite && shown(h.object) && planes.every(pl => pl.distanceToPoint(h.point) >= 0));
    if (!hit) return;
    if (!walk.root || walk.root !== root) walkLists();
    const { x, z } = hit.point; let feet = groundBelow(x, z, hit.point.y + 0.3); if (!isFinite(feet)) feet = hit.point.y;
    let yaw = Math.atan2(x, z);   // outside: towards the house
    if (insideHouse(x, z)) {   // inside: face the direction with the most free room (16 rays at chest height)
      walk.feet = feet; let best = -1;
      for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, dir = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a));
        wray.set(new THREE.Vector3(x, feet + 1.2, z), dir); wray.far = 20; const h = wray.intersectObjects(nearXZ(walk.block, x, z, 20), false)[0], d = h ? h.distance : 20;
        if (d > best + 0.3) { best = d; yaw = a; } }
    }
    enterWalk(x, feet, z, yaw);
  }
  walkBtn.addEventListener('click', () => { if (walk.active || walk.pending) exitWalk(); else startWalkPick(); });
  $('walkexit').addEventListener('click', exitWalk);
  renderer.domElement.addEventListener('pointerdown', e => { if (walk.active) { walk.look = { id: e.pointerId, x: e.clientX, y: e.clientY }; } });
  on(window, 'pointermove', e => {
    if (!walk.active || !walk.look || e.pointerId !== walk.look.id) return;
    const k = e.pointerType === 'touch' ? 0.006 : 0.0045;
    walk.yaw += (e.clientX - walk.look.x) * k; walk.pitch = Math.max(-1.35, Math.min(1.35, walk.pitch + (e.clientY - walk.look.y) * k));
    walk.look.x = e.clientX; walk.look.y = e.clientY; walk.dirty = true;
  });
  for (const ev of ['pointerup', 'pointercancel']) on(window, ev, e => { if (walk.look && e.pointerId === walk.look.id) walk.look = null; });
  on(window, 'keydown', e => {
    if (!walk.active && !walk.pending) return;
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.code === 'Escape') { exitWalk(); return; }
    if (walk.active && WALK_KEYS.has(e.code)) { walk.keys.add(e.code); e.preventDefault(); }
  });
  on(window, 'keyup', e => walk.keys.delete(e.code));
  on(window, 'blur', () => walk.keys.clear());
  { let jid = null, jc = null;   // touch joystick: drag the knob, distance = speed
    const setJoy = (dx, dy) => { const r = 48, l = Math.hypot(dx, dy), k = l > r ? r / l : 1; joyKnob.style.transform = `translate(${dx * k}px, ${dy * k}px)`; walk.joy = [dx * k / r, dy * k / r]; };
    joyEl.addEventListener('pointerdown', e => { e.stopPropagation(); jid = e.pointerId; const b = joyEl.getBoundingClientRect(); jc = [b.left + b.width / 2, b.top + b.height / 2]; try { joyEl.setPointerCapture(jid); } catch {} setJoy(e.clientX - jc[0], e.clientY - jc[1]); });
    joyEl.addEventListener('pointermove', e => { if (e.pointerId === jid && jc) setJoy(e.clientX - jc[0], e.clientY - jc[1]); });
    for (const ev of ['pointerup', 'pointercancel']) joyEl.addEventListener(ev, e => { if (e.pointerId === jid) { jid = null; setJoy(0, 0); } });
  }

  // Google Earth link: same look-at point, distance, heading, tilt and field of view
  const GEO = CONTEXT?.neighborhood?.meta?.georef;
  const earthBtn = $('earth');
  function earthUrl() {
    const b = GEO.xAxisBearingDeg * Math.PI / 180, [lon0, lat0] = GEO.originLonLat;
    const en = (x, z) => [x * Math.sin(b) + z * Math.cos(b), x * Math.cos(b) - z * Math.sin(b)];   // model -> east/north
    const t = controls.target, c = camera.position;
    const [e, n] = en(t.x, t.z);
    const lat = lat0 + n / 110950, lon = lon0 + e / (111320 * Math.cos(lat0 * Math.PI / 180));
    const d = new THREE.Vector3().subVectors(t, c), dist = Math.max(1, d.length()); d.normalize();
    const [de, dn] = en(d.x, d.z);
    const heading = ((Math.atan2(de, dn) * 180 / Math.PI) + 360) % 360;
    const tilt = Math.min(89, Math.acos(Math.max(-1, Math.min(1, -d.y))) * 180 / Math.PI);
    const alt = t.y + (GEO.egFloorAbsoluteM ?? 0);
    return `https://earth.google.com/web/@${lat.toFixed(7)},${lon.toFixed(7)},${alt.toFixed(1)}a,${dist.toFixed(1)}d,${camera.fov.toFixed(0)}y,${heading.toFixed(1)}h,${tilt.toFixed(1)}t,0r`;
  }
  if (GEO) {
    earthBtn.hidden = false;
    const upd = () => { earthBtn.href = earthUrl(); };
    for (const ev of ['pointerenter', 'pointerdown', 'focus', 'click']) earthBtn.addEventListener(ev, upd);
  }

  // Esc leaves the full-screen view (walk mode uses Esc to stop walking first).
  on(window, 'keydown', e => { if (e.code === 'Escape' && host.classList.contains('full') && !walk.active && !walk.pending) setFull(false); });

  // resize + loop
  function resize() { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  const ro = new ResizeObserver(() => { resize(); kick(1000); }); ro.observe(stage);
  let renderUntil = 0, frameErrors = 0;
  function kick(ms = 700) { renderUntil = Math.max(renderUntil, performance.now() + ms); }
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'click', 'input', 'change', 'touchmove']) on(window, ev, () => kick(), { passive: true, capture: true });
  on(document, 'visibilitychange', () => { if (!document.hidden) kick(1000); });
  function frame(now) {
    if (disposed) return;
    rafId = requestAnimationFrame(frame);
    if (ctxLost || document.hidden) return;
    try {
      const animating = !!anim; if (anim) anim(now);
      const moved = walk.active ? walkStep(now) : controls.update();
      if (!(animating || moved || now < renderUntil)) return;
      updCompass(); cullTrees(); renderer.render(scene, camera); frameErrors = 0;
    } catch (e) { console.error(e); if (++frameErrors > 30) fail('Beim Zeichnen ist ein Fehler aufgetreten.', e.message); }
  }

  // sun from the south-east-ish, high
  const south = north.clone().multiplyScalar(-1);
  sun.position.copy(south.clone().multiplyScalar(30).add(new THREE.Vector3(10, 34, 8)));

  applyTheme();
  $('title').textContent = DATA.meta.name;
  $('addr').textContent = DATA.meta.address;
  resize();
  fitTarget(); camera.position.set(...VIEWS.persp).multiplyScalar(viewScale()); controls.target.copy(target);
  // Labels are drawn with the app's font; don't wait for it for ever.
  await Promise.race([document.fonts?.ready, new Promise((done) => setTimeout(done, 2000))]);
  if (disposed) return dispose;
  buildContext(); if (!CONTEXT) $('ctxsec').hidden = true;
  build(DATA); fillEditor(); setLevel('all');
  renderVersions();
  $('loading').hidden = true;
  kick(1500);
  rafId = requestAnimationFrame(frame);
  return dispose;
}
