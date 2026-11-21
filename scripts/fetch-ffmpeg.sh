#!/usr/bin/env bash
# Descarga ffmpeg y ffprobe estáticos para empaquetarlos dentro de Ikusi.app
# (sidecars de Tauri). Solo hace falta para la versión de release; en
# desarrollo basta con `brew install ffmpeg`.
#
# Uso: bash scripts/fetch-ffmpeg.sh [triple]     (por defecto x86_64-apple-darwin)
#
# Fuente: builds estáticos de https://evermeet.cx/ffmpeg/ (Intel x86_64,
# también funcionan en Apple Silicon mediante Rosetta 2).
set -euo pipefail

TRIPLE="${1:-x86_64-apple-darwin}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src-tauri/binaries"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$DEST"

case "$TRIPLE" in
  x86_64-apple-darwin | aarch64-apple-darwin)
    for bin in ffmpeg ffprobe; do
      echo "→ Descargando $bin…"
      curl -fsSL --retry 3 "https://evermeet.cx/ffmpeg/getrelease/$bin/zip" -o "$TMP/$bin.zip"
      unzip -o -q "$TMP/$bin.zip" -d "$TMP"
      install -m 755 "$TMP/$bin" "$DEST/$bin-$TRIPLE"
    done
    ;;
  *)
    echo "Triple no soportado: $TRIPLE" >&2
    echo "Copia a mano ffmpeg y ffprobe como src-tauri/binaries/ffmpeg-$TRIPLE y ffprobe-$TRIPLE" >&2
    exit 1
    ;;
esac

"$DEST/ffmpeg-$TRIPLE" -hide_banner -version | head -1 || true
echo "✓ Binarios listos en $DEST"
