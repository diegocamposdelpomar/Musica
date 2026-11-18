/* Búsqueda de música en internet, sin servidor propio ni cuentas.
   - Audius e Internet Archive: canciones completas y libres, se escuchan dentro de Onda.
   - Deezer e iTunes: catálogo comercial, solo avances de 30 segundos.
   - YouTube: resultados con la clave de API propia de la persona (opcional, en Ajustes).
   - Spotify, SoundCloud, YouTube Music…: se abre su app con la búsqueda (no permiten reproducir fuera). */
(function (root) {
  const APP = 'Onda';
  let jsonpN = 0;

  // JSONP: para servicios que no permiten fetch desde otra web (Deezer, iTunes, Archive).
  function jsonp(url, param = 'callback', ms = 12000) {
    return new Promise((resolve, reject) => {
      const name = '__onda_cb' + (++jsonpN) + '_' + Date.now();
      const s = document.createElement('script');
      const done = (fn, v) => { clearTimeout(t); delete root[name]; s.remove(); fn(v); };
      const t = setTimeout(() => done(reject, new Error('tiempo agotado')), ms);
      root[name] = (data) => done(resolve, data);
      s.onerror = () => done(reject, new Error('sin conexión con el servicio'));
      s.src = url + (url.includes('?') ? '&' : '?') + param + '=' + name;
      document.head.appendChild(s);
    });
  }
  async function getJSON(url, ms = 12000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error('el servicio respondió ' + r.status);
      return await r.json();
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'tiempo agotado' : e.message);
    } finally { clearTimeout(t); }
  }
  const enc = encodeURIComponent;

  /* ---------- Audius ---------- */
  let audiusHost = null;
  async function audiusBase() {
    if (audiusHost) return audiusHost;
    try { const r = await getJSON('https://api.audius.co', 6000); if (r && r.data && r.data.length) audiusHost = r.data[(Math.random() * r.data.length) | 0]; } catch (e) { /* uso la puerta general */ }
    if (!audiusHost) audiusHost = 'https://api.audius.co';
    return audiusHost;
  }
  const audius = {
    id: 'audius', name: 'Audius', note: 'Canciones completas de artistas independientes',
    async search(q) {
      const base = await audiusBase();
      const r = await getJSON(`${base}/v1/tracks/search?query=${enc(q)}&app_name=${APP}`);
      return (r.data || []).slice(0, 20).map((t) => ({
        id: 'au:' + t.id, source: 'audius', kind: 'track',
        title: t.title, artist: (t.user && t.user.name) || 'Audius', album: 'Audius',
        duration: t.duration || 0,
        coverUrl: t.artwork && (t.artwork['480x480'] || t.artwork['150x150']) || '',
        url: `${base}/v1/tracks/${t.id}/stream?app_name=${APP}`,
        link: t.permalink ? 'https://audius.co' + t.permalink : 'https://audius.co',
        preview: false
      }));
    }
  };

  /* ---------- Internet Archive ---------- */
  const archive = {
    id: 'archive', name: 'Internet Archive', note: 'Música libre y conciertos completos; se puede guardar',
    async search(q) {
      const query = `(${q}) AND mediatype:(audio) AND -collection:(podcasts OR radio OR audio_bookspoetry OR librivoxaudio)`;
      const url = `https://archive.org/advancedsearch.php?q=${enc(query)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&rows=15&sort[]=downloads+desc&output=json`;
      const r = await jsonp(url, 'callback');
      return ((r.response && r.response.docs) || []).map((d) => ({
        id: 'ia:' + d.identifier, source: 'archive', kind: 'album', identifier: d.identifier,
        title: [].concat(d.title || d.identifier)[0], artist: [].concat(d.creator || 'Internet Archive')[0],
        album: [].concat(d.title || '')[0], year: d.year || '',
        coverUrl: `https://archive.org/services/img/${enc(d.identifier)}`,
        link: `https://archive.org/details/${enc(d.identifier)}`
      }));
    },
    // Las canciones (archivos MP3) de un álbum o concierto.
    async tracks(item) {
      let m;
      try { m = await getJSON(`https://archive.org/metadata/${enc(item.identifier)}`); }
      catch (e) { m = await jsonp(`https://archive.org/metadata/${enc(item.identifier)}`, 'callback'); }
      const files = (m.files || []).filter((f) => /\.mp3$/i.test(f.name) && !/64kb|sample/i.test(f.name));
      const pick = files.filter((f) => f.source === 'original').length ? files.filter((f) => f.source === 'original') : files;
      const num = (f) => parseInt(String(f.track || '').split('/')[0], 10) || 999;
      const len = (l) => { if (!l) return 0; if (String(l).includes(':')) return String(l).split(':').reduce((a, b) => a * 60 + (+b || 0), 0); return +l || 0; };
      const meta = m.metadata || {};
      const artist = [].concat(meta.creator || item.artist)[0];
      const album = [].concat(meta.title || item.title)[0];
      return pick.sort((a, b) => num(a) - num(b) || a.name.localeCompare(b.name)).slice(0, 80).map((f) => ({
        id: 'ia:' + item.identifier + '/' + f.name, source: 'archive', kind: 'track',
        title: f.title || f.name.replace(/\.mp3$/i, '').replace(/^\d+[\s._-]*/, ''),
        artist, album, duration: len(f.length), trackNo: num(f) === 999 ? 0 : num(f),
        coverUrl: item.coverUrl, url: `https://archive.org/download/${enc(item.identifier)}/${f.name.split('/').map(enc).join('/')}`,
        link: item.link, preview: false, saveable: true, identifier: item.identifier
      }));
    }
  };

  /* ---------- Deezer (avances de 30 s) ---------- */
  const deezer = {
    id: 'deezer', name: 'Deezer', note: 'Avances de 30 segundos',
    async search(q) {
      const r = await jsonp(`https://api.deezer.com/search?q=${enc(q)}&limit=20&output=jsonp`, 'callback');
      return (r.data || []).filter((t) => t.preview).map((t) => ({
        id: 'dz:' + t.id, source: 'deezer', kind: 'track',
        title: t.title, artist: t.artist && t.artist.name || '', album: t.album && t.album.title || '',
        duration: 30, fullDuration: t.duration || 0,
        coverUrl: t.album && (t.album.cover_big || t.album.cover_medium) || '',
        url: t.preview, link: t.link || 'https://www.deezer.com', preview: true
      }));
    }
  };

  /* ---------- iTunes / Apple Music (avances de 30 s) ---------- */
  const itunes = {
    id: 'itunes', name: 'Apple Music', note: 'Avances de 30 segundos',
    async search(q) {
      const r = await jsonp(`https://itunes.apple.com/search?term=${enc(q)}&media=music&entity=song&limit=20&country=${(navigator.language || 'es-PE').split('-')[1] || 'US'}`, 'callback');
      return (r.results || []).filter((t) => t.previewUrl).map((t) => ({
        id: 'it:' + t.trackId, source: 'itunes', kind: 'track',
        title: t.trackName, artist: t.artistName, album: t.collectionName || '',
        duration: 30, fullDuration: (t.trackTimeMillis || 0) / 1000,
        coverUrl: (t.artworkUrl100 || '').replace('100x100', '512x512'),
        url: t.previewUrl, link: t.trackViewUrl || 'https://music.apple.com', preview: true
      }));
    }
  };

  /* ---------- YouTube (con la clave de API de la persona) ---------- */
  const youtube = {
    id: 'youtube', name: 'YouTube', note: 'Videos (necesita tu clave de YouTube en Ajustes)', needsKey: true,
    async search(q, key) {
      if (!key) throw Object.assign(new Error('falta la clave'), { code: 'nokey' });
      const r = await getJSON(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=20&safeSearch=moderate&q=${enc(q)}&key=${enc(key)}`);
      const unesc = (s) => { const d = document.createElement('textarea'); d.innerHTML = s || ''; return d.value; };
      return (r.items || []).filter((v) => v.id && v.id.videoId).map((v) => ({
        id: 'yt:' + v.id.videoId, source: 'youtube', kind: 'video', videoId: v.id.videoId,
        title: unesc(v.snippet.title), artist: unesc(v.snippet.channelTitle), album: 'YouTube',
        coverUrl: v.snippet.thumbnails && (v.snippet.thumbnails.high || v.snippet.thumbnails.medium || v.snippet.thumbnails.default).url || '',
        link: 'https://www.youtube.com/watch?v=' + v.id.videoId
      }));
    }
  };

  // Apps que no dejan reproducir dentro de Onda: se abre su búsqueda.
  const external = [
    { id: 'spotify', name: 'Spotify', url: (q) => 'https://open.spotify.com/search/' + enc(q) },
    { id: 'ytmusic', name: 'YouTube Music', url: (q) => 'https://music.youtube.com/search?q=' + enc(q) },
    { id: 'youtube', name: 'YouTube', url: (q) => 'https://www.youtube.com/results?search_query=' + enc(q) },
    { id: 'soundcloud', name: 'SoundCloud', url: (q) => 'https://soundcloud.com/search?q=' + enc(q) },
    { id: 'apple', name: 'Apple Music', url: (q) => 'https://music.apple.com/search?term=' + enc(q) },
    { id: 'deezer', name: 'Deezer', url: (q) => 'https://www.deezer.com/search/' + enc(q) }
  ];

  const providers = [audius, archive, youtube, deezer, itunes];
  root.OndaOnline = { providers, byId: Object.fromEntries(providers.map((p) => [p.id, p])), external, archive };
})(window);
