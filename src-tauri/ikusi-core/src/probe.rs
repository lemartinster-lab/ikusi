//! Análisis del archivo con `ffprobe`.
//!
//! El parseo del JSON está separado de la ejecución para poder testearlo con
//! salidas reales de ffprobe guardadas como texto.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::{CoreError, Result};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    /// Nombre del contenedor según ffprobe, p. ej. "matroska,webm" o "mov,mp4,m4a,3gp,3g2,mj2".
    pub format_name: String,
    /// Duración en segundos, si se conoce.
    pub duration: Option<f64>,
    pub video: Option<VideoStream>,
    pub audio: Vec<AudioStream>,
    pub subtitles: Vec<SubtitleStream>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoStream {
    pub index: u32,
    pub codec: String,
    /// Etiqueta del códec en el contenedor (p. ej. "hvc1" o "hev1" en HEVC).
    pub codec_tag: String,
    pub profile: Option<String>,
    pub pix_fmt: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioStream {
    pub index: u32,
    pub codec: String,
    pub channels: Option<u32>,
    pub language: Option<String>,
    pub title: Option<String>,
    pub default: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleStream {
    pub index: u32,
    pub codec: String,
    pub language: Option<String>,
    pub title: Option<String>,
    pub default: bool,
    /// `false` para subtítulos de imagen (PGS de Blu-ray, DVD), que no se pueden
    /// convertir a WebVTT.
    pub text_based: bool,
}

// --- Estructuras crudas del JSON de ffprobe ---

#[derive(Deserialize)]
struct RawProbe {
    #[serde(default)]
    streams: Vec<RawStream>,
    format: Option<RawFormat>,
}

#[derive(Deserialize)]
struct RawFormat {
    format_name: Option<String>,
    duration: Option<String>,
}

#[derive(Deserialize)]
struct RawStream {
    index: u32,
    codec_type: Option<String>,
    codec_name: Option<String>,
    codec_tag_string: Option<String>,
    profile: Option<String>,
    pix_fmt: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    channels: Option<u32>,
    #[serde(default)]
    tags: RawTags,
    #[serde(default)]
    disposition: RawDisposition,
}

#[derive(Deserialize, Default)]
struct RawTags {
    language: Option<String>,
    title: Option<String>,
}

#[derive(Deserialize, Default)]
struct RawDisposition {
    #[serde(default)]
    default: u8,
    #[serde(default)]
    attached_pic: u8,
}

const TEXT_SUBTITLE_CODECS: [&str; 6] = ["subrip", "ass", "ssa", "webvtt", "mov_text", "text"];

/// Convierte la salida JSON de `ffprobe -show_streams -show_format` en [`MediaInfo`].
pub fn parse_ffprobe_json(json: &str) -> Result<MediaInfo> {
    let raw: RawProbe = serde_json::from_str(json)?;
    let format = raw.format.ok_or_else(|| CoreError::Probe("ffprobe no devolvió formato".into()))?;

    let mut info = MediaInfo {
        format_name: format.format_name.unwrap_or_default(),
        duration: format.duration.and_then(|d| d.parse::<f64>().ok()).filter(|d| *d > 0.0),
        video: None,
        audio: Vec::new(),
        subtitles: Vec::new(),
    };

    for s in raw.streams {
        let codec = s.codec_name.clone().unwrap_or_default();
        let language = s.tags.language.clone().filter(|l| l != "und");
        match s.codec_type.as_deref() {
            // Las carátulas de MKV/MP3 aparecen como "vídeo" con attached_pic=1; se ignoran.
            Some("video") if s.disposition.attached_pic == 0 && info.video.is_none() => {
                info.video = Some(VideoStream {
                    index: s.index,
                    codec,
                    codec_tag: s.codec_tag_string.unwrap_or_default(),
                    profile: s.profile,
                    pix_fmt: s.pix_fmt,
                    width: s.width,
                    height: s.height,
                });
            }
            Some("audio") => info.audio.push(AudioStream {
                index: s.index,
                codec,
                channels: s.channels,
                language,
                title: s.tags.title,
                default: s.disposition.default == 1,
            }),
            Some("subtitle") => info.subtitles.push(SubtitleStream {
                index: s.index,
                text_based: TEXT_SUBTITLE_CODECS.contains(&codec.as_str()),
                codec,
                language,
                title: s.tags.title,
                default: s.disposition.default == 1,
            }),
            _ => {}
        }
    }

    if info.video.is_none() && info.audio.is_empty() {
        return Err(CoreError::NoPlayableStreams);
    }
    Ok(info)
}

/// Ejecuta ffprobe sobre `file` y devuelve la información parseada.
pub async fn probe_file(ffprobe: &Path, file: &Path) -> Result<MediaInfo> {
    let output = Command::new(ffprobe)
        .args(["-v", "error", "-print_format", "json", "-show_streams", "-show_format"])
        .arg(file)
        .kill_on_drop(true)
        .output()
        .await?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(CoreError::Probe(stderr.trim().to_string()));
    }
    parse_ffprobe_json(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Salida representativa de un MKV de película: HEVC 10 bits con etiqueta
    /// "hev1"-compatible, carátula adjunta, dos audios (AC3 español y AAC inglés)
    /// y subtítulos SRT + PGS.
    pub const MKV_HEVC: &str = r#"{
      "streams": [
        {"index":0,"codec_name":"hevc","codec_type":"video","codec_tag_string":"[0][0][0][0]","profile":"Main 10","pix_fmt":"yuv420p10le","width":1920,"height":800,"disposition":{"default":1,"attached_pic":0}},
        {"index":1,"codec_name":"ac3","codec_type":"audio","channels":6,"tags":{"language":"spa","title":"Castellano 5.1"},"disposition":{"default":1,"attached_pic":0}},
        {"index":2,"codec_name":"aac","codec_type":"audio","channels":2,"tags":{"language":"eng"},"disposition":{"default":0,"attached_pic":0}},
        {"index":3,"codec_name":"subrip","codec_type":"subtitle","tags":{"language":"spa","title":"Forzados"},"disposition":{"default":0,"attached_pic":0}},
        {"index":4,"codec_name":"hdmv_pgs_subtitle","codec_type":"subtitle","tags":{"language":"eng"},"disposition":{"default":0,"attached_pic":0}},
        {"index":5,"codec_name":"mjpeg","codec_type":"video","disposition":{"default":0,"attached_pic":1}}
      ],
      "format": {"format_name":"matroska,webm","duration":"7265.312000"}
    }"#;

    #[test]
    fn parses_mkv_with_multiple_tracks() {
        let info = parse_ffprobe_json(MKV_HEVC).unwrap();
        assert_eq!(info.format_name, "matroska,webm");
        assert_eq!(info.duration, Some(7265.312));

        let v = info.video.unwrap();
        assert_eq!(v.codec, "hevc");
        assert_eq!(v.index, 0);
        assert_eq!(v.pix_fmt.as_deref(), Some("yuv420p10le"));

        assert_eq!(info.audio.len(), 2);
        assert_eq!(info.audio[0].codec, "ac3");
        assert_eq!(info.audio[0].language.as_deref(), Some("spa"));
        assert!(info.audio[0].default);
        assert_eq!(info.audio[1].index, 2);

        assert_eq!(info.subtitles.len(), 2);
        assert!(info.subtitles[0].text_based);
        assert!(!info.subtitles[1].text_based, "PGS es de imagen");
    }

    #[test]
    fn ignores_cover_art_as_video() {
        let json = r#"{
          "streams": [
            {"index":0,"codec_name":"mp3","codec_type":"audio","channels":2,"tags":{"language":"und"}},
            {"index":1,"codec_name":"png","codec_type":"video","disposition":{"default":0,"attached_pic":1}}
          ],
          "format": {"format_name":"mp3","duration":"215.4"}
        }"#;
        let info = parse_ffprobe_json(json).unwrap();
        assert!(info.video.is_none());
        assert_eq!(info.audio.len(), 1);
        assert_eq!(info.audio[0].language, None, "\"und\" se trata como sin idioma");
    }

    #[test]
    fn rejects_files_without_audio_or_video() {
        let json = r#"{"streams":[{"index":0,"codec_name":"subrip","codec_type":"subtitle"}],"format":{"format_name":"srt"}}"#;
        assert!(matches!(parse_ffprobe_json(json), Err(CoreError::NoPlayableStreams)));
    }

    #[test]
    fn tolerates_missing_or_bogus_duration() {
        let json = r#"{"streams":[{"index":0,"codec_name":"h264","codec_type":"video"}],"format":{"format_name":"mpegts","duration":"N/A"}}"#;
        assert_eq!(parse_ffprobe_json(json).unwrap().duration, None);
    }
}
