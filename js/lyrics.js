/* Letras de canciones.
   - LRCLIB (lrclib.net): base de letras libre, sin cuenta ni clave. Muchas vienen sincronizadas (formato LRC).
   - Las letras guardadas en el propio MP3 (etiqueta USLT) las lee tags.js.
   Resultado normalizado: { synced: [{ t, text }] | null, plain: string, source, instrumental, notFound } */
(function (root) {
  const API = 'https://lrclib.net/api';

  // «[01:23.45] texto» → [{ t: 83.45, text }]. Admite varias marcas en una línea y el desfase [offset:+/-ms].
  function parseLRC(src) {
    if (!src) return null;
    let offset = 0; const out = [];
    for (const raw of String(src).split(/\r?\n/)) {
      const off = raw.match(/^\[offset:\s*([+-]?\d+)\s*\]/i); if (off) { offset = +off[1] / 1000; continue; }
      const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
      if (!tags.length) continue;
      const text = raw.replace(/\[[^\]]*\]/g, '').trim();
      for (const m of tags) out.push({ t: Math.max(0, +m[1] * 60 + parseFloat(m[2].replace(':', '.')) - offset), text });
    }
    if (!out.length) return null;
    return out.sort((a, b) => a.t - b.t);
  }
  const isLRC = (s) => /^\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/m.test(s || '');
  const lrcToPlain = (lines) => lines.map((l) => l.text).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // Quita adornos frecuentes en títulos de YouTube, Audius, etc.
  function cleanTitle(s) {
    return String(s || '')
      .replace(/\s*[\(\[][^\)\]]*(official|oficial|video|audio|lyric|letra|visualizer|live|en vivo|remaster|hd|4k|mv)[^\)\]]*[\)\]]/gi, '')
      .replace(/\s*[\(\[]?\s*(feat\.?|ft\.?|con)\s[^\)\]]*[\)\]]?/gi, '')
      .replace(/\s*\|.*$/, '')
      .replace(/\.(mp3|m4a|wav|ogg|flac)$/i, '')
      .replace(/\s+/g, ' ').trim();
  }
  function splitArtist(title, artist) {
    // «Artista - Canción» en el título (típico de YouTube) cuando el artista es un canal.
    const m = String(title).match(/^(.+?)\s+[-–—]\s+(.+)$/);
    return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist, title };
  }
  const normalize = (r, source) => {
    if (!r) return null;
    if (r.instrumental) return { synced: null, plain: '', source, instrumental: true };
    const synced = parseLRC(r.syncedLyrics);
    const plain = (r.plainLyrics || (synced ? lrcToPlain(synced) : '')).trim();
    if (!synced && !plain) return null;
    return { synced, plain, source };
  };

  async function getJSON(url, ms = 10000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('LRCLIB respondió ' + r.status);
      return await r.json();
    } catch (e) { throw new Error(e.name === 'AbortError' ? 'tiempo agotado' : e.message); }
    finally { clearTimeout(t); }
  }

  async function find(track) {
    let title = cleanTitle(track.title);
    let artist = String(track.artist || '').replace(/\s*-\s*Topic$/i, '').trim();
    if (!artist || /desconocido|unknown/i.test(artist) || track.source === 'youtube') ({ artist, title } = splitArtist(title, artist));
    title = cleanTitle(title);
    const q = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    const dur = track.preview ? 0 : Math.round(track.fullDuration || track.duration || 0);
    // 1) Coincidencia exacta (la más fiable)
    if (artist && title) {
      const album = track.album && !/^(sin álbum|audius|youtube)$/i.test(track.album) ? track.album : '';
      let exact = null; // si falla (p. ej. faltan datos), se sigue con la búsqueda
      try { exact = await getJSON(`${API}/get?${q({ track_name: title, artist_name: artist, album_name: album, duration: dur || '' })}`); } catch (e) { exact = null; }
      const n = normalize(exact, 'LRCLIB'); if (n) return n;
    }
    // 2) Búsqueda: se elige la de duración más parecida, prefiriendo las sincronizadas
    const list = await getJSON(`${API}/search?${q(artist ? { track_name: title, artist_name: artist } : { q: title })}`) || [];
    const scored = list.filter((r) => r.syncedLyrics || r.plainLyrics || r.instrumental)
      .map((r) => ({ r, s: (dur && r.duration ? Math.abs(r.duration - dur) : 30) - (r.syncedLyrics ? 5 : 0) }))
      .filter((x) => !dur || !x.r.duration || Math.abs(x.r.duration - dur) < 20)
      .sort((a, b) => a.s - b.s);
    if (scored.length) return normalize(scored[0].r, 'LRCLIB');
    return { synced: null, plain: '', source: 'LRCLIB', notFound: true };
  }

  // Letra escrita o pegada por la persona: detecta si es LRC.
  function fromText(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    if (isLRC(s)) { const synced = parseLRC(s); return { synced, plain: lrcToPlain(synced), source: 'manual', raw: s }; }
    return { synced: null, plain: s, source: 'manual', raw: s };
  }

  root.OndaLyrics = { find, parseLRC, fromText, cleanTitle };
})(window);
