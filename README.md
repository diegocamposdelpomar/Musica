# Onda · reproductor de música para el celular

Aplicación web instalable (PWA) para escuchar en el teléfono las canciones que ya tienes, incluso sin internet.
Está hecha en HTML, CSS y JavaScript puro, sin dependencias ni paso de compilación.

## Qué hace

- **Añadir música** desde el teléfono (MP3, M4A/AAC, OGG/Opus, WAV, FLAC, WebM). Las canciones se guardan
  dentro de la app (IndexedDB), así que siguen disponibles sin conexión.
- **Lee las etiquetas ID3** de los MP3: título, artista, álbum, número de pista y portada. Si no hay
  etiquetas, deduce «Artista - Título» del nombre del archivo. Los datos se pueden editar.
- **Biblioteca** por canciones, artistas y álbumes, con su propio **buscador** (sin distinguir tildes).
- **Buscar en internet** a la vez, sin cuentas ni servidor propio:
  - **Audius**: canciones completas de artistas independientes, dentro de Onda.
  - **Internet Archive**: música libre y conciertos completos; se pueden **guardar sin conexión**.
  - **Deezer** y **Apple Music**: avances de 30 segundos.
  - **YouTube**: videos dentro de la app con la clave de API propia de la persona (opcional, en Ajustes).
  - **Spotify, SoundCloud, YouTube Music…**: abre su app con la búsqueda (no permiten reproducir en otras apps).
- **Listas** propias y la lista automática **Me gusta**.
- **Reproductor** a pantalla completa: aleatorio, repetir (todo / una), cola editable, deslizar hacia abajo
  para cerrar y a los lados sobre la portada para cambiar de canción.
- **Controles en la pantalla de bloqueo** y en los auriculares (Media Session API).
- **Ecualizador** de 5 bandas con preajustes y visualizador (opcional: en iPhone puede cortar el sonido
  con la pantalla bloqueada).
- **Temporizador para dormir** (15, 30, 45, 60 min o al terminar la canción), con bajada de volumen suave.
- Recuerda la última canción y la posición, tema claro / oscuro / automático.
- **3 canciones de muestra** originales, compuestas y sintetizadas en el propio navegador, para probarla
  sin tener música a mano.

## Probarla

Publicada con GitHub Pages en **https://diegocamposdelpomar.github.io/musica/**

Para instalarla en el teléfono, abre ese enlace en el navegador: en Android, Chrome → ⋮ → «Instalar app»;
en iPhone, Safari → Compartir → «Añadir a pantalla de inicio».

Para probarla en el ordenador, sirve la carpeta con cualquier servidor estático (el modo sin conexión necesita `http(s)`):

```sh
python3 -m http.server 8000
# abre http://localhost:8000/
```

## Archivos

| Archivo | Qué contiene |
| --- | --- |
| `index.html` | Estructura, íconos SVG y reproductor |
| `app.css` | Estilos, pensados primero para el celular |
| `js/db.js` | Almacén local (IndexedDB) |
| `js/tags.js` | Lectura de etiquetas ID3 y duración |
| `js/player.js` | Motor: cola, aleatorio, repetir, pantalla de bloqueo, ecualizador, temporizador |
| `js/demo.js` | Composición de las canciones de muestra |
| `js/online.js` | Búsqueda en internet: Audius, Internet Archive, Deezer, Apple Music, YouTube |
| `js/app.js` | Interfaz: vistas, listas, buscador, hojas de opciones |
| `sw.js` | Guarda la app para abrirla sin internet (sube `VERSION` al cambiar archivos) |
