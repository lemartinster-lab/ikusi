//! Construcción de la orden de ffmpeg que genera el HLS.
//!
//! Se genera HLS con segmentos fMP4 de ~4 s y lista de tipo "event": el
//! reproductor puede empezar en cuanto existe el primer segmento y la lista va
//! creciendo mientras ffmpeg trabaja.

use std::path::Path;

use crate::decision::{AudioAction, PlaybackPlan, VideoAction};
use crate::probe::MediaInfo;

pub const PLAYLIST_NAME: &str = "index.m3u8";
pub const SEGMENT_SECONDS: u32 = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoEncoder {
    /// Codificador por hardware de macOS (rápido incluso en Mac Intel).
    VideoToolbox,
    /// Codificador por software, para Linux/Windows o como alternativa.
    Libx264,
}

impl VideoEncoder {
    pub fn platform_default() -> Self {
        if cfg!(target_os = "macos") {
            Self::VideoToolbox
        } else {
            Self::Libx264
        }
    }
}

#[derive(Debug, Clone)]
pub struct HlsJob<'a> {
    pub input: &'a Path,
    pub out_dir: &'a Path,
    pub info: &'a MediaInfo,
    pub plan: &'a PlaybackPlan,
    /// Segundo desde el que empezar (para saltos a zonas aún no convertidas).
    pub start: f64,
    pub encoder: VideoEncoder,
}

