//! Gestión de la sesión de reproducción: una sola a la vez (es un reproductor
//! personal), con su proceso de ffmpeg y su carpeta temporal de segmentos.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::binaries::Binaries;
use crate::decision::{plan, Mode, PlanOptions};
use crate::ffmpeg_args::{build_hls_args, HlsJob, VideoEncoder, PLAYLIST_NAME};
use crate::probe::{probe_file, MediaInfo};
use crate::server::{self, ServerHandle};
use crate::{CoreError, Result};

/// Tiempo máximo esperando el primer segmento. Transcodificar el arranque de un
/// 4K en un Mac Intel puede tardar varios segundos.
const READY_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSource {
    pub mode: Mode,
    /// URL que debe cargar el `<video>`: el archivo original (modo directo) o
    /// la lista HLS, ambas servidas por el servidor local.
    pub url: String,
    /// Segundo del archivo original en el que empieza esta fuente. El tiempo real
    /// es `offset + video.currentTime`.
    pub offset: f64,
    pub audio_track: Option<usize>,
    pub info: MediaInfo,
}

struct ActiveSession {
    dir: PathBuf,
    child: Child,
}

pub struct PlaybackManager {
    root: tempfile::TempDir,
    server: ServerHandle,
    bins: Binaries,
    encoder: VideoEncoder,
    current: Mutex<Option<ActiveSession>>,
}

impl PlaybackManager {
    pub async fn new(bins: Binaries, encoder: VideoEncoder) -> Result<Self> {
        let root = tempfile::Builder::new().prefix("ikusi-").tempdir()?;
        let server = server::start(root.path().to_path_buf()).await?;
        Ok(Self { root, server, bins, encoder, current: Mutex::new(None) })
    }

    pub fn binaries(&self) -> &Binaries {
        &self.bins
    }

    pub async fn probe(&self, path: &Path) -> Result<MediaInfo> {
        probe_file(&self.bins.ffprobe, path).await
    }

    /// Prepara la reproducción de `path` empezando en `start` segundos.
    pub async fn open(&self, path: &Path, opts: PlanOptions, start: f64) -> Result<PlaybackSource> {
        let info = self.probe(path).await?;
        let plan = plan(&info, opts);
        self.stop().await;

        if plan.mode == Mode::Direct {
            let url = self.server.register_direct(path);
            return Ok(PlaybackSource { mode: plan.mode, url, offset: 0.0, audio_track: plan.audio_track, info });
        }

        let start = start.max(0.0);
        let id = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
        let dir = self.root.path().join(&id);
        tokio::fs::create_dir_all(&dir).await?;

        let args = build_hls_args(&HlsJob {
            input: path,
            out_dir: &dir,
            info: &info,
            plan: &plan,
            start,
            encoder: self.encoder,
        });
        let log = std::fs::File::create(dir.join("ffmpeg.log"))?;
        let mut child = Command::new(&self.bins.ffmpeg)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::from(log))
            .kill_on_drop(true)
            .spawn()?;

        if let Err(e) = wait_until_ready(&dir, &mut child, READY_TIMEOUT).await {
            let _ = child.kill().await;
            let _ = tokio::fs::remove_dir_all(&dir).await;
            return Err(e);
        }

        *self.current.lock().await = Some(ActiveSession { dir, child });
        Ok(PlaybackSource {
            mode: plan.mode,
            url: self.server.url_for(&id, PLAYLIST_NAME),
            offset: start,
            audio_track: plan.audio_track,
            info,
        })
    }

    /// Detiene ffmpeg, borra los segmentos de la sesión activa y retira el
    /// permiso del archivo directo.
    pub async fn stop(&self) {
        self.server.clear_direct();
        if let Some(mut s) = self.current.lock().await.take() {
            let _ = s.child.kill().await;
            let _ = tokio::fs::remove_dir_all(&s.dir).await;
        }
    }

    /// Limpieza completa al cerrar la app.
    pub async fn shutdown(&self) {
        self.stop().await;
        let _ = tokio::fs::remove_dir_all(self.root.path()).await;
    }
}

/// Espera a que la lista HLS tenga al menos un segmento. Si ffmpeg termina antes
/// (archivo muy corto) se acepta igualmente; si falla, se devuelve el final de
/// su registro como mensaje de error.
async fn wait_until_ready(dir: &Path, child: &mut Child, timeout: Duration) -> Result<()> {
    let playlist = dir.join(PLAYLIST_NAME);
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let has_segment = tokio::fs::read_to_string(&playlist)
            .await
            .map(|t| t.contains("#EXTINF"))
            .unwrap_or(false);
        if has_segment {
            return Ok(());
        }
        if let Some(status) = child.try_wait()? {
            let ready = tokio::fs::read_to_string(&playlist)
                .await
                .map(|t| t.contains("#EXTINF"))
                .unwrap_or(false);
            if status.success() && ready {
                return Ok(());
            }
            return Err(CoreError::Ffmpeg(log_tail(dir).await));
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(CoreError::Timeout);
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

async fn log_tail(dir: &Path) -> String {
    let text = tokio::fs::read_to_string(dir.join("ffmpeg.log")).await.unwrap_or_default();
    let text = text.trim();
    let start = text.char_indices().rev().nth(500).map(|(i, _)| i).unwrap_or(0);
    if text.is_empty() {
        "sin detalles".into()
    } else {
        text[start..].to_string()
    }
}
