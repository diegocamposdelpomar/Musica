/* Interfaz de Onda: vistas, listas, buscador, reproductor a pantalla completa y ajustes. */
(function () {
  const APP_VERSION = '1.8 (18-nov)';
  const DB = window.OndaDB, P = window.OndaPlayer, Tags = window.OndaTags, Demo = window.OndaDemo;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n) => `<svg aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const coll = new Intl.Collator('es', { sensitivity: 'base', numeric: true, ignorePunctuation: true });
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  }
  function fmtLong(s) {
    if (s < 60) return `${Math.round(s)} s`;
    const m = Math.round(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  }
  const fmtBytes = (b) => (b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? Math.round(b / 1e6) + ' MB' : Math.round(b / 1e3) + ' KB');

  /* ---------- Biblioteca en memoria ---------- */
  const lib = { tracks: new Map(), playlists: [] };
  // Canciones de internet (Audius, Archive, avances…): viven en memoria; se recuerdan las que están en la cola.
  const remote = new Map();
  try { (JSON.parse(localStorage.getItem('onda-remote') || '[]') || []).forEach((t) => remote.set(t.id, t)); } catch (e) { /* nada */ }
  function saveRemote() {
    const keep = new Set([...P.S.queue, ...P.S.source]);
    try { localStorage.setItem('onda-remote', JSON.stringify([...remote.values()].filter((t) => keep.has(t.id)))); } catch (e) { /* nada */ }
  }
  const get = (id) => lib.tracks.get(id) || remote.get(id);
  const SRC = { audius: 'Audius', archive: 'Internet Archive', deezer: 'Deezer', itunes: 'Apple Music', youtube: 'YouTube' };
  const all = () => [...lib.tracks.values()];
  const byTitle = (a, b) => coll.compare(a.title, b.title);
  const albumKey = (t) => t.album + '\u0001' + t.artist;

  function artists() {
    const m = new Map();
    for (const t of all()) { const a = m.get(t.artist) || { name: t.artist, tracks: [], albums: new Set() }; a.tracks.push(t); a.albums.add(t.album); m.set(t.artist, a); }
    return [...m.values()].sort((a, b) => coll.compare(a.name, b.name));
  }
  function albums() {
    const m = new Map();
    for (const t of all()) { const k = albumKey(t); const a = m.get(k) || { key: k, name: t.album, artist: t.artist, tracks: [] }; a.tracks.push(t); m.set(k, a); }
    for (const a of m.values()) { a.tracks.sort((x, y) => (x.trackNo || 999) - (y.trackNo || 999) || byTitle(x, y)); a.cover = a.tracks.find((t) => t.cover) || a.tracks[0]; }
    return [...m.values()].sort((a, b) => coll.compare(a.name, b.name));
  }

  /* ---------- Portadas ---------- */
  const coverUrls = new Map();
  function coverUrl(t) {
    if (t && t.coverUrl) return t.coverUrl;
    if (!t || !t.cover) return null;
    if (!coverUrls.has(t.id)) coverUrls.set(t.id, URL.createObjectURL(t.cover));
    return coverUrls.get(t.id);
  }
  function hue(str) { let h = 0; for (const c of String(str)) h = (h * 31 + c.codePointAt(0)) >>> 0; return h % 360; }
  function coverHTML(t, cls = '', label = '') {
    const u = coverUrl(t);
    if (u) return `<span class="cover ${cls}"><img src="${esc(u)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()"></span>`;
    const seed = t ? t.album + t.artist : label; const h = hue(seed);
    const letter = (t ? (t.album !== 'Sin álbum' ? t.album : t.title) : label || '♪').replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase() || '♪';
    return `<span class="cover cover-gen ${cls}" style="--h1:${h};--h2:${(h + 50) % 360}"><b>${esc(letter)}</b></span>`;
  }
  const artCache = new Map();
  async function artFor(t) { // imagen para la pantalla de bloqueo
    if (!t) return null;
    if (t.cover || t.coverUrl) return coverUrl(t);
    const k = albumKey(t);
    if (artCache.has(k)) return artCache.get(k);
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    const h = hue(t.album + t.artist);
    const gr = g.createLinearGradient(0, 0, 512, 512); gr.addColorStop(0, `hsl(${h} 70% 55%)`); gr.addColorStop(1, `hsl(${(h + 50) % 360} 60% 22%)`);
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    g.fillStyle = 'rgba(255,255,255,.9)'; g.font = '700 220px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText((t.album !== 'Sin álbum' ? t.album : t.title).trim().charAt(0).toUpperCase() || '♪', 256, 270);
    const u = c.toDataURL('image/png'); artCache.set(k, u); return u;
  }
  async function shrinkCover(blob) {
    try {
      const bmp = await createImageBitmap(blob);
      const s = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
      if (s === 1 && blob.size < 150e3) return blob;
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise((r) => c.toBlob((b) => r(b || blob), 'image/jpeg', 0.85));
    } catch (e) { return blob; }
  }

  /* ---------- Avisos ---------- */
  let toastT = 0;
  function toast(msg, ms = 2400) {
    const el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms);
  }

  /* ---------- Importar canciones ---------- */
  let importing = false;
  async function importFiles(files) {
    files = [...files].filter((f) => /^audio\//.test(f.type) || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i.test(f.name));
    if (!files.length) { toast('No se encontraron archivos de audio'); return; }
    if (importing) return; importing = true;
    const seen = new Set(all().map((t) => t.name + '|' + t.size));
    let added = 0, skipped = 0, failed = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      toast(`Añadiendo ${i + 1} de ${files.length}…`, 60000);
      if (seen.has(f.name + '|' + f.size)) { skipped++; continue; }
      try {
        const m = await Tags.read(f);
        const meta = { id: uid(), title: m.title, artist: m.artist, album: m.album, trackNo: m.trackNo, duration: m.duration, cover: m.cover ? await shrinkCover(m.cover) : null, lyrics: m.lyrics ? Object.assign(window.OndaLyrics.fromText(m.lyrics), { source: 'archivo' }) : null, name: f.name, size: f.size, type: f.type, added: Date.now() + i, fav: false, plays: 0, lastPlayed: 0 };
        await DB.addTrack(meta, f);
        lib.tracks.set(meta.id, meta); seen.add(f.name + '|' + f.size); added++;
      } catch (e) { failed++; }
    }
    importing = false;
    const parts = [added ? `${plural(added, 'canción añadida', 'canciones añadidas')}` : 'No se añadió nada'];
    if (skipped) parts.push(`${skipped} ya estaba${skipped === 1 ? '' : 'n'}`);
    if (failed) parts.push(`${failed} con error`);
    toast(parts.join(' · '), 3200);
    if (added && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    render();
  }
  $('filePick').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
  const pickFiles = () => $('filePick').click();

  async function addDemos(btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Componiendo…'; }
    let n = 0, k = 0;
    for (const s of Demo.songs) {
      k++;
      if (all().some((t) => t.title === s.title && t.artist === s.artist)) continue;
      toast(`Componiendo canción ${k} de ${Demo.songs.length}…`, 90000);
      if (btn) btn.textContent = `Componiendo ${k} de ${Demo.songs.length}…`;
      await new Promise((r) => setTimeout(r, 30)); // deja pintar el aviso
      try {
        const r = await Demo.render(s);
        const meta = { id: uid(), title: s.title, artist: s.artist, album: s.album, trackNo: s.trackNo, duration: r.duration, cover: r.cover, name: s.title + '.wav', size: r.blob.size, type: 'audio/wav', added: Date.now() + s.trackNo, fav: false, plays: 0, lastPlayed: 0, demo: true };
        await DB.addTrack(meta, r.blob); lib.tracks.set(meta.id, meta); n++;
      } catch (e) { console.error(e); }
    }
    toast(n ? `${plural(n, 'canción de muestra lista', 'canciones de muestra listas')}` : 'Las muestras ya estaban en tu biblioteca');
    render();
  }

  /* ---------- Listas de canciones con contexto de reproducción ---------- */
  let ctxs = {};
  function trackRows(tracks, key, from, opts = {}) {
    ctxs[key] = { ids: tracks.map((t) => t.id), from };
    const curId = P.currentId();
    let lastL = null;
    return `<ul class="rows" role="list">${tracks.map((t, i) => {
      // Índice alfabético: encabezado al empezar cada letra.
      let h = '';
      if (opts.az) { const L = opts.az(t); if (L !== lastL) { lastL = L; h = `<li class="az-h" id="az-${L === '#' ? 'num' : L}" data-az="${L}">${L}</li>`; } }
      return h + `
      <li class="row${t.id === curId ? ' is-cur' : ''}" data-id="${t.id}">
        <button type="button" class="row-main" data-ctx="${key}" data-i="${i}">
          ${opts.numbers ? `<span class="row-num">${t.id === curId ? '<span class="eqbars"><i></i><i></i><i></i></span>' : (t.trackNo || i + 1)}</span>` : coverHTML(t, 'cover-sm')}
          <span class="row-txt"><strong>${esc(t.title)}</strong><span>${t.fav ? `<svg class="tiny-heart" aria-label="Me gusta"><use href="#i-heart-on"/></svg>` : ''}${esc(opts.noArtist ? fmtTime(t.duration) : t.artist + ' · ' + (t.remote ? SRC[t.source] + (t.preview ? ' · avance 30 s' : t.duration ? ' · ' + fmtTime(t.duration) : '') : fmtTime(t.duration)))}</span></span>
          ${!opts.numbers && t.id === curId ? '<span class="eqbars"><i></i><i></i><i></i></span>' : ''}
        </button>
        <button type="button" class="icon-btn" data-more="${t.id}" data-pl="${opts.playlist || ''}" data-pi="${i}" aria-label="Opciones de ${esc(t.title)}">${icon('more')}</button>
      </li>`; }).join('')}</ul>`;
  }
  function playCtx(key, i, shuffle) {
    const c = ctxs[key]; if (!c || !c.ids.length) return;
    // Tocar la canción que ya suena no la reinicia: abre el reproductor (y la reanuda si estaba en pausa).
    if (i != null && c.ids[i] === P.currentId()) {
      if (P.audio.paused) P.play();
      if (layers[layers.length - 1] === 'sheet') closeSheet(openNP); else openNP();
      return;
    }
    P.playList(c.ids, i == null ? null : c.ids[i], c.from, shuffle === undefined ? {} : { shuffle });
  }
  const playBar = (key, n, dur) => `<div class="play-row">
      <button type="button" class="btn btn-go" data-playall="${key}">${icon('play')}Reproducir</button>
      <button type="button" class="btn" data-shuffleall="${key}">${icon('shuffle')}Aleatorio</button>
      <span class="muted small">${plural(n, 'canción', 'canciones')}${dur ? ' · ' + fmtLong(dur) : ''}</span></div>`;

  /* ---------- Vistas ---------- */
  const view = $('view');
  let route = { name: 'inicio', arg: '' };
  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    return { name: parts[0] || 'inicio', arg: parts.slice(1).map(decodeURIComponent).join('/') };
  }
  function setBar(title, { back = false, actions = '' } = {}) {
    $('viewTitle').textContent = title; $('backBtn').hidden = !back; $('barActions').innerHTML = actions;
    document.title = title === 'Inicio' ? 'Onda · Tu música' : title + ' · Onda';
  }
  const gearBtn = `<button type="button" class="icon-btn" data-go="#/ajustes" aria-label="Ajustes">${icon('gear')}</button>`;
  const addBtn = `<button type="button" class="icon-btn" data-act="pick" aria-label="Añadir canciones">${icon('plus')}</button>`;

  function emptyLibrary() {
    return `<div class="empty">
      <div class="empty-art">${icon('note')}</div>
      <h2>Tu música, en tu bolsillo</h2>
      <p>Añade canciones que tengas en el teléfono (MP3, M4A, WAV, OGG, FLAC…). Se guardan dentro de la app y se escuchan sin internet.</p>
      <button type="button" class="btn btn-go btn-lg" data-act="pick">${icon('plus')}Añadir canciones</button>
      <button type="button" class="btn btn-lg" data-act="demos">Probar con 3 canciones de muestra</button>
    </div>`;
  }

  function vInicio() {
    setBar('Inicio', { actions: addBtn + gearBtn });
    if (!lib.tracks.size) return emptyLibrary() + installCard();
    const h = new Date().getHours();
    const hello = h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
    const tracks = all();
    const favs = tracks.filter((t) => t.fav);
    const recent = tracks.slice().sort((a, b) => b.added - a.added).slice(0, 12);
    const top = tracks.filter((t) => t.plays > 0).sort((a, b) => b.plays - a.plays || b.lastPlayed - a.lastPlayed).slice(0, 5);
    const lastAlbums = [];
    for (const t of tracks.slice().sort((a, b) => (b.lastPlayed || b.added) - (a.lastPlayed || a.added))) {
      const k = albumKey(t); if (!lastAlbums.some((x) => x.k === k)) lastAlbums.push({ k, t }); if (lastAlbums.length >= 10) break;
    }
    ctxs.all = { ids: tracks.slice().sort(byTitle).map((t) => t.id), from: 'Todas las canciones' };
    return `<p class="hello">${hello}</p>
      <div class="quick">
        <button type="button" class="quick-btn q1" data-shuffleall="all">${icon('shuffle')}<span>Aleatorio<small>${plural(tracks.length, 'canción', 'canciones')}</small></span></button>
        <a class="quick-btn q2" href="#/lista/favoritas">${icon('heart-on')}<span>Me gusta<small>${plural(favs.length, 'canción', 'canciones')}</small></span></a>
      </div>
      ${installCard()}
      <h2 class="sec">Para volver a escuchar</h2>
      <div class="hscroll">${lastAlbums.map(({ k, t }) => `<a class="card" href="#/album/${encodeURIComponent(k)}">${coverHTML(t, 'cover-md')}<strong>${esc(t.album)}</strong><span>${esc(t.artist)}</span></a>`).join('')}</div>
      ${top.length ? `<h2 class="sec">Lo que más escuchas</h2>${trackRows(top, 'top', 'Lo que más escuchas')}` : ''}
      <h2 class="sec">Añadidas recientemente</h2>${trackRows(recent.slice(0, 6), 'recent', 'Añadidas recientemente')}
      ${lib.playlists.length ? `<h2 class="sec">Tus listas</h2><div class="hscroll">${lib.playlists.map((p) => `<a class="card" href="#/lista/${p.id}">${listCover(p, 'cover-md')}<strong>${esc(p.name)}</strong><span>${plural(p.ids.length, 'canción', 'canciones')}</span></a>`).join('')}</div>` : ''}`;
  }

  const LIB_TABS = [['canciones', 'Canciones'], ['artistas', 'Artistas'], ['albumes', 'Álbumes']];
  function vBiblioteca(sub) {
    sub = LIB_TABS.some(([k]) => k === sub) ? sub : (load('libTab') || 'canciones');
    save('libTab', sub);
    setBar('Biblioteca', { actions: addBtn + gearBtn });
    if (!lib.tracks.size) return emptyLibrary();
    const seg = `<div class="seg" role="tablist">${LIB_TABS.map(([k, l]) => `<a role="tab" href="#/biblioteca/${k}" aria-selected="${k === sub}">${l}</a>`).join('')}</div>`;
    const ph = { canciones: 'Buscar en tus canciones', artistas: 'Buscar artistas', albumes: 'Buscar álbumes' }[sub];
    libSub = sub;
    return seg + `<div class="search search-sm"><span class="search-ico">${icon('search')}</span><input type="search" id="libQ" placeholder="${ph}" autocomplete="off" enterkeyhint="search" value="${esc(libQ)}" aria-label="${ph}"></div><div id="libList">${libList(sub)}</div>`;
  }
  let libQ = '', libSub = 'canciones';
  const matcher = (q) => { const words = norm(q.trim()).split(/\s+/).filter(Boolean); return (s) => words.every((w) => norm(s).includes(w)); };
  function libList(sub) {
    const hit = matcher(libQ); const none = `<p class="muted center">Nada coincide con «${esc(libQ.trim())}».</p>`;
    if (sub === 'artistas') {
      const as = artists().filter((a) => hit(a.name));
      if (!as.length) return none;
      return `<ul class="rows">${as.map((a) => `<li class="row"><a class="row-main" href="#/artista/${encodeURIComponent(a.name)}">
        ${coverHTML(null, 'cover-sm round', a.name)}<span class="row-txt"><strong>${esc(a.name)}</strong><span>${plural(a.albums.size, 'álbum', 'álbumes')} · ${plural(a.tracks.length, 'canción', 'canciones')}</span></span></a></li>`).join('')}</ul>`;
    }
    if (sub === 'albumes') {
      const als = albums().filter((a) => hit(a.name + ' ' + a.artist));
      if (!als.length) return none;
      return `<div class="grid">${als.map((a) => `<a class="card" href="#/album/${encodeURIComponent(a.key)}">${coverHTML(a.cover, 'cover-fill')}<strong>${esc(a.name)}</strong><span>${esc(a.artist)}</span></a>`).join('')}</div>`;
    }
    const sort = load('sort') || 'titulo';
    const sorters = { titulo: byTitle, artista: (a, b) => coll.compare(a.artist, b.artist) || coll.compare(a.album, b.album) || (a.trackNo - b.trackNo) || byTitle(a, b), recientes: (a, b) => b.added - a.added };
    const tracks = all().filter((t) => hit(t.title + ' ' + t.artist + ' ' + t.album)).sort(sorters[sort] || byTitle);
    if (!tracks.length) return none;
    const dur = tracks.reduce((s, t) => s + (t.duration || 0), 0);
    return `<div class="list-head"><span class="muted small">${plural(tracks.length, 'canción', 'canciones')}${dur ? ' · ' + fmtLong(dur) : ''}</span>
      <label class="sort"><span class="sr">Ordenar por</span><select id="sortSel">
        <option value="titulo"${sort === 'titulo' ? ' selected' : ''}>Por título</option>
        <option value="artista"${sort === 'artista' ? ' selected' : ''}>Por artista</option>
        <option value="recientes"${sort === 'recientes' ? ' selected' : ''}>Más recientes</option></select></label></div>
      ${sort === 'recientes' ? trackRows(tracks, 'lib', 'Tu biblioteca') : azList(tracks, sort === 'artista' ? (t) => t.artist : (t) => t.title)}`;
  }

  /* ---------- Índice alfabético (A–Z) ---------- */
  const AZ = ['#', ...'ABCDEFGHIJKLMN'.split(''), 'Ñ', ...'OPQRSTUVWXYZ'.split('')];
  function letterOf(str) {
    // Se ignoran signos iniciales (¿, ¡, comillas…), igual que al ordenar.
    const c = String(str || '').replace(/^[^\p{L}\p{N}]+/u, '').charAt(0);
    if (/ñ/i.test(c)) return 'Ñ';
    const n = norm(c).toUpperCase();
    return /[A-Z]/.test(n) ? n : '#';
  }
  function azList(tracks, field) {
    const az = (t) => letterOf(field(t));
    const have = new Set(tracks.map(az));
    const rail = have.size > 1 ? `<nav class="az-rail" id="azRail" aria-label="Ir a una letra">${AZ.map((L) => `<button type="button" tabindex="-1" data-azgo="${L}" class="${have.has(L) ? '' : 'off'}" aria-label="Letra ${L === '#' ? 'números y símbolos' : L}">${L}</button>`).join('')}</nav><div class="az-bubble" id="azBubble" hidden></div>` : '';
    return trackRows(tracks, 'lib', 'Tu biblioteca', { az }) + rail;
  }

  function vArtista(name) {
    const a = artists().find((x) => x.name === name);
    setBar(name, { back: true });
    if (!a) return notFound('Este artista ya no está en tu biblioteca.');
    const als = albums().filter((x) => x.artist === name);
    const tracks = a.tracks.slice().sort((x, y) => coll.compare(x.album, y.album) || (x.trackNo - y.trackNo) || byTitle(x, y));
    return `<div class="hero">${coverHTML(null, 'cover-lg round', name)}<div><p class="eyebrow">Artista</p><h2>${esc(name)}</h2></div></div>
      ${playBar('artist', tracks.length, tracks.reduce((s, t) => s + (t.duration || 0), 0))}
      ${als.length > 1 || (als[0] && als[0].name !== 'Sin álbum') ? `<h2 class="sec">Álbumes</h2><div class="hscroll">${als.map((x) => `<a class="card" href="#/album/${encodeURIComponent(x.key)}">${coverHTML(x.cover, 'cover-md')}<strong>${esc(x.name)}</strong><span>${plural(x.tracks.length, 'canción', 'canciones')}</span></a>`).join('')}</div>` : ''}
      <h2 class="sec">Canciones</h2>${trackRows(tracks, 'artist', name)}`;
  }

  function vAlbum(key) {
    const a = albums().find((x) => x.key === key);
    setBar('Álbum', { back: true });
    if (!a) return notFound('Este álbum ya no está en tu biblioteca.');
    const dur = a.tracks.reduce((s, t) => s + (t.duration || 0), 0);
    return `<div class="hero hero-col">${coverHTML(a.cover, 'cover-xl')}<div><h2>${esc(a.name)}</h2><a class="hero-sub" href="#/artista/${encodeURIComponent(a.artist)}">${esc(a.artist)}</a></div></div>
      ${playBar('album', a.tracks.length, dur)}${trackRows(a.tracks, 'album', a.name, { numbers: true, noArtist: true })}`;
  }

  function listCover(p, cls) {
    const first = p.ids.map(get).filter(Boolean);
    const withCover = first.find((t) => t.cover) || first[0];
    return withCover ? coverHTML(withCover, cls) : `<span class="cover cover-gen ${cls}" style="--h1:${hue(p.name)};--h2:${(hue(p.name) + 60) % 360}">${icon('lists')}</span>`;
  }
  function vListas() {
    setBar('Listas', { actions: `<button type="button" class="icon-btn" data-act="newlist" aria-label="Nueva lista">${icon('plus')}</button>` + gearBtn });
    const favN = all().filter((t) => t.fav).length;
    return `<button type="button" class="btn btn-go btn-wide" data-act="newlist">${icon('plus')}Nueva lista</button>
      <ul class="rows">
        <li class="row"><a class="row-main" href="#/lista/favoritas"><span class="cover cover-sm cover-fav">${icon('heart-on')}</span><span class="row-txt"><strong>Me gusta</strong><span>${plural(favN, 'canción', 'canciones')}</span></span></a></li>
        ${lib.playlists.slice().sort((a, b) => coll.compare(a.name, b.name)).map((p) => `<li class="row"><a class="row-main" href="#/lista/${p.id}">${listCover(p, 'cover-sm')}<span class="row-txt"><strong>${esc(p.name)}</strong><span>${plural(p.ids.filter(get).length, 'canción', 'canciones')}</span></span></a></li>`).join('')}
      </ul>
      ${lib.playlists.length ? '' : '<p class="muted center">Crea listas para agrupar canciones: para entrenar, para estudiar, para el viaje…</p>'}`;
  }

  function vLista(id) {
    if (id === 'favoritas') {
      setBar('Me gusta', { back: true });
      const tracks = all().filter((t) => t.fav).sort((a, b) => (b.favAt || 0) - (a.favAt || 0));
      const head = `<div class="hero"><span class="cover cover-lg cover-fav">${icon('heart-on')}</span><div><p class="eyebrow">Lista automática</p><h2>Me gusta</h2></div></div>`;
      if (!tracks.length) return head + '<p class="muted center">Toca el corazón en cualquier canción para guardarla aquí.</p>';
      return head + playBar('fav', tracks.length, tracks.reduce((s, t) => s + (t.duration || 0), 0)) + trackRows(tracks, 'fav', 'Me gusta');
    }
    const p = lib.playlists.find((x) => x.id === id);
    if (!p) { setBar('Lista', { back: true }); return notFound('Esta lista ya no existe.'); }
    setBar(p.name, { back: true, actions: `<button type="button" class="icon-btn" data-listmore="${p.id}" aria-label="Opciones de la lista">${icon('more')}</button>` });
    const tracks = p.ids.map(get).filter(Boolean);
    const head = `<div class="hero">${listCover(p, 'cover-lg')}<div><p class="eyebrow">Lista</p><h2>${esc(p.name)}</h2></div></div>`;
    if (!tracks.length) return head + `<p class="muted center">Esta lista está vacía. En cualquier canción, toca ${icon('more')} y elige «Añadir a una lista».</p><button type="button" class="btn btn-wide" data-go="#/biblioteca/canciones">Ir a la biblioteca</button>`;
    return head + playBar('pl', tracks.length, tracks.reduce((s, t) => s + (t.duration || 0), 0)) + trackRows(tracks, 'pl', p.name, { playlist: p.id });
  }

  /* ---------- Buscar: en tu biblioteca y en internet ---------- */
  const Online = window.OndaOnline;
  let searchQ = '';
  const web = { q: '', data: {}, err: {}, busy: {}, token: 0 };
  const srcOn = (id) => { const o = load('sources') || {}; return o[id] !== false; };
  const ytKey = () => (load('ytKey') || '').trim();
  function vBuscar() {
    setBar('Buscar');
    return `<form class="search" id="qForm" role="search"><span class="search-ico">${icon('search')}</span><input type="search" id="q" placeholder="Canciones, artistas, álbumes…" autocomplete="off" enterkeyhint="search" value="${esc(searchQ)}" aria-label="Buscar música"></form>
      <div id="results">${results()}</div>`;
  }
  function results() {
    const q = searchQ.trim();
    if (!q) {
      const as = artists().slice(0, 12);
      return `<p class="muted">Busca en tu biblioteca y en internet a la vez:</p>
        <ul class="src-list">${Online.providers.map((p) => `<li><strong>${p.name}</strong><span>${p.note}${p.needsKey && !ytKey() ? ' · <a href="#/ajustes">añadir clave</a>' : ''}</span></li>`).join('')}
        <li><strong>Spotify, SoundCloud, YouTube Music…</strong><span>Se abre su app con tu búsqueda (no dejan reproducir en otras apps)</span></li></ul>
        ${as.length ? `<h2 class="sec">Tus artistas</h2><div class="chips">${as.map((a) => `<a class="chip" href="#/artista/${encodeURIComponent(a.name)}">${esc(a.name)}</a>`).join('')}</div>` : ''}`;
    }
    return libResults(q) + `<h2 class="sec sec-web">En internet</h2>
      <div class="chips ext">${Online.external.map((e) => `<a class="chip" href="${esc(e.url(q))}" target="_blank" rel="noopener">${esc(e.name)} ↗</a>`).join('')}</div>
      ${Online.providers.filter((p) => srcOn(p.id)).map((p) => `<section class="src" id="src-${p.id}">${srcBlock(p)}</section>`).join('')}
      <p class="muted small center">Las fuentes se eligen en <a href="#/ajustes">Ajustes</a>.</p>`;
  }
  function libResults(q) {
    if (!lib.tracks.size) return '';
    const hit = matcher(q);
    const tracks = all().filter((t) => hit(t.title + ' ' + t.artist + ' ' + t.album)).sort(byTitle).slice(0, 30);
    const as = artists().filter((a) => hit(a.name)).slice(0, 8);
    const als = albums().filter((a) => hit(a.name + ' ' + a.artist) && a.name !== 'Sin álbum').slice(0, 10);
    const pls = lib.playlists.filter((p) => hit(p.name));
    if (!tracks.length && !as.length && !als.length && !pls.length) return `<p class="muted small">En tu biblioteca no hay nada con «${esc(q)}».</p>`;
    return `<h2 class="sec">En tu biblioteca</h2>`
      + (as.length ? `<div class="chips">${as.map((a) => `<a class="chip" href="#/artista/${encodeURIComponent(a.name)}">${icon('person')}${esc(a.name)}</a>`).join('')}</div>` : '')
      + (als.length ? `<div class="hscroll">${als.map((a) => `<a class="card" href="#/album/${encodeURIComponent(a.key)}">${coverHTML(a.cover, 'cover-md')}<strong>${esc(a.name)}</strong><span>${esc(a.artist)}</span></a>`).join('')}</div>` : '')
      + (pls.length ? `<div class="chips">${pls.map((p) => `<a class="chip" href="#/lista/${p.id}">${icon('lists')}${esc(p.name)}</a>`).join('')}</div>` : '')
      + (tracks.length ? trackRows(tracks, 'search', 'Búsqueda') : '');
  }
  function srcBlock(p) {
    const q = searchQ.trim();
    const head = `<h3 class="src-h">${p.name}<small>${p.note}</small></h3>`;
    if (p.needsKey && !ytKey()) {
      const yt = Online.external.find((e) => e.id === 'youtube');
      return head + `<p class="muted small">Para ver resultados de YouTube aquí, añade tu clave gratuita en <a href="#/ajustes">Ajustes</a>. Mientras tanto: <a href="${esc(yt.url(q))}" target="_blank" rel="noopener">buscar «${esc(q)}» en YouTube ↗</a></p>`;
    }
    if (web.q !== q || web.busy[p.id]) return head + `<p class="muted small"><span class="spin"></span>Buscando…</p>`;
    if (web.err[p.id]) return head + `<p class="muted small">No respondió (${esc(web.err[p.id])}). <button type="button" class="linkish" data-retry="${p.id}">Reintentar</button></p>`;
    const items = web.data[p.id] || [];
    if (!items.length) return head + `<p class="muted small">Sin resultados.</p>`;
    items.forEach((t) => remote.set(t.id, Object.assign(t, { remote: true })));
    if (items[0].kind === 'album') return head + `<div class="hscroll">${items.map((a) => `<button type="button" class="card card-btn" data-iaalbum="${esc(a.id)}">${coverHTML(a, 'cover-md')}<strong>${esc(a.title)}</strong><span>${esc(a.artist)}${a.year ? ' · ' + esc(a.year) : ''}</span></button>`).join('')}</div>`;
    if (items[0].kind === 'video') return head + `<div class="hscroll">${items.map((v) => `<button type="button" class="card card-btn card-wide" data-ytvideo="${esc(v.id)}">${coverHTML(v, 'cover-video')}<strong>${esc(v.title)}</strong><span>${esc(v.artist)}</span></button>`).join('')}</div>`;
    return head + trackRows(items, 'web-' + p.id, p.name + ' · ' + q);
  }
  function paintSrc(id) { const el = $('src-' + id); if (el && route.name === 'buscar') el.innerHTML = srcBlock(Online.byId[id]); }
  async function searchWeb(force) {
    const q = searchQ.trim();
    if (q.length < 2 || (!force && web.q === q)) return;
    const token = ++web.token;
    web.q = q; web.data = {}; web.err = {}; web.busy = {};
    const list = Online.providers.filter((p) => srcOn(p.id) && !(p.needsKey && !ytKey()));
    list.forEach((p) => { web.busy[p.id] = true; });
    list.forEach((p) => paintSrc(p.id));
    await Promise.all(list.map(async (p) => {
      try { const r = await p.search(q, ytKey()); if (token !== web.token) return; web.data[p.id] = r; }
      catch (e) { if (token !== web.token) return; web.err[p.id] = e.message || 'error'; }
      web.busy[p.id] = false; paintSrc(p.id);
    }));
  }
  async function retrySrc(id) {
    const p = Online.byId[id]; const q = web.q; web.busy[id] = true; web.err[id] = ''; paintSrc(id);
    try { web.data[id] = await p.search(q, ytKey()); } catch (e) { web.err[id] = e.message || 'error'; }
    web.busy[id] = false; paintSrc(id);
  }
  let searchT = 0;
  function onSearchInput() {
    searchQ = $('q').value; ctxs = {};
    const lr = $('results');
    if (!searchQ.trim()) { lr.innerHTML = results(); return; }
    if (!lr.querySelector('.sec-web')) lr.innerHTML = results();
    else { // solo se repinta la parte de la biblioteca; la de internet espera a que dejes de escribir
      const web0 = lr.querySelector('.sec-web');
      while (web0.previousSibling) web0.previousSibling.remove();
      web0.insertAdjacentHTML('beforebegin', libResults(searchQ.trim()));
      lr.querySelectorAll('.chips.ext a').forEach((a, i) => { a.href = Online.external[i].url(searchQ.trim()); });
    }
    clearTimeout(searchT); searchT = setTimeout(() => searchWeb(), 700);
  }

  // Álbumes y conciertos de Internet Archive.
  async function iaAlbum(id) {
    const a = remote.get(id); if (!a) return;
    openSheet(a.title, `<div class="sheet-track">${coverHTML(a, 'cover-sm')}<span class="row-txt"><strong>${esc(a.title)}</strong><span>${esc(a.artist)} · Internet Archive</span></span></div><div id="iaBody"><p class="muted"><span class="spin"></span>Cargando canciones…</p></div>`);
    let tracks;
    try { tracks = await Online.archive.tracks(a); } catch (e) { const b = $('iaBody'); if (b) b.innerHTML = `<p class="muted">No se pudieron cargar las canciones (${esc(e.message)}).</p>`; return; }
    const body = $('iaBody'); if (!body) return;
    if (!tracks.length) { body.innerHTML = `<p class="muted">Este elemento no tiene canciones en MP3. <a href="${esc(a.link)}" target="_blank" rel="noopener">Ver en Internet Archive ↗</a></p>`; return; }
    tracks.forEach((t) => remote.set(t.id, Object.assign(t, { remote: true })));
    body.innerHTML = `<div class="btns"><button type="button" class="btn btn-go btn-sm" data-playall="ia">${icon('play')}Reproducir</button><button type="button" class="btn btn-sm" data-iasave="${esc(id)}">Guardar sin conexión</button><a class="btn btn-sm" href="${esc(a.link)}" target="_blank" rel="noopener">Ver en Archive ↗</a></div>`
      + trackRows(tracks, 'ia', a.title, { numbers: true });
    body.dataset.ids = JSON.stringify(tracks.map((t) => t.id));
  }
  async function saveOffline(t, quiet) {
    if (all().some((x) => x.originUrl === t.url)) { if (!quiet) toast('Ya estaba en tu biblioteca', 1500); return false; }
    const r = await fetch(t.url);
    if (!r.ok) throw new Error('respuesta ' + r.status);
    const blob = await r.blob();
    let cover = null;
    if (t.coverUrl) { try { const c = await fetch(t.coverUrl); if (c.ok) cover = await shrinkCover(await c.blob()); } catch (e) { /* sin portada */ } }
    const meta = { id: uid(), title: t.title, artist: t.artist || 'Artista desconocido', album: t.album || 'Sin álbum', trackNo: t.trackNo || 0, duration: t.duration || await Tags.read(new File([blob], 'a.mp3')).then((m) => m.duration).catch(() => 0), cover, name: t.title + '.mp3', size: blob.size, type: blob.type || 'audio/mpeg', added: Date.now(), fav: false, plays: 0, lastPlayed: 0, originUrl: t.url, originLink: t.link };
    await DB.addTrack(meta, blob); lib.tracks.set(meta.id, meta);
    return true;
  }
  async function saveMany(ids) {
    let ok = 0, fail = 0;
    for (let i = 0; i < ids.length; i++) {
      toast(`Guardando ${i + 1} de ${ids.length}…`, 60000);
      try { if (await saveOffline(remote.get(ids[i]), true)) ok++; } catch (e) { fail++; }
    }
    toast(`${plural(ok, 'canción guardada', 'canciones guardadas')} en tu biblioteca${fail ? ` · ${fail} no se pudieron descargar` : ''}`, 3500);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  // Videos de YouTube: se ven dentro de la app (no suenan con la pantalla apagada: así lo exige YouTube).
  function ytVideo(id) {
    const v = remote.get(id); if (!v) return;
    P.pause();
    openSheet(v.title, `<div class="yt"><iframe src="https://www.youtube-nocookie.com/embed/${esc(v.videoId)}?autoplay=1&playsinline=1&rel=0" title="${esc(v.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
      <p class="muted small">${esc(v.artist)}</p><div class="btns"><a class="btn btn-sm" href="${esc(v.link)}" target="_blank" rel="noopener">Abrir en YouTube ↗</a></div>`);
  }

  function vAjustes() {
    setBar('Ajustes', { back: true });
    const theme = load('theme') || 'auto';
    const size = all().reduce((s, t) => s + (t.size || 0), 0);
    return `<section class="panel"><h2>Apariencia</h2>
        <div class="seg seg-btn" role="radiogroup" aria-label="Tema">${[['auto', 'Automático'], ['dark', 'Oscuro'], ['light', 'Claro']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${theme === k}" data-theme-set="${k}">${l}</button>`).join('')}</div></section>
      <section class="panel"><h2>Biblioteca</h2>
        <p>${plural(lib.tracks.size, 'canción', 'canciones')} · ${fmtBytes(size)} guardados en este teléfono.</p>
        <p class="muted small" id="quota"></p>
        <div class="btns"><button type="button" class="btn btn-go" data-act="pick">${icon('plus')}Añadir canciones</button>
        <button type="button" class="btn" data-act="demos">Añadir canciones de muestra</button></div></section>
      <section class="panel"><h2>Sonido</h2>
        <div class="btns"><button type="button" class="btn" data-act="eq">${icon('eq')}Ecualizador</button><button type="button" class="btn" data-act="timer">${icon('timer')}Temporizador</button></div></section>
      <section class="panel"><h2>Búsqueda en internet</h2>
        <p class="muted small">Elige dónde busca la pestaña Buscar.</p>
        <div class="checks">${Online.providers.map((p) => `<label class="check"><input type="checkbox" data-src="${p.id}" ${srcOn(p.id) ? 'checked' : ''}><span><strong>${p.name}</strong><small>${p.note}</small></span></label>`).join('')}</div>
        <label class="check"><input type="checkbox" id="lyrWeb" ${lyricsWeb() ? 'checked' : ''}><span><strong>Letras de canciones (LRCLIB)</strong><small>Busca la letra por título y artista en lrclib.net, una base de letras libre</small></span></label>
        <h3 class="sub">Clave de YouTube (opcional)</h3>
        <p class="muted small">Con tu propia clave gratuita de YouTube verás los videos dentro de Onda. Cómo conseguirla: entra a console.cloud.google.com, crea un proyecto, activa «YouTube Data API v3» y en «Credenciales» crea una clave de API. Se guarda solo en este teléfono.</p>
        <form class="ask" id="ytForm"><input type="text" id="ytKey" value="${esc(ytKey())}" placeholder="Pega aquí tu clave" autocomplete="off" spellcheck="false" aria-label="Clave de YouTube"><button type="submit" class="btn">Guardar</button></form></section>
      <section class="panel"><h2>Instalar en el celular</h2>${installCard(true)}</section>
      <section class="panel"><h2>Diagnóstico de instalación</h2>
        <p class="muted small">Si no logras instalar Onda, toca «Revisar» y envía una captura de este recuadro.</p>
        <div class="btns"><button type="button" class="btn" data-act="diag">Revisar</button><button type="button" class="btn" data-act="diagcopy">Copiar informe</button></div>
        <ul class="diag" id="diagOut"></ul></section>
      <section class="panel danger"><h2>Borrar</h2><p class="muted small">Elimina todas las canciones y listas guardadas en la app. Los archivos originales de tu teléfono no se tocan.</p>
        <button type="button" class="btn btn-bad" data-act="wipe">${icon('trash')}Borrar toda la biblioteca</button></section>
      <p class="muted small center">Onda · versión ${APP_VERSION}</p>
      <p class="muted small center">Tu música guardada funciona sin internet y no se envía a ningún sitio. Solo la pestaña Buscar se conecta a los servicios que elijas, con lo que escribas.</p>`;
  }
  const notFound = (msg) => `<p class="muted center">${esc(msg)}</p><button type="button" class="btn btn-wide" data-go="#/inicio">Ir al inicio</button>`;

  function render(keepScroll) {
    route = parseRoute();
    const y = window.scrollY;
    ctxs = {};
    const r = { inicio: vInicio, biblioteca: vBiblioteca, artista: vArtista, album: vAlbum, listas: vListas, lista: vLista, buscar: vBuscar, ajustes: vAjustes }[route.name] || vInicio;
    view.innerHTML = r(route.arg);
    const tab = { artista: 'biblioteca', album: 'biblioteca', lista: 'listas', ajustes: '' }[route.name] ?? route.name;
    document.querySelectorAll('.tabs a').forEach((a) => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (keepScroll) window.scrollTo(0, y);
    afterRender();
  }
  function afterRender() {
    const q = $('q');
    if (q) {
      q.addEventListener('input', onSearchInput);
      $('qForm').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(searchT); q.blur(); if (!$('results').querySelector('.sec-web')) $('results').innerHTML = results(); searchWeb(true); });
      if (searchQ.trim().length >= 2) searchWeb();
    }
    const lq = $('libQ');
    if (lq) lq.addEventListener('input', () => { libQ = lq.value; ctxs = {}; $('libList').innerHTML = libList(libSub); bindSort(); });
    bindSort();
    view.querySelectorAll('[data-src]').forEach((c) => { c.onchange = () => { const o = load('sources') || {}; o[c.dataset.src] = c.checked; save('sources', o); web.q = ''; }; });
    const lw = $('lyrWeb'); if (lw) lw.onchange = () => save('lyricsWeb', lw.checked);
    const yf = $('ytForm');
    if (yf) yf.onsubmit = (e) => { e.preventDefault(); save('ytKey', $('ytKey').value.trim()); web.q = ''; toast($('ytKey').value.trim() ? 'Clave de YouTube guardada' : 'Clave de YouTube borrada', 1800); };
    const quota = $('quota');
    if (quota && navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then((e) => { if (e.quota) quota.textContent = `Espacio usado por la app: ${fmtBytes(e.usage || 0)} de ${fmtBytes(e.quota)} disponibles.`; });
    const ib = $('installBtn');
    if (ib) ib.onclick = async () => {
      const e = installEvent; installEvent = null; diag.prompted = 'sí';
      try { await e.prompt(); const c = await e.userChoice; diag.choice = c && c.outcome === 'accepted' ? 'aceptó' : 'canceló'; }
      catch (err) { diag.choice = 'error: ' + (err && err.message || err); toast('Chrome no pudo abrir la instalación: usa el menú ⋮ → «Instalar app».', 5000); }
      render(true);
    };
  }
  function azJump(L) {
    const heads = [...view.querySelectorAll('.az-h')];
    if (!heads.length) return;
    const order = AZ.indexOf(L);
    // la letra pedida, o la siguiente que exista (o la última)
    const el = heads.find((h) => AZ.indexOf(h.dataset.az) >= order) || heads[heads.length - 1];
    // Los encabezados quedan fijos arriba al bajar, así que se mide la primera canción de la letra.
    const bar = document.querySelector('.bar').getBoundingClientRect().height;
    const first = el.nextElementSibling || el;
    window.scrollTo({ top: first.getBoundingClientRect().top + window.scrollY - bar - el.offsetHeight - 2 });
  }
  function bindAz() {
    const rail = $('azRail'); if (!rail) return;
    const bubble = $('azBubble');
    const pick = (y) => {
      const r = rail.getBoundingClientRect();
      const i = Math.max(0, Math.min(AZ.length - 1, Math.floor(((y - r.top) / r.height) * AZ.length)));
      const L = AZ[i];
      if (bubble.textContent !== L) { bubble.textContent = L; azJump(L); if (navigator.vibrate) try { navigator.vibrate(5); } catch (e) { /* nada */ } }
    };
    rail.addEventListener('pointerdown', (e) => {
      e.preventDefault(); rail.setPointerCapture(e.pointerId); rail.classList.add('active');
      bubble.textContent = ''; bubble.hidden = false; pick(e.clientY);
    });
    rail.addEventListener('pointermove', (e) => { if (rail.hasPointerCapture(e.pointerId)) pick(e.clientY); });
    const end = (e) => { if (rail.hasPointerCapture && rail.hasPointerCapture(e.pointerId)) rail.releasePointerCapture(e.pointerId); rail.classList.remove('active'); setTimeout(() => { bubble.hidden = true; }, 250); };
    rail.addEventListener('pointerup', end); rail.addEventListener('pointercancel', end);
    rail.addEventListener('click', (e) => e.preventDefault());
  }
  function bindSort() {
    bindAz(); const s = $('sortSel'); if (s) s.onchange = () => { save('sort', s.value); render(true); }; }
  // Refrescar solo el resaltado de la canción en curso, sin redibujar la vista.
  function markCurrent() {
    const id = P.currentId();
    document.querySelectorAll('#view .row[data-id], #sheetBody .row[data-id]').forEach((li) => {
      const on = li.dataset.id === id;
      if (on === li.classList.contains('is-cur')) return;
      li.classList.toggle('is-cur', on);
      const num = li.querySelector('.row-num'); const main = li.querySelector('.row-main');
      if (num) num.innerHTML = on ? '<span class="eqbars"><i></i><i></i><i></i></span>' : (get(li.dataset.id)?.trackNo || (+main.dataset.i + 1));
      else { const bars = main.querySelector('.eqbars'); if (on && !bars) main.insertAdjacentHTML('beforeend', '<span class="eqbars"><i></i><i></i><i></i></span>'); if (!on && bars) bars.remove(); }
    });
  }

  /* ---------- Almacenamiento de preferencias ---------- */
  const PREF = 'onda-prefs';
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(PREF) || '{}') || {}; } catch (e) { prefs = {}; }
  const load = (k) => prefs[k];
  const save = (k, v) => { prefs[k] = v; try { localStorage.setItem(PREF, JSON.stringify(prefs)); } catch (e) { /* sin almacenamiento */ } };
  function applyTheme() {
    const t = load('theme') || 'auto';
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]').content = dark ? '#0f0e13' : '#f6f4f0';
  }
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  /* ---------- Capas: reproductor y hoja inferior (el botón Atrás de Android las cierra) ---------- */
  const layers = [];
  let afterPop = null;
  function pushLayer(name) { layers.push(name); history.pushState({ layer: name }, ''); }
  function closeLayer(then) { if (!layers.length) { if (then) then(); return; } afterPop = then || null; history.back(); }
  window.addEventListener('popstate', () => {
    const top = layers.pop();
    if (top === 'sheet') hideSheet(); else if (top === 'np') hideNP();
    if (afterPop) { const f = afterPop; afterPop = null; if (layers.length) closeLayer(f); else f(); }
  });
  const closeAll = (then) => closeLayer(then);

  /* ---------- Hoja inferior ---------- */
  let sheetReturn = null, sheetOnClose = null;
  function openSheet(title, html, onOpen) {
    const wrap = $('sheetWrap');
    const already = !wrap.hidden;
    $('sheetTitle').textContent = title; $('sheetBody').innerHTML = html;
    if (!already) { sheetReturn = document.activeElement; wrap.hidden = false; requestAnimationFrame(() => wrap.classList.add('open')); pushLayer('sheet'); }
    sheetOnClose = null;
    if (onOpen) onOpen($('sheetBody'));
    const f = $('sheetBody').querySelector('input:not([type=range]), button, [href]'); if (f) setTimeout(() => f.focus({ preventScroll: true }), 30);
  }
  function hideSheet() {
    const wrap = $('sheetWrap'); wrap.classList.remove('open');
    if (sheetOnClose) { sheetOnClose(); sheetOnClose = null; }
    setTimeout(() => { if (!wrap.classList.contains('open')) { wrap.hidden = true; $('sheetBody').innerHTML = ''; } }, 220);
    if (sheetReturn && document.contains(sheetReturn)) sheetReturn.focus({ preventScroll: true });
  }
  const closeSheet = (then) => { if (layers[layers.length - 1] === 'sheet') closeLayer(then); else if (then) then(); };
  $('scrim').addEventListener('click', () => closeSheet());
  $('sheetClose').addEventListener('click', () => closeSheet());

  function menu(items) {
    return `<div class="menu">${items.filter(Boolean).map((it) => `<button type="button" class="menu-it${it.danger ? ' bad' : ''}" data-m="${it.id}">${icon(it.icon)}<span>${esc(it.label)}</span></button>`).join('')}</div>`;
  }
  function onMenu(handlers) { return (body) => body.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b && handlers[b.dataset.m]) handlers[b.dataset.m](); }); }

  function askText(title, value, okLabel) {
    return new Promise((resolve) => {
      let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
      openSheet(title, `<form class="ask" id="askForm"><input type="text" id="askIn" maxlength="80" value="${esc(value || '')}" aria-label="${esc(title)}" required><button type="submit" class="btn btn-go">${esc(okLabel)}</button></form>`, (body) => {
        sheetOnClose = () => fin(null);
        body.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); const v = $('askIn').value.trim(); if (!v) return; fin(v); closeSheet(); });
        setTimeout(() => { const i = $('askIn'); if (i) { i.focus(); i.select(); } }, 60);
      });
    });
  }
  function askConfirm(title, msg, okLabel) {
    return new Promise((resolve) => {
      let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
      openSheet(title, `<p>${esc(msg)}</p><div class="btns"><button type="button" class="btn btn-bad" data-ok>${esc(okLabel)}</button><button type="button" class="btn" data-no>Cancelar</button></div>`, (body) => {
        sheetOnClose = () => fin(false);
        body.querySelector('[data-ok]').onclick = () => { fin(true); closeSheet(); };
        body.querySelector('[data-no]').onclick = () => { fin(false); closeSheet(); };
      });
    });
  }

  /* ---------- Acciones sobre canciones y listas ---------- */
  async function toggleFav(id) {
    const t = get(id); if (!t || t.remote) return;
    t.fav = !t.fav; t.favAt = t.fav ? Date.now() : 0;
    await DB.putTrack(t);
    toast(t.fav ? 'Añadida a Me gusta' : 'Quitada de Me gusta', 1500);
    paintPlayer();
    if (route.name === 'lista' && route.arg === 'favoritas') render(true); else refreshRow(id);
  }
  function refreshRow(id) {
    const t = get(id);
    view.querySelectorAll(`.row[data-id="${id}"] .row-txt > span`).forEach((s) => {
      const h = s.querySelector('.tiny-heart');
      if (t.fav && !h) s.insertAdjacentHTML('afterbegin', '<svg class="tiny-heart" aria-label="Me gusta"><use href="#i-heart-on"/></svg>');
      if (!t.fav && h) h.remove();
    });
  }

  function remoteMenu(t) {
    const id = t.id;
    openSheet(t.title, `<div class="sheet-track">${coverHTML(t, 'cover-sm')}<span class="row-txt"><strong>${esc(t.title)}</strong><span>${esc(t.artist)} · ${esc(SRC[t.source] || '')}${t.preview ? ' · avance de 30 s' : ''}</span></span></div>` + menu([
      { id: 'next', icon: 'next', label: 'Reproducir a continuación' },
      { id: 'queue', icon: 'queue', label: 'Añadir a la cola' },
      t.saveable && { id: 'save', icon: 'plus', label: 'Guardar sin conexión en mi biblioteca' },
      { id: 'more', icon: 'search', label: 'Buscar más de ' + t.artist },
      { id: 'open', icon: 'note', label: 'Abrir en ' + (SRC[t.source] || 'su web') + (t.preview ? ' (canción completa)' : '') }
    ]), onMenu({
      next: () => { P.playNext(id); toast('Sonará a continuación', 1500); closeSheet(); },
      queue: () => { P.enqueue(id); toast('Añadida a la cola', 1500); closeSheet(); },
      save: async () => { closeSheet(); toast('Guardando…', 60000); try { toast(await saveOffline(t) ? 'Guardada en tu biblioteca' : 'Ya estaba en tu biblioteca', 2000); } catch (e) { toast('No se pudo descargar (' + e.message + ')', 3000); } },
      more: () => closeAll(() => { searchQ = t.artist; if (route.name === 'buscar') render(); else location.hash = '#/buscar'; }),
      open: () => { window.open(t.link, '_blank', 'noopener'); closeSheet(); }
    }));
  }
  function trackMenu(id, playlistId, idx) {
    const t = get(id); if (!t) return;
    if (t.remote) return remoteMenu(t);
    const go = (hash) => closeAll(() => { location.hash = hash; });
    openSheet(t.title, `<div class="sheet-track">${coverHTML(t, 'cover-sm')}<span class="row-txt"><strong>${esc(t.title)}</strong><span>${esc(t.artist)} · ${esc(t.album)}</span></span></div>` + menu([
      { id: 'next', icon: 'next', label: 'Reproducir a continuación' },
      { id: 'queue', icon: 'queue', label: 'Añadir a la cola' },
      { id: 'list', icon: 'lists', label: 'Añadir a una lista' },
      { id: 'fav', icon: t.fav ? 'heart-on' : 'heart', label: t.fav ? 'Quitar de Me gusta' : 'Me gusta' },
      playlistId && { id: 'unlist', icon: 'x', label: 'Quitar de esta lista' },
      { id: 'artist', icon: 'person', label: 'Ir al artista' },
      t.album !== 'Sin álbum' && { id: 'album', icon: 'disc', label: 'Ir al álbum' },
      { id: 'edit', icon: 'edit', label: 'Editar datos' },
      { id: 'del', icon: 'trash', label: 'Eliminar de la app', danger: true }
    ]), onMenu({
      next: () => { P.playNext(id); toast('Sonará a continuación', 1500); closeSheet(); },
      queue: () => { P.enqueue(id); toast('Añadida a la cola', 1500); closeSheet(); },
      list: () => addToListMenu(id),
      fav: () => { toggleFav(id); closeSheet(); },
      unlist: async () => {
        const p = lib.playlists.find((x) => x.id === playlistId); if (!p) return;
        const at = p.ids[idx] === id ? idx : p.ids.indexOf(id); if (at >= 0) p.ids.splice(at, 1); await DB.putPlaylist(p); closeSheet(); toast('Quitada de la lista', 1500); render(true);
      },
      artist: () => go('#/artista/' + encodeURIComponent(t.artist)),
      album: () => go('#/album/' + encodeURIComponent(albumKey(t))),
      edit: () => editTrack(id),
      del: async () => {
        if (!(await askConfirm('¿Eliminar esta canción?', `«${t.title}» se borrará de la app y de todas tus listas. El archivo original de tu teléfono no se toca.`, 'Eliminar'))) return;
        await removeTrack(id); toast('Canción eliminada', 1500); render(true);
      }
    }));
  }

  function editTrack(id) {
    const t = get(id);
    const field = (k, l) => `<label class="field"><span>${l}</span><input type="text" name="${k}" value="${esc(t[k])}" maxlength="120" required></label>`;
    openSheet('Editar datos', `<form class="ask ask-col" id="editForm">${field('title', 'Título')}${field('artist', 'Artista')}${field('album', 'Álbum')}<button type="submit" class="btn btn-go">Guardar</button></form>`, (body) => {
      body.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault(); const fd = new FormData(e.target);
        for (const k of ['title', 'artist', 'album']) { const v = String(fd.get(k) || '').trim(); if (v) t[k] = v; }
        await DB.putTrack(t); artCache.clear(); P.refreshSession(); paintPlayer(); closeSheet(); toast('Datos guardados', 1500); render(true);
      });
    });
  }

  async function removeTrack(id) {
    P.forget(id);
    await DB.deleteTrack(id);
    lib.tracks.delete(id);
    if (coverUrls.has(id)) { URL.revokeObjectURL(coverUrls.get(id)); coverUrls.delete(id); }
    for (const p of lib.playlists) if (p.ids.includes(id)) { p.ids = p.ids.filter((x) => x !== id); await DB.putPlaylist(p); }
  }

  function addToListMenu(id) {
    const items = lib.playlists.slice().sort((a, b) => coll.compare(a.name, b.name));
    openSheet('Añadir a una lista', `<div class="menu"><button type="button" class="menu-it" data-new>${icon('plus')}<span>Nueva lista…</span></button>
      ${items.map((p) => `<button type="button" class="menu-it" data-pid="${p.id}">${listCover(p, 'cover-xs')}<span>${esc(p.name)}<small>${p.ids.includes(id) ? 'Ya está en esta lista' : plural(p.ids.length, 'canción', 'canciones')}</small></span></button>`).join('')}</div>`, (body) => {
      body.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.hasAttribute('data-new')) {
          const name = await askText('Nueva lista', '', 'Crear'); if (!name) return;
          const p = { id: uid(), name, ids: [id], created: Date.now() };
          lib.playlists.push(p); await DB.putPlaylist(p); toast(`Añadida a «${name}»`, 1800); render(true); return;
        }
        const p = lib.playlists.find((x) => x.id === b.dataset.pid); if (!p) return;
        if (p.ids.includes(id)) { toast('Ya estaba en esa lista', 1500); return; }
        p.ids.push(id); await DB.putPlaylist(p); closeSheet(); toast(`Añadida a «${p.name}»`, 1800); render(true);
      });
    });
  }

  async function newList() {
    const name = await askText('Nueva lista', '', 'Crear'); if (!name) return;
    const p = { id: uid(), name, ids: [], created: Date.now() };
    lib.playlists.push(p); await DB.putPlaylist(p); location.hash = '#/lista/' + p.id;
  }
  function listMenu(pid) {
    const p = lib.playlists.find((x) => x.id === pid); if (!p) return;
    openSheet(p.name, menu([
      p.ids.length && { id: 'queue', icon: 'queue', label: 'Añadir todo a la cola' },
      { id: 'ren', icon: 'edit', label: 'Cambiar nombre' },
      { id: 'del', icon: 'trash', label: 'Eliminar lista', danger: true }
    ]), onMenu({
      queue: () => { p.ids.filter(get).forEach((x) => P.enqueue(x)); toast('Añadidas a la cola', 1500); closeSheet(); },
      ren: async () => { const n = await askText('Cambiar nombre', p.name, 'Guardar'); if (!n) return; p.name = n; await DB.putPlaylist(p); render(true); },
      del: async () => {
        if (!(await askConfirm('¿Eliminar la lista?', `Se borrará «${p.name}». Las canciones siguen en tu biblioteca.`, 'Eliminar'))) return;
        lib.playlists = lib.playlists.filter((x) => x !== p); await DB.deletePlaylist(p.id); toast('Lista eliminada', 1500); location.hash = '#/listas';
      }
    }));
  }

  async function wipe() {
    if (!(await askConfirm('¿Borrar toda la biblioteca?', 'Se eliminarán todas las canciones y listas guardadas en la app. No se puede deshacer.', 'Borrar todo'))) return;
    P.stopAll(); await DB.clearAll(); lib.tracks.clear(); lib.playlists = [];
    coverUrls.forEach((u) => URL.revokeObjectURL(u)); coverUrls.clear();
    toast('Biblioteca borrada'); location.hash = '#/inicio'; render();
  }

  /* ---------- Delegación de toques en las vistas ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-ctx],[data-more],[data-playall],[data-shuffleall],[data-act],[data-go],[data-listmore],[data-theme-set],[data-retry],[data-iaalbum],[data-ytvideo],[data-iasave]');
    if (!t || t.closest('#sheetBody .menu')) return;
    const d = t.dataset;
    if (d.retry) retrySrc(d.retry);
    else if (d.iaalbum) iaAlbum(d.iaalbum);
    else if (d.ytvideo) ytVideo(d.ytvideo);
    else if (d.iasave) { const b = $('iaBody'); if (b && b.dataset.ids) saveMany(JSON.parse(b.dataset.ids)); }
    else if (d.ctx) playCtx(d.ctx, +d.i);
    else if (d.more) trackMenu(d.more, d.pl, +d.pi);
    else if (d.playall) playCtx(d.playall, null, false);
    else if (d.shuffleall) playCtx(d.shuffleall, null, true);
    else if (d.listmore) listMenu(d.listmore);
    else if (d.go) location.hash = d.go;
    else if (d.themeSet) { save('theme', d.themeSet); applyTheme(); render(true); }
    else if (d.act) ({ pick: pickFiles, demos: () => addDemos(t), newlist: newList, wipe, eq: eqSheet, timer: timerSheet, hideinstall: () => { save('noInstall', true); render(true); }, copylink: copyLink, diag: runDiag, diagcopy: copyDiag })[d.act]?.();
  });
  $('backBtn').addEventListener('click', () => { if (history.length > 1 && sessionHistory > 0) history.back(); else location.hash = '#/inicio'; });
  let sessionHistory = 0;
  window.addEventListener('hashchange', () => { sessionHistory++; render(); window.scrollTo(0, 0); view.focus({ preventScroll: true }); });

  // Arrastrar archivos sobre la ventana (en tablet u ordenador).
  window.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) { e.preventDefault(); importFiles(e.dataTransfer.files); } });

  /* ---------- Reproductor (mini y pantalla completa) ---------- */
  const np = $('np');
  function openNP() {
    if (!P.current()) return;
    np.hidden = false; requestAnimationFrame(() => np.classList.add('open'));
    $('npHint').hidden = (load('lyrHint') || 0) >= 3;
    document.body.classList.add('np-on');
    pushLayer('np'); paintPlayer(); paintTime(); startViz();
    setTimeout(() => $('btnPlay').focus({ preventScroll: true }), 50);
  }
  function hideNP() {
    np.classList.remove('open'); document.body.classList.remove('np-on'); stopViz(); closeLyrics(true);
    np.style.transform = '';
    setTimeout(() => { if (!np.classList.contains('open')) np.hidden = true; }, 260);
    $('miniOpen').focus({ preventScroll: true });
  }
  $('miniOpen').addEventListener('click', openNP);
  $('npClose').addEventListener('click', () => closeLayer());
  $('miniPlay').addEventListener('click', () => P.toggle());
  $('btnPlay').addEventListener('click', () => P.toggle());
  $('miniNext').addEventListener('click', () => P.next());
  $('btnNext').addEventListener('click', () => P.next());
  $('btnPrev').addEventListener('click', () => P.prev());
  $('btnShuffle').addEventListener('click', () => { P.setShuffle(!P.S.shuffle); toast(P.S.shuffle ? 'Aleatorio activado' : 'Aleatorio desactivado', 1200); });
  $('btnRepeat').addEventListener('click', () => { P.cycleRepeat(); toast({ off: 'Sin repetir', all: 'Repetir todo', one: 'Repetir esta canción' }[P.S.repeat], 1200); });
  $('miniFav').addEventListener('click', () => { const t = P.current(); if (t) toggleFav(t.id); });
  $('npFav').addEventListener('click', () => { const t = P.current(); if (t) toggleFav(t.id); });
  $('npArtist').addEventListener('click', () => { const t = P.current(); if (t) closeAll(() => { if (t.remote) { searchQ = t.artist; if (route.name === 'buscar') render(); else location.hash = '#/buscar'; } else location.hash = '#/artista/' + encodeURIComponent(t.artist); }); });
  $('npMore').addEventListener('click', () => { const t = P.current(); if (t) trackMenu(t.id); });
  $('btnQueue').addEventListener('click', queueSheet);
  $('btnEq').addEventListener('click', eqSheet);
  $('btnTimer').addEventListener('click', timerSheet);

  // Deslizar hacia abajo para cerrar; a los lados sobre la portada para cambiar de canción.
  (function swipe() {
    let x0 = 0, y0 = 0, dy = 0, dx = 0, active = false, onArt = false;
    np.addEventListener('touchstart', (e) => {
      if (e.target.closest('input, .np-ctrl, .np-tools, .lyr-scroll')) return;
      const p = e.touches[0]; x0 = p.clientX; y0 = p.clientY; dx = dy = 0; active = true; onArt = !!e.target.closest('.np-art');
    }, { passive: true });
    np.addEventListener('touchmove', (e) => {
      if (!active) return; const p = e.touches[0]; dx = p.clientX - x0; dy = p.clientY - y0;
      if (dy > 0 && Math.abs(dy) > Math.abs(dx)) { np.style.transition = 'none'; np.style.transform = `translateY(${dy}px)`; }
    }, { passive: true });
    np.addEventListener('touchend', () => {
      if (!active) return; active = false; np.style.transition = '';
      if (dy > 110 && Math.abs(dy) > Math.abs(dx)) closeLayer();
      else {
        np.style.transform = '';
        if (onArt && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? P.next() : P.prev());
        else if (onArt && dy < -60 && Math.abs(dy) > Math.abs(dx) * 1.2) openLyrics();
      }
    });
  })();

  const seek = $('seek'); let seeking = false;
  seek.addEventListener('input', () => { seeking = true; const d = P.audio.duration; $('tCur').textContent = fmtTime((seek.value / 1000) * d); paintSeekFill(); });
  seek.addEventListener('change', () => { P.seek(seek.value / 1000); seeking = false; });
  const paintSeekFill = () => seek.style.setProperty('--p', (seek.value / 10) + '%');

  function paintTime() {
    const a = P.audio; const d = isFinite(a.duration) ? a.duration : (P.current()?.duration || 0);
    const frac = d ? a.currentTime / d : 0;
    $('miniProg').style.width = (frac * 100).toFixed(2) + '%';
    if (np.hidden) return;
    if (!seeking) { seek.value = Math.round(frac * 1000); $('tCur').textContent = fmtTime(a.currentTime); paintSeekFill(); }
    $('tDur').textContent = fmtTime(d);
  }

  let paintedId = null;
  function paintPlayer() {
    const t = P.current(); const S = P.S;
    $('mini').hidden = !t; document.body.classList.toggle('has-mini', !!t); document.body.classList.toggle('is-playing', !!(t && S.playing));
    if (!t) { if (!np.hidden) closeLayer(); return; }
    const playIcon = (b, playing) => { b.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play'); b.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir'); };
    playIcon($('miniPlay'), S.playing); playIcon($('btnPlay'), S.playing);
    for (const b of [$('miniFav'), $('npFav')]) { b.hidden = !!t.remote; b.querySelector('use').setAttribute('href', t.fav ? '#i-heart-on' : '#i-heart'); b.classList.toggle('on', !!t.fav); b.setAttribute('aria-label', t.fav ? 'Quitar de Me gusta' : 'Me gusta'); b.setAttribute('aria-pressed', !!t.fav); }
    $('miniTitle').textContent = t.title; $('miniArtist').textContent = t.artist;
    $('npTitle').textContent = t.title; $('npArtist').textContent = t.artist + (t.remote ? ' · ' + SRC[t.source] + (t.preview ? ' (avance)' : '') : ''); $('npFrom').textContent = S.from || 'Tu biblioteca';
    if (paintedId !== t.id || !$('npCover').firstChild) {
      paintedId = t.id;
      $('miniCover').outerHTML = coverHTML(t, 'cover-sm').replace('<span class="cover', '<span id="miniCover" class="cover');
      $('npCover').outerHTML = coverHTML(t, 'cover-xl').replace('<span class="cover', '<span id="npCover" class="cover');
      const u = coverUrl(t); const h = hue(t.album + t.artist);
      $('npBg').style.cssText = u ? `background-image:url("${u}")` : `background:linear-gradient(160deg,hsl(${h} 60% 40%),hsl(${(h + 50) % 360} 50% 14%))`;
    }
    $('npCover').classList.toggle('paused', !S.playing);
    $('btnShuffle').classList.toggle('on', S.shuffle); $('btnShuffle').setAttribute('aria-pressed', S.shuffle);
    const rb = $('btnRepeat'); rb.classList.toggle('on', S.repeat !== 'off');
    rb.querySelector('use').setAttribute('href', S.repeat === 'one' ? '#i-repeat1' : '#i-repeat');
    rb.setAttribute('aria-label', { off: 'Repetir: no', all: 'Repetir: todo', one: 'Repetir: esta canción' }[S.repeat]);
    paintTimerLbl();
    $('btnEq').classList.toggle('on', P.EQ.on);
  }

  let lastCounted = null;
  P.ev.addEventListener('change', () => {
    paintPlayer(); paintTime(); markCurrent();
    const id = P.currentId();
    if (P.S.playing && id && id !== lastCounted) {
      lastCounted = id; const t = get(id);
      if (t && !t.remote) { t.plays = (t.plays || 0) + 1; t.lastPlayed = Date.now(); DB.putTrack(t).catch(() => {}); }
    }
    if ($('queueList')) paintQueue();
    saveRemote();
  });
  P.ev.addEventListener('ended', () => { lastCounted = null; });
  P.ev.addEventListener('time', () => { paintTime(); syncLyrics(); });
  P.ev.addEventListener('change', () => { if (lyrOn && P.currentId() !== lyrFor) loadLyrics(); });
  P.ev.addEventListener('missing', () => toast('No se encontró el audio de esta canción'));
  P.ev.addEventListener('error', () => {
    const t = P.current();
    if (t && t.remote) toast(P.EQ.ctx ? `No se pudo reproducir desde ${SRC[t.source]}. Con el ecualizador activo algunas fuentes no suenan: desactívalo y recarga la app.` : `No se pudo reproducir desde ${SRC[t.source]}: puede que ya no esté disponible.`, 4500);
    else toast('Este teléfono no puede reproducir este formato', 3000);
  });
  P.ev.addEventListener('slept', () => toast('Temporizador: música en pausa. ¡Que descanses!', 3200));

  /* ---------- Cola ---------- */
  function queueSheet() {
    openSheet('Cola de reproducción', '<div id="queueList"></div>', () => paintQueue());
  }
  function paintQueue() {
    const el = $('queueList'); if (!el) return;
    const S = P.S; const c = P.current();
    if (!c) { el.innerHTML = '<p class="muted">No hay nada sonando.</p>'; return; }
    const next = S.queue.slice(S.pos + 1).map((id, k) => ({ t: get(id), i: S.pos + 1 + k })).filter((x) => x.t);
    el.innerHTML = `<p class="eyebrow">Sonando ahora</p>
      <div class="sheet-track is-cur">${coverHTML(c, 'cover-sm')}<span class="row-txt"><strong>${esc(c.title)}</strong><span>${esc(c.artist)}</span></span><span class="eqbars${S.playing ? '' : ' still'}"><i></i><i></i><i></i></span></div>
      <p class="eyebrow">A continuación${S.from ? ' · ' + esc(S.from) : ''}${S.shuffle ? ' · aleatorio' : ''}</p>
      ${next.length ? `<ul class="rows qrows">${next.map(({ t, i }, k) => `<li class="row"><button type="button" class="row-main" data-qjump="${i}">${coverHTML(t, 'cover-xs')}<span class="row-txt"><strong>${esc(t.title)}</strong><span>${esc(t.artist)}</span></span></button>
        <button type="button" class="icon-btn sm" data-qup="${i}" aria-label="Subir" ${k === 0 ? 'disabled' : ''}>${icon('up')}</button>
        <button type="button" class="icon-btn sm" data-qdown="${i}" aria-label="Bajar" ${k === next.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
        <button type="button" class="icon-btn sm" data-qdel="${i}" aria-label="Quitar de la cola">${icon('x')}</button></li>`).join('')}</ul>`
        : `<p class="muted">${S.repeat === 'all' ? 'Se repetirá desde el principio.' : 'No hay más canciones en la cola.'}</p>`}`;
    el.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.qjump) P.jump(+b.dataset.qjump);
      else if (b.dataset.qup) P.moveAt(+b.dataset.qup, -1);
      else if (b.dataset.qdown) P.moveAt(+b.dataset.qdown, 1);
      else if (b.dataset.qdel) P.removeAt(+b.dataset.qdel);
    };
  }

  /* ---------- Temporizador ---------- */
  function timerSheet() {
    const S = P.S;
    const opts = [[15, '15 minutos'], [30, '30 minutos'], [45, '45 minutos'], [60, '1 hora'], ['end', 'Al terminar esta canción']];
    const active = S.sleepAt || S.sleepEnd;
    openSheet('Temporizador para dormir', `<p class="muted small">La música se pausará sola, bajando el volumen poco a poco.</p><div class="menu">
      ${opts.map(([v, l]) => `<button type="button" class="menu-it" data-sleep="${v}">${icon('timer')}<span>${l}</span></button>`).join('')}
      ${active ? `<button type="button" class="menu-it bad" data-sleep="0">${icon('x')}<span>Apagar temporizador</span></button>` : ''}</div>`, (body) => {
      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-sleep]'); if (!b) return;
        const v = b.dataset.sleep === 'end' ? 'end' : +b.dataset.sleep;
        P.setSleep(v); closeSheet();
        toast(v === 0 ? 'Temporizador apagado' : v === 'end' ? 'Se pausará al terminar la canción' : `Se pausará en ${b.textContent.trim()}`, 1800);
      });
    });
  }
  function paintTimerLbl() {
    const S = P.S; const l = $('timerLbl'); $('btnTimer').classList.toggle('on', !!(S.sleepAt || S.sleepEnd));
    if (S.sleepEnd) l.textContent = 'Fin de canción';
    else if (S.sleepAt) l.textContent = fmtTime((S.sleepAt - Date.now()) / 1000);
    else l.textContent = 'Temporizador';
  }
  setInterval(() => { if (P.S.sleepAt && !np.hidden) paintTimerLbl(); }, 1000);

  /* ---------- Ecualizador ---------- */
  function eqSheet() {
    const EQ = P.EQ;
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const band = (f) => (f >= 1000 ? (f / 1000).toLocaleString('es') + ' kHz' : f + ' Hz');
    openSheet('Ecualizador', `
      <label class="switch"><input type="checkbox" id="eqOn" ${EQ.on ? 'checked' : ''}><span class="sw" aria-hidden="true"></span><span>Activar ecualizador</span></label>
      ${isIOS ? '<p class="muted small">En iPhone, con el ecualizador activo la música puede detenerse al bloquear la pantalla.</p>' : ''}
      <div class="chips" id="eqPresets">${Object.keys(P.PRESETS).map((k) => `<button type="button" class="chip${EQ.preset === k ? ' on' : ''}" data-preset="${k}">${k}</button>`).join('')}</div>
      <div class="eq" id="eqBands">${P.BANDS.map((f, i) => `<label class="eq-band"><span>${band(f)}</span><input type="range" min="-12" max="12" step="1" value="${EQ.gains[i]}" data-band="${i}" aria-label="Banda de ${band(f)}"><output>${EQ.gains[i] > 0 ? '+' : ''}${EQ.gains[i]} dB</output></label>`).join('')}</div>`, (body) => {
      const sync = () => {
        body.querySelector('#eqBands').classList.toggle('off', !EQ.on);
        body.querySelectorAll('[data-band]').forEach((r) => { const i = +r.dataset.band; r.value = EQ.gains[i]; r.nextElementSibling.textContent = `${EQ.gains[i] > 0 ? '+' : ''}${EQ.gains[i]} dB`; });
        body.querySelectorAll('[data-preset]').forEach((c) => c.classList.toggle('on', c.dataset.preset === EQ.preset));
        $('btnEq').classList.toggle('on', EQ.on);
      };
      sync();
      body.querySelector('#eqOn').addEventListener('change', (e) => { if (e.target.checked) { EQ.enable(); startViz(); } else EQ.disable(); sync(); });
      body.addEventListener('click', (e) => { const c = e.target.closest('[data-preset]'); if (!c) return; if (!EQ.on) { EQ.enable(); body.querySelector('#eqOn').checked = true; startViz(); } EQ.usePreset(c.dataset.preset); sync(); });
      body.addEventListener('input', (e) => { const r = e.target.closest('[data-band]'); if (!r) return; if (!EQ.on) { EQ.enable(); body.querySelector('#eqOn').checked = true; startViz(); } EQ.set(+r.dataset.band, +r.value); sync(); });
    });
  }

  /* ---------- Letras ---------- */
  const Lyr = window.OndaLyrics;
  const lyrCache = new Map();
  let lyrOn = false, lyrFor = null, lyrData = null, lyrActive = -1, lyrTouched = 0;
  const lyricsWeb = () => load('lyricsWeb') !== false;
  const lyrSc = $('lyrScroll');
  async function lyricsFor(t, force) {
    if (!force) {
      if (t.lyrics) return t.lyrics;
      if (lyrCache.has(t.id)) return lyrCache.get(t.id);
    }
    if (!lyricsWeb()) return { disabled: true };
    const r = await Lyr.find(t);
    lyrCache.set(t.id, r);
    if (!t.remote && !r.notFound) { t.lyrics = r; DB.putTrack(t).catch(() => {}); }
    return r;
  }
  function openLyrics() {
    if (!P.current() || lyrOn) return;
    lyrOn = true; np.classList.add('lyr'); $('npLyr').hidden = false;
    $('btnLyrics').classList.add('on'); $('btnLyrics').setAttribute('aria-pressed', 'true');
    save('lyrHint', (load('lyrHint') || 0) + 1); $('npHint').hidden = true;
    stopViz(); loadLyrics();
  }
  function closeLyrics(silent) {
    if (!lyrOn) return;
    lyrOn = false; np.classList.remove('lyr'); $('npLyr').hidden = true;
    $('btnLyrics').classList.remove('on'); $('btnLyrics').setAttribute('aria-pressed', 'false');
    if (!silent) startViz();
  }
  const lyrMsg = (txt, btns = '') => `<div class="lyr-msg"><p>${txt}</p><div class="btns">${btns}</div></div>`;
  const btnRetry = '<button type="button" class="btn btn-sm" data-lyr="retry">Buscar de nuevo</button>';
  const btnWrite = '<button type="button" class="btn btn-sm" data-lyr="edit">Escribir o pegar la letra</button>';
  async function loadLyrics(force) {
    const t = P.current(); if (!t) return;
    lyrFor = t.id; lyrActive = -1; lyrData = null;
    $('lyrCover').innerHTML = coverHTML(t, 'cover-xs');
    $('lyrSrc').innerHTML = `<strong>${esc(t.title)}</strong><span>${esc(t.artist)}</span>`;
    lyrSc.classList.remove('sync'); lyrSc.scrollTop = 0;
    lyrSc.innerHTML = lyrMsg('<span class="spin"></span>Buscando la letra…');
    let r;
    try { r = await lyricsFor(t, force); }
    catch (e) {
      if (lyrFor !== t.id) return;
      lyrSc.innerHTML = lyrMsg(navigator.onLine === false ? 'Sin conexión: la letra se buscará cuando tengas internet.' : `No se pudo buscar la letra (${esc(e.message)}).`, btnRetry + btnWrite);
      return;
    }
    if (lyrFor !== t.id) return;
    lyrData = r; renderLyrics();
  }
  function renderLyrics() {
    const r = lyrData; if (!r) return;
    lyrSc.classList.toggle('sync', !!r.synced);
    if (r.disabled) { lyrSc.innerHTML = lyrMsg('La búsqueda de letras en internet está desactivada en Ajustes.', btnWrite); return; }
    if (r.instrumental) { lyrSc.innerHTML = lyrMsg('Esta canción es instrumental: no tiene letra.', btnWrite); return; }
    if (r.notFound) { lyrSc.innerHTML = lyrMsg('No encontramos la letra de esta canción.', btnRetry + btnWrite); return; }
    const src = { LRCLIB: 'LRCLIB', archivo: 'guardada en el archivo', manual: 'escrita por ti' }[r.source] || r.source;
    const foot = `<p class="lyr-foot">Letra: ${esc(src)}${r.synced ? ' · sincronizada: toca una línea para ir a ese momento' : ''}</p>`;
    if (r.synced) lyrSc.innerHTML = r.synced.map((l, i) => `<p class="ln${l.text ? '' : ' gap'}" data-i="${i}">${l.text ? esc(l.text) : '♪'}</p>`).join('') + foot;
    else lyrSc.innerHTML = `<div class="lyr-plain">${esc(r.plain)}</div>` + foot;
    syncLyrics(true);
  }
  function syncLyrics(jump) {
    if (!lyrOn || !lyrData || !lyrData.synced) return;
    const lines = lyrData.synced, tm = P.audio.currentTime + 0.3;
    let i = -1; for (let k = 0; k < lines.length && lines[k].t <= tm; k++) i = k;
    if (i === lyrActive && !jump) return;
    lyrActive = i;
    const els = lyrSc.querySelectorAll('.ln');
    els.forEach((el, k) => { el.classList.toggle('on', k === i); el.classList.toggle('past', k < i); });
    const el = els[Math.max(i, 0)];
    if (el && Date.now() - lyrTouched > 3500) lyrSc.scrollTo({ top: el.offsetTop - lyrSc.clientHeight * 0.4, behavior: jump || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  ['touchstart', 'wheel', 'pointerdown'].forEach((ev) => lyrSc.addEventListener(ev, () => { lyrTouched = Date.now(); }, { passive: true }));
  lyrSc.addEventListener('click', (e) => {
    const ln = e.target.closest('.ln');
    if (ln && lyrData && lyrData.synced) { lyrTouched = 0; P.audio.currentTime = lyrData.synced[+ln.dataset.i].t; if (P.audio.paused) P.play(); syncLyrics(true); return; }
    const b = e.target.closest('[data-lyr]');
    if (b && b.dataset.lyr === 'retry') loadLyrics(true);
    if (b && b.dataset.lyr === 'edit') editLyrics();
  });
  function editLyrics() {
    const t = P.current(); if (!t) return;
    const cur = (lyrData && (lyrData.raw || lyrData.plain)) || '';
    openSheet('Letra de ' + t.title, `<form class="ask ask-col" id="lyrForm"><textarea id="lyrText" rows="10" placeholder="Pega aquí la letra. Si tiene tiempos como [01:23.45] se mostrará sincronizada." aria-label="Letra">${esc(cur)}</textarea><button type="submit" class="btn btn-go">Guardar letra</button></form>`, (body) => {
      body.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const r = Lyr.fromText($('lyrText').value);
        if (!t.remote) { t.lyrics = r; await DB.putTrack(t); }
        lyrCache.set(t.id, r || { notFound: true });
        closeSheet(); toast(r ? 'Letra guardada' : 'Letra borrada', 1500);
        if (lyrOn && lyrFor === t.id) { lyrData = r || { notFound: true }; renderLyrics(); }
      });
    });
  }
  $('lyrMore').addEventListener('click', () => {
    const t = P.current(); if (!t) return;
    openSheet('Letra', menu([
      lyricsWeb() && { id: 'retry', icon: 'search', label: 'Buscar de nuevo en internet' },
      { id: 'edit', icon: 'edit', label: lyrData && (lyrData.plain || lyrData.synced) ? 'Corregir la letra' : 'Escribir o pegar la letra' },
      !t.remote && t.lyrics && { id: 'del', icon: 'trash', label: 'Quitar la letra guardada', danger: true }
    ]), onMenu({
      retry: () => { closeSheet(); loadLyrics(true); },
      edit: () => editLyrics(),
      del: async () => { delete t.lyrics; await DB.putTrack(t); lyrCache.delete(t.id); closeSheet(); toast('Letra quitada', 1500); loadLyrics(); }
    }));
  });
  $('lyrClose').addEventListener('click', () => closeLyrics());
  $('btnLyrics').addEventListener('click', () => (lyrOn ? closeLyrics() : openLyrics()));
  $('npHint').addEventListener('click', openLyrics);

  /* ---------- Visualizador (solo con el ecualizador activo) ---------- */
  let vizRaf = 0;
  function startViz() {
    const cv = $('npViz'); const EQ = P.EQ;
    cancelAnimationFrame(vizRaf);
    if (np.hidden || !EQ.on || !EQ.analyser || matchMedia('(prefers-reduced-motion: reduce)').matches) { cv.classList.remove('on'); return; }
    cv.classList.add('on');
    const g = cv.getContext('2d'); const data = new Uint8Array(EQ.analyser.frequencyBinCount);
    const draw = () => {
      const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1;
      if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      EQ.analyser.getByteFrequencyData(data);
      g.clearRect(0, 0, cv.width, cv.height);
      const n = 40, bw = cv.width / n;
      g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#ff7a59';
      for (let i = 0; i < n; i++) {
        const v = data[Math.floor(Math.pow(i / n, 1.6) * data.length * 0.8)] / 255;
        const bh = Math.max(2 * dpr, v * cv.height);
        g.globalAlpha = 0.35 + v * 0.6;
        g.fillRect(i * bw + bw * 0.2, cv.height - bh, bw * 0.6, bh);
      }
      vizRaf = requestAnimationFrame(draw);
    };
    draw();
  }
  const stopViz = () => { cancelAnimationFrame(vizRaf); $('npViz').classList.remove('on'); };

  /* ---------- Teclado (tablet u ordenador) ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && layers.length) { closeLayer(); return; }
    if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ' && P.current()) { e.preventDefault(); P.toggle(); }
    else if (e.key === 'ArrowRight' && e.shiftKey) P.next();
    else if (e.key === 'ArrowLeft' && e.shiftKey) P.prev();
  });

  /* ---------- Instalar en el teléfono ---------- */
  let installEvent = null;
  // Dentro de la app Android (Capacitor) ya está instalada y trae sus archivos: sin aviso ni service worker.
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const isInstalled = () => isNative || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function installCard(inSettings) {
    if (isInstalled()) return inSettings ? '<p class="muted small">Onda ya está instalada en este dispositivo.</p>' : '';
    if (!inSettings && load('noInstall')) return '';
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    // Navegadores integrados en otras apps (Claude, WhatsApp, Instagram, Google…): no permiten instalar.
    const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|Telegram|Claude|GSA\/|; wv\)/i.test(ua) || (isIOS && !/Safari\//.test(ua));
    const later = inSettings ? '' : '<button type="button" class="btn btn-sm" data-act="hideinstall">Ahora no</button>';
    const copy = '<button type="button" class="btn btn-go btn-sm" data-act="copylink">Copiar enlace</button>';
    let msg, btns = later;
    if (installEvent) { msg = '<strong>Instala Onda</strong> para abrirla desde su ícono, como cualquier app.'; btns = '<button type="button" class="btn btn-go btn-sm" id="installBtn">Instalar</button>' + later; }
    else if (inApp) { msg = `<strong>Para instalar Onda, ábrela en ${isIOS ? 'Safari' : 'Chrome'}.</strong> Estás en el navegador interno de otra app, que no permite instalar: toca el menú (⋮ o ⋯) y elige «Abrir en ${isIOS ? 'Safari' : 'Chrome'}» o «Abrir en el navegador». También puedes copiar el enlace y pegarlo allí.`; btns = copy + later; }
    else if (isIOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) { msg = '<strong>Instala Onda en tu iPhone:</strong> toca Compartir (el cuadrado con la flecha) y luego «Añadir a pantalla de inicio». Si no aparece esa opción, abre este enlace en Safari.'; btns = copy + later; }
    else if (isIOS) msg = '<strong>Instala Onda en tu iPhone:</strong> toca Compartir (el cuadrado con la flecha, abajo) y luego «Añadir a pantalla de inicio».';
    else if (isAndroid) msg = '<strong>Instala Onda:</strong> toca el menú ⋮ de Chrome (arriba a la derecha) y elige «Instalar app» o «Añadir a pantalla de inicio».';
    else if (!inSettings) return '';
    else msg = 'Abre esta página en el navegador de tu celular (Chrome en Android, Safari en iPhone) para instalarla.';
    return `<div class="install"><p>${msg}</p>${btns ? `<div class="btns">${btns}</div>` : ''}</div>`;
  }
  async function copyLink() {
    const url = location.href.split('#')[0];
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado. Pégalo en tu navegador.'); }
    catch (e) { toast(url, 6000); }
  }
  // Datos para el diagnóstico de instalación (Ajustes).
  const diag = { bip: '', prompted: 'no', choice: '', installed: '', errors: [] };
  window.addEventListener('error', (e) => { diag.errors.push(String(e.message || e.error || e).slice(0, 160)); });
  window.addEventListener('unhandledrejection', (e) => { diag.errors.push('promesa: ' + String(e.reason && e.reason.message || e.reason).slice(0, 160)); });
  async function runDiag() {
    const out = $('diagOut'); if (!out) return;
    out.innerHTML = '<li>Revisando…</li>';
    const rows = [];
    const row = (ok, label, detail) => rows.push({ ok, label, detail });
    const uad = navigator.userAgentData;
    row(null, 'Versión de Onda', APP_VERSION);
    row(null, 'Navegador', (uad && uad.brands ? uad.brands.map((b) => b.brand + ' ' + b.version).filter((x) => !/Not/i.test(x)).join(', ') + ' · ' : '') + navigator.userAgent);
    row(isSecureContext, 'Conexión segura (https)', isSecureContext ? 'sí' : 'no');
    row(isInstalled() ? true : null, 'Abierta como app instalada', isInstalled() ? 'sí' : 'no (estás en el navegador)');
    if (!('serviceWorker' in navigator)) row(false, 'Service worker', 'este navegador no lo admite');
    else {
      let reg = null; try { reg = await navigator.serviceWorker.getRegistration(); } catch (e) { /* nada */ }
      row(!!reg, 'Service worker registrado', reg ? (reg.active ? 'activo' : reg.installing ? 'instalándose' : 'en espera') + ' · ámbito ' + reg.scope : 'no');
      row(!!navigator.serviceWorker.controller, 'La página está controlada por el service worker', navigator.serviceWorker.controller ? 'sí' : 'no (recarga la página una vez)');
    }
    const link = document.querySelector('link[rel="manifest"]');
    try {
      const r = await fetch(link.href, { cache: 'no-store' });
      const m = await r.json();
      row(r.ok, 'Archivo de instalación (manifest)', r.status + ' · ' + (r.headers.get('content-type') || '?') + ' · ' + m.short_name + ' · display ' + m.display);
      for (const ic of m.icons || []) {
        try {
          const ir = await fetch(new URL(ic.src, link.href), { cache: 'no-store' });
          const bmp = await createImageBitmap(await ir.blob());
          row(ir.ok && bmp.width + 'x' + bmp.height === ic.sizes, 'Ícono ' + ic.sizes + ' (' + ic.purpose + ')', ir.status + ' · ' + bmp.width + 'x' + bmp.height);
        } catch (e) { row(false, 'Ícono ' + ic.sizes, 'no se pudo cargar: ' + e.message); }
      }
    } catch (e) { row(false, 'Archivo de instalación (manifest)', 'no se pudo leer: ' + e.message); }
    row(diag.bip ? true : null, 'Chrome ofreció instalar (beforeinstallprompt)', diag.bip || 'no, todavía');
    row(null, 'Botón «Instalar» de la app', diag.prompted === 'sí' ? 'tocado · resultado: ' + (diag.choice || 'sin respuesta') : 'no tocado');
    row(diag.installed ? true : null, 'Chrome confirmó la instalación (appinstalled)', diag.installed || 'no');
    if (diag.errors.length) row(false, 'Errores de la página', diag.errors.slice(-5).join(' | '));
    diag.last = rows;
    out.innerHTML = rows.map((r) => `<li class="${r.ok === true ? 'ok' : r.ok === false ? 'bad' : ''}"><strong>${r.ok === true ? '✓' : r.ok === false ? '✗' : '•'} ${esc(r.label)}</strong><span>${esc(r.detail)}</span></li>`).join('');
  }
  async function copyDiag() {
    if (!diag.last) await runDiag();
    const txt = 'Diagnóstico Onda · ' + new Date().toISOString() + '\n' + location.href + '\n' + diag.last.map((r) => `${r.ok === true ? '✓' : r.ok === false ? '✗' : '•'} ${r.label}: ${r.detail}`).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Informe copiado. Pégalo en el chat.'); } catch (e) { toast('No se pudo copiar: haz una captura de pantalla.'); }
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; diag.bip = 'sí, ' + new Date().toLocaleTimeString('es'); if (route.name === 'inicio' || route.name === 'ajustes') render(true); });
  window.addEventListener('appinstalled', () => { installEvent = null; diag.installed = 'sí, ' + new Date().toLocaleTimeString('es'); toast('Onda se instaló. Búscala en tus apps (puede tardar unos segundos en aparecer).', 6000); render(true); });
  // Si llega una versión nueva de la app mientras está abierta, se recarga sola una vez.
  if (!isNative && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }
  if (!isNative && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }

  /* ---------- Arranque ---------- */
  (async function boot() {
    try {
      const [tracks, pls] = await Promise.all([DB.allTracks(), DB.allPlaylists()]);
      tracks.forEach((t) => lib.tracks.set(t.id, t)); lib.playlists = pls;
    } catch (e) {
      toast('No se pudo abrir el almacenamiento del navegador. ¿Está en modo privado?', 5000);
    }
    render();
    try { await P.init({ getTrack: get, artFor }); } catch (e) { /* estado anterior ilegible */ }
    lastCounted = P.currentId(); // no contar como escucha la canción restaurada
    paintPlayer(); paintTime();
  })();
})();