pub fn build_hls_args(job: &HlsJob) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();
    let mut push = |items: &[&str]| a.extend(items.iter().map(|s| s.to_string()));

    push(&["-hide_banner", "-nostdin", "-y", "-loglevel", "warning"]);
    if job.start > 0.0 {
        // -ss antes de -i: salto rápido por fotogramas clave.
        push(&["-ss", &format!("{:.3}", job.start)]);
    }
    push(&["-i", &job.input.to_string_lossy()]);

    // --- Selección de pistas ---
    if job.plan.video != VideoAction::None {
        // "V" mayúscula excluye las carátulas adjuntas.
        push(&["-map", "0:V:0"]);
    }
    if let Some(track) = job.plan.audio_track {
        let stream_index = job.info.audio[track].index;
        push(&["-map", &format!("0:{stream_index}")]);
    }
    push(&["-sn", "-dn"]);

    // --- Vídeo ---
    match job.plan.video {
        VideoAction::None => push(&["-vn"]),
        VideoAction::Copy => {
            push(&["-c:v", "copy"]);
            if job.plan.hevc_tag {
                push(&["-tag:v", "hvc1"]);
            }
        }
        VideoAction::Encode => {
            // Limitar a 1080p: transcodificar 4K en tiempo real en un Mac Intel no es viable.
            push(&["-vf", "scale='min(1920,iw)':-2,format=yuv420p"]);
            match job.encoder {
                VideoEncoder::VideoToolbox => push(&[
                    "-c:v", "h264_videotoolbox", "-b:v", "8M", "-maxrate", "12M", "-bufsize", "16M",
                    "-allow_sw", "1", "-realtime", "1",
                ]),
                VideoEncoder::Libx264 => push(&["-c:v", "libx264", "-preset", "veryfast", "-crf", "21"]),
            }
            // Un fotograma clave en cada frontera de segmento para que HLS corte limpio.
            push(&["-force_key_frames", &format!("expr:gte(t,n_forced*{SEGMENT_SECONDS})")]);
        }
    }

    // --- Audio ---
    match job.plan.audio {
        AudioAction::None => push(&["-an"]),
        AudioAction::Copy => push(&["-c:a", "copy"]),
        AudioAction::EncodeAac => push(&["-c:a", "aac", "-b:a", "192k", "-ac", "2"]),
    }

    // --- Salida HLS ---
    let segment_pattern = job.out_dir.join("seg_%05d.m4s");
    let playlist = job.out_dir.join(PLAYLIST_NAME);
    push(&[
        "-max_muxing_queue_size", "4096",
        "-f", "hls",
        "-hls_time", &SEGMENT_SECONDS.to_string(),
        "-hls_list_size", "0",
        "-hls_playlist_type", "event",
        "-hls_segment_type", "fmp4",
        "-hls_fmp4_init_filename", "init.mp4",
        "-hls_segment_filename", &segment_pattern.to_string_lossy(),
        &playlist.to_string_lossy(),
    ]);
    a
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decision::{plan, PlanOptions};
    use crate::probe::parse_ffprobe_json;
    use std::path::PathBuf;

    const MKV: &str = r#"{
      "streams": [
        {"index":0,"codec_name":"hevc","codec_type":"video","pix_fmt":"yuv420p10le"},
        {"index":1,"codec_name":"ac3","codec_type":"audio","disposition":{"default":1}},
        {"index":2,"codec_name":"aac","codec_type":"audio"}
      ],
      "format": {"format_name":"matroska,webm","duration":"100"}
    }"#;

    fn args_for(opts: PlanOptions, start: f64, encoder: VideoEncoder) -> Vec<String> {
        let info = parse_ffprobe_json(MKV).unwrap();
        let p = plan(&info, opts);
        let input = PathBuf::from("/Volumes/T9/Pelis/película con espacios.mkv");
        let out = PathBuf::from("/tmp/ikusi/s1");
        build_hls_args(&HlsJob { input: &input, out_dir: &out, info: &info, plan: &p, start, encoder })
    }

    fn has_pair(args: &[String], k: &str, v: &str) -> bool {
        args.windows(2).any(|w| w[0] == k && w[1] == v)
    }

    #[test]
    fn remux_copies_hevc_with_tag_and_converts_ac3() {
        let a = args_for(PlanOptions::default(), 0.0, VideoEncoder::Libx264);
        assert!(has_pair(&a, "-c:v", "copy"));
        assert!(has_pair(&a, "-tag:v", "hvc1"));
        assert!(has_pair(&a, "-c:a", "aac"));
        assert!(has_pair(&a, "-map", "0:V:0"));
        assert!(has_pair(&a, "-map", "0:1"), "pista por defecto (AC3, stream 1)");
        assert!(!a.iter().any(|x| x == "-ss"), "sin salto si start = 0");
        assert!(has_pair(&a, "-i", "/Volumes/T9/Pelis/película con espacios.mkv"), "la ruta va como un solo argumento");
        assert_eq!(a.last().unwrap(), "/tmp/ikusi/s1/index.m3u8");
    }

    #[test]
    fn selecting_second_audio_maps_absolute_stream_and_copies_aac() {
        let a = args_for(PlanOptions { audio_track: Some(1), ..Default::default() }, 0.0, VideoEncoder::Libx264);
        assert!(has_pair(&a, "-map", "0:2"));
        assert!(has_pair(&a, "-c:a", "copy"));
    }

    #[test]
    fn transcode_uses_videotoolbox_on_mac_and_seeks_before_input() {
        let a = args_for(PlanOptions { force_transcode: true, ..Default::default() }, 754.5, VideoEncoder::VideoToolbox);
        assert!(has_pair(&a, "-c:v", "h264_videotoolbox"));
        assert!(has_pair(&a, "-ss", "754.500"));
        let ss = a.iter().position(|x| x == "-ss").unwrap();
        let i = a.iter().position(|x| x == "-i").unwrap();
        assert!(ss < i);
        assert!(!a.iter().any(|x| x == "-tag:v"));
    }

    #[test]
    fn transcode_with_libx264_elsewhere() {
        let a = args_for(PlanOptions { force_transcode: true, ..Default::default() }, 0.0, VideoEncoder::Libx264);
        assert!(has_pair(&a, "-c:v", "libx264"));
        assert!(has_pair(&a, "-force_key_frames", "expr:gte(t,n_forced*4)"));
    }
}
