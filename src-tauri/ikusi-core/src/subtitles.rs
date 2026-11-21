//! Subtítulos: lectura de archivos externos con la codificación correcta y
//! extracción/conversión a WebVTT con ffmpeg.
//!
//! Muchos .srt en castellano están guardados en Windows-1252 (Latin-1), no en
//! UTF-8; si se leen mal aparecen "Ã±" en lugar de "ñ". Por eso se detecta.

use std::path::Path;
use std::process::Stdio;

use encoding_rs::{UTF_16BE, UTF_16LE, WINDOWS_1252};
use tokio::process::Command;

use crate::probe::SubtitleStream;
use crate::{CoreError, Result};

/// Decodifica texto de subtítulos: BOM UTF-8/UTF-16, UTF-8 válido o, si no,
/// Windows-1252.
pub fn decode_text(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return UTF_16LE.decode_with_bom_removal(bytes).0.into_owned();
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return UTF_16BE.decode_with_bom_removal(bytes).0.into_owned();
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => WINDOWS_1252.decode(bytes).0.into_owned(),
    }
}

async fn run_to_vtt(ffmpeg: &Path, pre_input: &[&str], input: &Path, map: Option<String>) -> Result<String> {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-nostdin", "-loglevel", "error"]).args(pre_input).arg("-i").arg(input);
    if let Some(m) = map {
        cmd.args(["-map", &m]);
    }
    let out = cmd
        .args(["-c:s", "webvtt", "-f", "webvtt", "pipe:1"])
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await?;
    if !out.status.success() {
        return Err(CoreError::Ffmpeg(String::from_utf8_lossy(&out.stderr).trim().to_string()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Extrae una pista de subtítulos incrustada y la devuelve en WebVTT.
pub async fn extract_embedded(ffmpeg: &Path, input: &Path, stream: &SubtitleStream) -> Result<String> {
    if !stream.text_based {
        return Err(CoreError::BitmapSubtitles);
    }
    run_to_vtt(ffmpeg, &[], input, Some(format!("0:{}", stream.index))).await
}

/// Convierte un archivo .ass/.ssa a WebVTT (los .srt y .vtt se tratan en el
/// frontend). Se le indica a ffmpeg la codificación ya detectada.
pub async fn convert_file_to_vtt(ffmpeg: &Path, path: &Path) -> Result<String> {
    let bytes = tokio::fs::read(path).await?;
    let is_utf8 = std::str::from_utf8(bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes)).is_ok();
    let charenc: &[&str] = if is_utf8 { &[] } else { &["-sub_charenc", "CP1252"] };
    run_to_vtt(ffmpeg, charenc, path, None).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf8_with_and_without_bom() {
        assert_eq!(decode_text("Año".as_bytes()), "Año");
        let mut with_bom = vec![0xEF, 0xBB, 0xBF];
        with_bom.extend_from_slice("¿Qué tal?".as_bytes());
        assert_eq!(decode_text(&with_bom), "¿Qué tal?");
    }

    #[test]
    fn decodes_windows_1252_spanish_subtitles() {
        // "¡Señor, qué día!" en Windows-1252
        let bytes = [0xA1, b'S', b'e', 0xF1, b'o', b'r', b',', b' ', b'q', b'u', 0xE9, b' ', b'd', 0xED, b'a', b'!'];
        assert_eq!(decode_text(&bytes), "¡Señor, qué día!");
    }

    #[test]
    fn decodes_utf16le_with_bom() {
        let mut bytes = vec![0xFF, 0xFE];
        for u in "Kaixo".encode_utf16() {
            bytes.extend_from_slice(&u.to_le_bytes());
        }
        assert_eq!(decode_text(&bytes), "Kaixo");
    }
}
