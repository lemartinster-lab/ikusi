//! Generación de subtítulos con Whisper en local (whisper.cpp, `brew install
//! whisper-cpp`).
//!
//! 1. ffmpeg extrae la pista de audio elegida a WAV mono de 16 kHz (lo que
//!    pide Whisper), informando del avance.
//! 2. `whisper-cli` la transcribe a WebVTT, informando del avance.
//!
//! Los modelos se descargan una vez a la carpeta de datos de la app.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};

use crate::binaries;
use crate::{CoreError, Result};

/// Modelos ofrecidos: (nombre, tamaño aproximado en MB, descripción).
pub const MODELS: [(&str, u32, &str); 4] = [
    ("base", 142, "Rápido, calidad básica"),
    ("small", 466, "Equilibrado (recomendado)"),
    ("medium", 1500, "Mejor calidad, lento en Mac Intel"),
    ("large-v3-turbo", 1600, "La mejor calidad, muy lento en Mac Intel"),
];
pub const DEFAULT_MODEL: &str = "small";

pub fn is_known_model(name: &str) -> bool {
    MODELS.iter().any(|(n, _, _)| *n == name)
}

pub fn model_file_name(name: &str) -> String {
    format!("ggml-{name}.bin")
}

pub fn model_url(name: &str) -> String {
    format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}", model_file_name(name))
}

/// Busca `whisper-cli` (nombre actual de Homebrew) o `whisper-cpp` (antiguo).
pub fn locate_whisper() -> Option<PathBuf> {
    ["whisper-cli", "whisper-cpp"].iter().find_map(|n| binaries::locate_named(n).ok())
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "stage", content = "percent")]
pub enum Stage {
    Downloading(f32),
    ExtractingAudio(f32),
    Transcribing(f32),
}

pub type ProgressFn = Arc<dyn Fn(Stage) + Send + Sync>;

// ------------------------------------------------------------ órdenes

pub fn extract_audio_args(input: &Path, stream_index: Option<u32>, out_wav: &Path) -> Vec<String> {
    let mut a: Vec<String> = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats", "-i"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    a.push(input.to_string_lossy().into_owned());
    a.push("-map".into());
    a.push(stream_index.map(|i| format!("0:{i}")).unwrap_or_else(|| "0:a:0".into()));
    a.extend(["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"].iter().map(|s| s.to_string()));
    a.push(out_wav.to_string_lossy().into_owned());
    a
}

pub fn whisper_args(model: &Path, wav: &Path, language: &str, out_base: &Path, threads: usize) -> Vec<String> {
    vec![
        "-m".into(), model.to_string_lossy().into_owned(),
        "-f".into(), wav.to_string_lossy().into_owned(),
        "-l".into(), language.into(),
        "-t".into(), threads.to_string(),
        // Segmentos de como mucho ~70 caracteres cortados por palabra: líneas de
        // subtítulo legibles en lugar de párrafos.
        "-ml".into(), "70".into(),
        "-sow".into(),
        "-ovtt".into(),
        "-of".into(), out_base.to_string_lossy().into_owned(),
        "-pp".into(),
    ]
}

/// "whisper_print_progress_callback: progress =  42%" → 42.0 (acotado a 100).
pub fn parse_whisper_progress(line: &str) -> Option<f32> {
    let rest = line.split("progress =").nth(1)?;
    let num: String = rest.trim().chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    num.parse::<f32>().ok().map(|p| p.clamp(0.0, 100.0))
}

/// Línea de `ffmpeg -progress`: "out_time_us=12345678" → segundos.
pub fn parse_ffmpeg_progress(line: &str) -> Option<f64> {
    let v = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms="))?;
    v.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0)
}

// ---------------------------------------------------------- ejecución

