//! Decide cómo reproducir un archivo en el webview de macOS (WebKit/Safari).
//!
//! Hay tres modos, de más barato a más caro:
//! - **Direct**: el `<video>` abre el archivo tal cual (MP4/MOV con H.264/HEVC y AAC).
//! - **Remux**: ffmpeg cambia el contenedor a HLS copiando el vídeo; como mucho
//!   convierte el audio a AAC, que apenas cuesta CPU.
//! - **Transcode**: hay que recodificar el vídeo (códecs que WebKit no entiende,
//!   o cuando el usuario fuerza la conversión porque el remux falló).

use serde::Serialize;

use crate::probe::{AudioStream, MediaInfo, VideoStream};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    Direct,
    Remux,
    Transcode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoAction {
    /// No hay pista de vídeo (archivo de audio).
    None,
    Copy,
    Encode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioAction {
    None,
    Copy,
    EncodeAac,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlaybackPlan {
    pub mode: Mode,
    pub video: VideoAction,
    pub audio: AudioAction,
    /// Reetiquetar HEVC como `hvc1`: WebKit solo decodifica HEVC con esa etiqueta.
    pub hevc_tag: bool,
    /// Posición de la pista de audio elegida dentro de `MediaInfo::audio` (no el
    /// índice absoluto del stream).
    pub audio_track: Option<usize>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct PlanOptions {
    /// Pista de audio pedida por el usuario (posición en `MediaInfo::audio`).
    pub audio_track: Option<usize>,
    /// Recodificar el vídeo aunque parezca compatible (recurso cuando el remux falla).
    pub force_transcode: bool,
}

fn is_mp4_family(format_name: &str) -> bool {
    format_name.split(',').any(|f| matches!(f, "mov" | "mp4" | "m4a"))
}

/// ¿Puede WebKit decodificar este vídeo si se le entrega en MP4/HLS?
pub fn video_is_compatible(v: &VideoStream) -> bool {
    let pix = v.pix_fmt.as_deref().unwrap_or("yuv420p");
    match v.codec.as_str() {
        // H.264 de 10 bits (High 10) no tiene decodificación por hardware en Mac.
        "h264" => matches!(pix, "yuv420p" | "yuvj420p"),
        // HEVC 8 y 10 bits: decodificación por hardware en Mac Intel de 7.ª gen. en adelante.
        "hevc" => matches!(pix, "yuv420p" | "yuvj420p" | "yuv420p10le"),
        _ => false,
    }
}

/// Audio que se puede copiar sin convertir dentro de HLS fMP4.
fn audio_copyable_in_hls(a: &AudioStream) -> bool {
    a.codec == "aac"
}

/// Audio que WebKit reproduce directamente dentro de un MP4/MOV.
fn audio_ok_in_mp4(a: &AudioStream) -> bool {
    matches!(a.codec.as_str(), "aac" | "mp3" | "alac")
}

/// Formatos de solo audio que WebKit abre directamente.
fn audio_only_direct(format_name: &str, a: &AudioStream) -> bool {
    match format_name {
        "mp3" => a.codec == "mp3",
        "flac" => a.codec == "flac",
        "wav" => a.codec.starts_with("pcm_"),
        "aac" => a.codec == "aac",
        f if is_mp4_family(f) => audio_ok_in_mp4(a),
        _ => false,
    }
}

/// Pista de audio a usar: la pedida si existe; si no, la marcada por defecto; si
/// no, la primera.
fn resolve_audio_track(info: &MediaInfo, requested: Option<usize>) -> Option<usize> {
    if info.audio.is_empty() {
        return None;
    }
    if let Some(i) = requested.filter(|i| *i < info.audio.len()) {
        return Some(i);
    }
    Some(info.audio.iter().position(|a| a.default).unwrap_or(0))
}

pub fn plan(info: &MediaInfo, opts: PlanOptions) -> PlaybackPlan {
    let audio_track = resolve_audio_track(info, opts.audio_track);
    let audio = audio_track.map(|i| &info.audio[i]);
    // En modo directo el navegador elige la pista por su cuenta, así que solo es
    // válido si la pista elegida es la que reproduciría él (la primera).
    let first_audio_selected = audio_track.map_or(true, |i| i == 0);

    // --- Archivos de solo audio ---
    let Some(video) = info.video.as_ref() else {
        let a = audio.expect("MediaInfo garantiza vídeo o audio");
        if first_audio_selected && audio_only_direct(&info.format_name, a) {
            return PlaybackPlan {
                mode: Mode::Direct,
                video: VideoAction::None,
                audio: AudioAction::Copy,
                hevc_tag: false,
                audio_track,
            };
        }
        return PlaybackPlan {
            mode: Mode::Remux,
            video: VideoAction::None,
            audio: if audio_copyable_in_hls(a) { AudioAction::Copy } else { AudioAction::EncodeAac },
            hevc_tag: false,
            audio_track,
        };
    };

    let audio_action = match audio {
        None => AudioAction::None,
        Some(a) if audio_copyable_in_hls(a) => AudioAction::Copy,
        Some(_) => AudioAction::EncodeAac,
    };

    if opts.force_transcode || !video_is_compatible(video) {
        return PlaybackPlan {
            mode: Mode::Transcode,
            video: VideoAction::Encode,
            audio: audio_action,
            hevc_tag: false,
            audio_track,
        };
    }

    // --- Vídeo compatible: ¿directo o remux? ---
    let is_hevc = video.codec == "hevc";
    let tag_ok = !is_hevc || video.codec_tag == "hvc1";
    let audio_ok = audio.map_or(true, audio_ok_in_mp4);
    if is_mp4_family(&info.format_name) && tag_ok && audio_ok && first_audio_selected {
        return PlaybackPlan {
            mode: Mode::Direct,
            video: VideoAction::Copy,
            audio: if audio.is_some() { AudioAction::Copy } else { AudioAction::None },
            hevc_tag: false,
            audio_track,
        };
    }

    PlaybackPlan {
        mode: Mode::Remux,
        video: VideoAction::Copy,
        audio: audio_action,
        hevc_tag: is_hevc,
        audio_track,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video(codec: &str, tag: &str, pix: &str) -> VideoStream {
        VideoStream {
            index: 0,
            codec: codec.into(),
            codec_tag: tag.into(),
            profile: None,
            pix_fmt: Some(pix.into()),
            width: Some(1920),
            height: Some(1080),
        }
    }

    fn audio(index: u32, codec: &str, default: bool) -> AudioStream {
        AudioStream { index, codec: codec.into(), channels: Some(2), language: None, title: None, default }
    }

    fn info(format: &str, v: Option<VideoStream>, a: Vec<AudioStream>) -> MediaInfo {
        MediaInfo { format_name: format.into(), duration: Some(100.0), video: v, audio: a, subtitles: vec![] }
    }

    const MP4: &str = "mov,mp4,m4a,3gp,3g2,mj2";

    #[test]
    fn mp4_h264_aac_plays_directly() {
        let i = info(MP4, Some(video("h264", "avc1", "yuv420p")), vec![audio(1, "aac", true)]);
        let p = plan(&i, PlanOptions::default());
        assert_eq!(p.mode, Mode::Direct);
    }

    #[test]
    fn mkv_h264_with_ac3_is_remuxed_converting_only_audio() {
        let i = info("matroska,webm", Some(video("h264", "", "yuv420p")), vec![audio(1, "ac3", true)]);
        let p = plan(&i, PlanOptions::default());
        assert_eq!(p.mode, Mode::Remux);
        assert_eq!(p.video, VideoAction::Copy);
        assert_eq!(p.audio, AudioAction::EncodeAac);
    }

    #[test]
    fn mkv_hevc_10bit_is_remuxed_with_hvc1_tag() {
        let i = info("matroska,webm", Some(video("hevc", "", "yuv420p10le")), vec![audio(1, "aac", true)]);
        let p = plan(&i, PlanOptions::default());
        assert_eq!(p.mode, Mode::Remux);
        assert!(p.hevc_tag);
        assert_eq!(p.audio, AudioAction::Copy);
    }

    #[test]
    fn mp4_hevc_tagged_hev1_needs_remux_to_retag() {
        let i = info(MP4, Some(video("hevc", "hev1", "yuv420p")), vec![audio(1, "aac", true)]);
        assert_eq!(plan(&i, PlanOptions::default()).mode, Mode::Remux);

        let i = info(MP4, Some(video("hevc", "hvc1", "yuv420p")), vec![audio(1, "aac", true)]);
        assert_eq!(plan(&i, PlanOptions::default()).mode, Mode::Direct);
    }

    #[test]
    fn unsupported_codecs_are_transcoded() {
        for (codec, pix) in [("mpeg2video", "yuv420p"), ("vc1", "yuv420p"), ("av1", "yuv420p"), ("h264", "yuv420p10le")] {
            let i = info("matroska,webm", Some(video(codec, "", pix)), vec![audio(1, "dts", true)]);
            let p = plan(&i, PlanOptions::default());
            assert_eq!(p.mode, Mode::Transcode, "{codec} {pix}");
            assert_eq!(p.audio, AudioAction::EncodeAac);
        }
    }

    #[test]
    fn force_transcode_overrides_compatible_video() {
        let i = info(MP4, Some(video("h264", "avc1", "yuv420p")), vec![audio(1, "aac", true)]);
        let p = plan(&i, PlanOptions { force_transcode: true, ..Default::default() });
        assert_eq!(p.mode, Mode::Transcode);
        assert_eq!(p.audio, AudioAction::Copy, "el audio AAC se sigue copiando");
    }

    #[test]
    fn choosing_second_audio_track_forces_hls() {
        let i = info(
            MP4,
            Some(video("h264", "avc1", "yuv420p")),
            vec![audio(1, "aac", true), audio(2, "aac", false)],
        );
        let p = plan(&i, PlanOptions { audio_track: Some(1), ..Default::default() });
        assert_eq!(p.mode, Mode::Remux);
        assert_eq!(p.audio_track, Some(1));
    }

    #[test]
    fn default_audio_track_is_preferred_and_bad_requests_ignored() {
        let i = info(
            "matroska,webm",
            Some(video("h264", "", "yuv420p")),
            vec![audio(1, "aac", false), audio(2, "ac3", true)],
        );
        assert_eq!(plan(&i, PlanOptions::default()).audio_track, Some(1));
        assert_eq!(plan(&i, PlanOptions { audio_track: Some(9), ..Default::default() }).audio_track, Some(1));
    }

    #[test]
    fn audio_only_files() {
        let mp3 = info("mp3", None, vec![audio(0, "mp3", false)]);
        assert_eq!(plan(&mp3, PlanOptions::default()).mode, Mode::Direct);

        let flac = info("flac", None, vec![audio(0, "flac", false)]);
        assert_eq!(plan(&flac, PlanOptions::default()).mode, Mode::Direct);

        let ogg = info("ogg", None, vec![audio(0, "vorbis", false)]);
        let p = plan(&ogg, PlanOptions::default());
        assert_eq!(p.mode, Mode::Remux);
        assert_eq!(p.video, VideoAction::None);
        assert_eq!(p.audio, AudioAction::EncodeAac);
    }

    #[test]
    fn silent_video_has_no_audio_action() {
        let i = info("matroska,webm", Some(video("h264", "", "yuv420p")), vec![]);
        let p = plan(&i, PlanOptions::default());
        assert_eq!(p.mode, Mode::Remux);
        assert_eq!(p.audio, AudioAction::None);
        assert_eq!(p.audio_track, None);
    }
}
