# Ikusi

Reproductor multimedia personal tipo VLC para macOS, hecho con **Tauri 2 + React + TypeScript** y **ffmpeg**. *Ikusi* significa «ver» en euskera.

## Cómo reproduce cualquier formato

El webview de Tauri en macOS es WebKit (el motor de Safari), que solo entiende algunos formatos. Ikusi analiza cada archivo con `ffprobe` y elige el camino más barato:

| Modo | Cuándo | Coste |
|---|---|---|
| **Directo** | MP4/MOV con H.264 o HEVC (`hvc1`) y AAC/MP3; MP3, FLAC, WAV | Ninguno |
| **Remux** | MKV, AVI, TS… con vídeo H.264/HEVC. ffmpeg cambia el contenedor a HLS sin recodificar el vídeo; si el audio es AC3/DTS/FLAC lo pasa a AAC | Casi nulo |
| **Convirtiendo** | Códecs que WebKit no entiende (MPEG-2, VC-1, AV1, H.264 10 bits…). Usa el codificador por hardware de macOS (VideoToolbox), limitado a 1080p | Alto |

Si el modo directo o el remux fallan en el `<video>` (por ejemplo, HEVC en un Mac sin decodificación por hardware), Ikusi reintenta automáticamente convirtiendo.

Todo se sirve al `<video>` desde un servidor HTTP local (`127.0.0.1`, puerto aleatorio y token secreto en la ruta), con soporte de rangos para saltar dentro de los archivos directos.

## Funciones

- Abrir con diálogo (Cmd+O), arrastrando a la ventana, «Abrir con…» desde el Finder o por línea de comandos.
- Lista de reproducción con orden natural (Capítulo 2 antes que Capítulo 10) y paso automático al siguiente.
- **Seguir viendo**: recuerda la posición de cada archivo y reanuda donde lo dejaste.
- Pistas de audio múltiples y subtítulos incrustados (texto) o externos (`.srt`, `.vtt`, `.ass`), con detección de codificación Windows-1252 para que «ñ» y las tildes salgan bien.
- Retardo de subtítulos, velocidad de 0,25× a 3×, volumen con la rueda del ratón y recientes.

## Modo estudio e IA (fase 2)

- **Subtítulos dobles**: en el menú de pistas, «Segunda línea» muestra otro idioma debajo (en ámbar). Ideal para aprender euskera: original arriba, traducción abajo.
- **Traducir con Claude**: «Traducir subtítulos a…» traduce los subtítulos activos (Haiku 5.5 por defecto, Sonnet 5.5 opcional) y los pone como segunda línea. Se envían por bloques con contexto, se valida que vuelvan las mismas líneas y el resultado queda en caché.
- **Generar con Whisper**: crea subtítulos de la pista de audio actual, en tu Mac y sin subir nada. Requiere `brew install whisper-cpp` y descargar un modelo en Ajustes (Cmd+,).
- **Repetición A‑B** (R): marca A, marca B y repite ese tramo; tercera pulsación lo quita.
- **Marcadores** (K): guardan el momento y los subtítulos visibles; se les añade una nota en el panel lateral (L → Marcadores) y se exportan a Markdown para Obsidian.
- **Guardar subtítulos** generados o traducidos como `.srt` o `.vtt`.

La clave de API de Anthropic se guarda en el **Llavero de macOS** y las llamadas a Claude se hacen desde Rust: la clave nunca pasa por la interfaz web. En desarrollo también vale la variable `ANTHROPIC_API_KEY`.

### Atajos (estilo VLC)

| Tecla | Acción |
|---|---|
| Espacio | Reproducir / pausa |
| ← → | ±10 s (Mayús ±3 s, Cmd ±60 s) |
| ↑ ↓ | Volumen |
| F / Esc | Pantalla completa / salir (también doble clic) |
| M | Silenciar |
| [ ] = | Velocidad − / + / normal |
| N / P | Siguiente / anterior |
| V / B | Cambiar subtítulos / pista de audio |
| G / H | Retardo de subtítulos −/+ 0,1 s |
| L | Lista y marcadores |
| T | Mostrar tiempo |
| R | Repetición A‑B |
| K | Añadir marcador |
| Cmd+, | Ajustes |

## Desarrollo en el iMac

```bash
brew install ffmpeg          # Ikusi lo busca en /usr/local/bin (Intel) y /opt/homebrew/bin
brew install whisper-cpp     # opcional: generar subtítulos
pnpm install
pnpm tauri dev
```

Comprobaciones:

```bash
pnpm typecheck               # tsc --noEmit
pnpm test                    # tests del frontend (Vitest)
pnpm test:rust               # tests del núcleo en Rust, incluida una prueba real con ffmpeg
# Prueba real de Whisper (opcional): IKUSI_TEST_WHISPER_MODEL=/ruta/ggml-base.bin pnpm test:rust
```

## Versión instalable

```bash
pnpm ffmpeg:fetch            # descarga ffmpeg/ffprobe estáticos a src-tauri/binaries/
pnpm release:build           # genera Ikusi.app y el .dmg con ffmpeg dentro
```

O sube una etiqueta (`git tag v0.1.0 && git push --tags`) y GitHub Actions publica un borrador de release con el `.dmg` para Mac Intel. La app no está firmada: la primera vez, clic derecho → Abrir, o `xattr -cr /Applications/Ikusi.app`.

## Estructura

```
src/                     Frontend React
  App.tsx                Orquestación: carga, saltos, pistas, lista, IA, atajos
  components/            Controls, TrackMenu, SubtitleOverlay, SidePanel, SettingsPanel, AiTaskToast…
  hooks/                 Atajos, autoocultado, avisos, gestión de subtítulos
  lib/                   Lógica pura con tests (vtt, abLoop, bookmarks, seek, settings…)
src-tauri/
  src/lib.rs             Comandos de reproducción y «Abrir con…»
  src/ai.rs              Comandos de IA con progreso y cancelación
  src/secrets.rs         Clave de API en el Llavero
  ikusi-core/            Núcleo sin Tauri, testeable con cargo test
    probe.rs             Análisis con ffprobe
    decision.rs          Directo / remux / conversión
    ffmpeg_args.rs       Orden de ffmpeg para HLS
    session.rs           Proceso de ffmpeg y carpeta temporal
    server.rs            Servidor HTTP local con rangos
    subtitles.rs         Codificación y extracción de subtítulos
    cues.rs              WebVTT ↔ lista de líneas
    translate.rs         Traducción con Claude (bloques, validación, reintentos)
    transcribe.rs        Whisper local y descarga de modelos
```