/// Espera al proceso vigilando la cancelación; lee sus líneas con `on_line`.
async fn run_watched<R>(mut child: Child, output: R, on_line: impl Fn(&str) + Send + 'static, cancel: &AtomicBool) -> Result<()>
where
    R: AsyncRead + Unpin + Send + 'static,
{
    let reader = tokio::spawn(async move {
        let mut lines = BufReader::new(output).lines();
        let mut tail: Vec<String> = Vec::new();
        while let Ok(Some(line)) = lines.next_line().await {
            on_line(&line);
            tail.push(line);
            if tail.len() > 12 {
                tail.remove(0);
            }
        }
        tail.join("\n")
    });
    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill().await;
            return Err(CoreError::Cancelled);
        }
        if let Some(status) = child.try_wait()? {
            let tail = reader.await.unwrap_or_default();
            return if status.success() { Ok(()) } else { Err(CoreError::Ffmpeg(tail)) };
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

pub struct TranscribeJob<'a> {
    pub ffmpeg: &'a Path,
    pub whisper: &'a Path,
    pub model: &'a Path,
    pub input: &'a Path,
    /// Índice absoluto del stream de audio; `None` = primera pista.
    pub audio_stream: Option<u32>,
    /// Código ISO 639-1 ("eu", "es"…) o "auto".
    pub language: &'a str,
    /// Duración del archivo, para calcular el avance de la extracción.
    pub duration: Option<f64>,
    pub work_dir: &'a Path,
}

pub async fn transcribe(job: TranscribeJob<'_>, progress: ProgressFn, cancel: Arc<AtomicBool>) -> Result<String> {
    if !job.model.is_file() {
        return Err(CoreError::Transcription("el modelo de Whisper no está descargado".into()));
    }
    tokio::fs::create_dir_all(job.work_dir).await?;
    let wav = job.work_dir.join("audio.wav");
    let out_base = job.work_dir.join("subtitulos");

    // 1. Extraer audio
    progress(Stage::ExtractingAudio(0.0));
    let mut child = Command::new(job.ffmpeg)
        .args(extract_audio_args(job.input, job.audio_stream, &wav))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()?;
    let stdout = child.stdout.take().expect("stdout");
    let (p, duration) = (progress.clone(), job.duration);
    run_watched(
        child,
        stdout,
        move |line| {
            if let (Some(t), Some(d)) = (parse_ffmpeg_progress(line), duration) {
                p(Stage::ExtractingAudio(((t / d) * 100.0).clamp(0.0, 100.0) as f32));
            }
        },
        &cancel,
    )
    .await
    .map_err(|e| match e {
        CoreError::Ffmpeg(_) => CoreError::Transcription("no se pudo extraer el audio".into()),
        other => other,
    })?;

    // 2. Transcribir
    progress(Stage::Transcribing(0.0));
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    let mut child = Command::new(job.whisper)
        .args(whisper_args(job.model, &wav, job.language, &out_base, threads))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let stderr = child.stderr.take().expect("stderr");
    let p = progress.clone();
    run_watched(
        child,
        stderr,
        move |line| {
            if let Some(pct) = parse_whisper_progress(line) {
                p(Stage::Transcribing(pct));
            }
        },
        &cancel,
    )
    .await
    .map_err(|e| match e {
        CoreError::Ffmpeg(tail) => CoreError::Transcription(format!("Whisper falló: {tail}")),
        other => other,
    })?;

    let vtt = tokio::fs::read_to_string(out_base.with_extension("vtt")).await?;
    let _ = tokio::fs::remove_file(&wav).await;
    progress(Stage::Transcribing(100.0));
    Ok(vtt)
}

/// Descarga un modelo de Whisper a `dir` informando del avance. Escribe en un
/// `.part` y lo renombra al terminar, para no dejar modelos a medias.
pub async fn download_model(name: &str, dir: &Path, progress: ProgressFn, cancel: Arc<AtomicBool>) -> Result<PathBuf> {
    if !is_known_model(name) {
        return Err(CoreError::Transcription(format!("modelo desconocido: {name}")));
    }
    tokio::fs::create_dir_all(dir).await?;
    let dest = dir.join(model_file_name(name));
    let part = dir.join(format!("{}.part", model_file_name(name)));

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| CoreError::Transcription(e.to_string()))?;
    let mut res = client
        .get(model_url(name))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| CoreError::Transcription(format!("no se pudo descargar el modelo: {e}")))?;
    let total = res.content_length();
    let mut file = tokio::fs::File::create(&part).await?;
    let mut received: u64 = 0;
    progress(Stage::Downloading(0.0));
    loop {
        if cancel.load(Ordering::SeqCst) {
            drop(file);
            let _ = tokio::fs::remove_file(&part).await;
            return Err(CoreError::Cancelled);
        }
        let chunk = res
            .chunk()
            .await
            .map_err(|e| CoreError::Transcription(format!("descarga interrumpida: {e}")))?;
        let Some(chunk) = chunk else { break };
        file.write_all(&chunk).await?;
        received += chunk.len() as u64;
        if let Some(t) = total {
            progress(Stage::Downloading((received as f64 / t as f64 * 100.0) as f32));
        }
    }
    file.flush().await?;
    drop(file);
    tokio::fs::rename(&part, &dest).await?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_parsing() {
        assert_eq!(parse_whisper_progress("whisper_print_progress_callback: progress =  42%"), Some(42.0));
        assert_eq!(parse_whisper_progress("whisper_print_progress_callback: progress = 375%"), Some(100.0));
        assert_eq!(parse_whisper_progress("whisper_init: cargando"), None);
        assert_eq!(parse_ffmpeg_progress("out_time_us=12500000"), Some(12.5));
        assert_eq!(parse_ffmpeg_progress("out_time_us=N/A"), None);
        assert_eq!(parse_ffmpeg_progress("speed=10x"), None);
    }

    #[test]
    fn audio_and_whisper_commands() {
        let a = extract_audio_args(Path::new("/v/peli.mkv"), Some(2), Path::new("/t/a.wav"));
        assert!(a.windows(2).any(|w| w == ["-map", "0:2"]));
        assert!(a.windows(2).any(|w| w == ["-ar", "16000"]));
        assert_eq!(a.last().unwrap(), "/t/a.wav");
        let a = extract_audio_args(Path::new("/v/peli.mkv"), None, Path::new("/t/a.wav"));
        assert!(a.windows(2).any(|w| w == ["-map", "0:a:0"]));

        let w = whisper_args(Path::new("/m/ggml-small.bin"), Path::new("/t/a.wav"), "eu", Path::new("/t/subs"), 4);
        assert!(w.windows(2).any(|x| x == ["-l", "eu"]));
        assert!(w.contains(&"-ovtt".to_string()));
        assert!(w.windows(2).any(|x| x == ["-of", "/t/subs"]));
    }

    #[test]
    fn models() {
        assert!(is_known_model("small"));
        assert!(!is_known_model("../../etc"));
        assert_eq!(model_url("base"), "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin");
    }

    #[tokio::test]
    async fn refuses_to_run_without_model() {
        let dir = tempfile::tempdir().unwrap();
        let job = TranscribeJob {
            ffmpeg: Path::new("ffmpeg"),
            whisper: Path::new("whisper-cli"),
            model: &dir.path().join("no.bin"),
            input: Path::new("/x.mkv"),
            audio_stream: None,
            language: "eu",
            duration: None,
            work_dir: dir.path(),
        };
        let err = transcribe(job, Arc::new(|_| {}), Arc::new(AtomicBool::new(false))).await.unwrap_err();
        assert!(err.to_string().contains("no está descargado"));
    }
}
