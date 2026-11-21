//! Capa Tauri de Ikusi: expone el núcleo (`ikusi-core`) como comandos para el
//! frontend y gestiona los archivos abiertos desde el Finder.

mod ai;
mod secrets;

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use ikusi_core::binaries::Binaries;
use ikusi_core::decision::PlanOptions;
use ikusi_core::ffmpeg_args::VideoEncoder;
use ikusi_core::probe::MediaInfo;
use ikusi_core::session::{PlaybackManager, PlaybackSource};
use ikusi_core::subtitles;
use serde::Serialize;
use tauri::{Manager, RunEvent, State};
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::Emitter;

/// El gestor de reproducción se crea al arrancar; si ffmpeg no está instalado
/// se guarda el error para mostrarlo en la interfaz en lugar de cerrar la app.
pub(crate) struct AppState {
    manager: Result<Arc<PlaybackManager>, String>,
    /// Archivos recibidos («Abrir con…») antes de que el frontend estuviera listo.
    pending_open: Mutex<Vec<String>>,
    /// Tarea de IA en curso (solo una a la vez) y su indicador de cancelación.
    ai_busy: Arc<AtomicBool>,
    ai_cancel: Arc<AtomicBool>,
}

impl AppState {
    pub(crate) fn manager(&self) -> Result<Arc<PlaybackManager>, String> {
        self.manager.clone()
    }
}

#[tauri::command]
async fn probe_media(state: State<'_, AppState>, path: String) -> Result<MediaInfo, String> {
    let m = state.manager()?;
    m.probe(&PathBuf::from(path)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_media(
    state: State<'_, AppState>,
    path: String,
    audio_track: Option<usize>,
    start: Option<f64>,
    force_transcode: Option<bool>,
) -> Result<PlaybackSource, String> {
    let m = state.manager()?;
    let file = PathBuf::from(&path);
    let opts = PlanOptions { audio_track, force_transcode: force_transcode.unwrap_or(false) };
    m.open(&file, opts, start.unwrap_or(0.0)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn stop_playback(state: State<'_, AppState>) -> Result<(), String> {
    if let Ok(m) = state.manager() {
        m.stop().await;
    }
    Ok(())
}

#[tauri::command]
async fn extract_subtitle(state: State<'_, AppState>, path: String, stream_index: u32) -> Result<String, String> {
    let m = state.manager()?;
    let file = PathBuf::from(path);
    let info = m.probe(&file).await.map_err(|e| e.to_string())?;
    let stream = info
        .subtitles
        .iter()
        .find(|s| s.index == stream_index)
        .ok_or_else(|| "Pista de subtítulos no encontrada".to_string())?;
    subtitles::extract_embedded(&m.binaries().ffmpeg, &file, stream).await.map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct SubtitleFile {
    /// "srt" o "vtt" (los .ass/.ssa llegan ya convertidos a "vtt").
    format: String,
    text: String,
}

#[tauri::command]
async fn load_subtitle_file(state: State<'_, AppState>, path: String) -> Result<SubtitleFile, String> {
    let file = PathBuf::from(&path);
    let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    match ext.as_str() {
        "srt" | "vtt" => {
            let bytes = tokio::fs::read(&file).await.map_err(|e| e.to_string())?;
            Ok(SubtitleFile { format: ext, text: subtitles::decode_text(&bytes) })
        }
        "ass" | "ssa" => {
            let m = state.manager()?;
            let text = subtitles::convert_file_to_vtt(&m.binaries().ffmpeg, &file).await.map_err(|e| e.to_string())?;
            Ok(SubtitleFile { format: "vtt".into(), text })
        }
        _ => Err(format!("Formato de subtítulos no admitido: .{ext}")),
    }
}

#[tauri::command]
fn take_pending_files(state: State<'_, AppState>) -> Vec<String> {
    std::mem::take(&mut *state.pending_open.lock().unwrap())
}

#[tauri::command]
fn backend_status(state: State<'_, AppState>) -> Option<String> {
    state.manager.as_ref().err().cloned()
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            secrets::preload();
            let manager = tauri::async_runtime::block_on(async {
                let bins = Binaries::locate().map_err(|e| e.to_string())?;
                PlaybackManager::new(bins, VideoEncoder::platform_default())
                    .await
                    .map(Arc::new)
                    .map_err(|e| e.to_string())
            });
            if let Err(e) = &manager {
                eprintln!("Ikusi: {e}");
            }
            // Archivos pasados por línea de comandos (`ikusi peli.mkv`).
            let cli_files: Vec<String> = std::env::args()
                .skip(1)
                .filter(|a| !a.starts_with('-') && std::path::Path::new(a).is_file())
                .collect();
            app.manage(AppState {
                manager,
                pending_open: Mutex::new(cli_files),
                ai_busy: Arc::new(AtomicBool::new(false)),
                ai_cancel: Arc::new(AtomicBool::new(false)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            probe_media,
            open_media,
            stop_playback,
            extract_subtitle,
            load_subtitle_file,
            take_pending_files,
            backend_status,
            ai::api_key_status,
            ai::set_api_key,
            ai::delete_api_key,
            ai::translate_subtitles,
            ai::whisper_status,
            ai::download_whisper_model,
            ai::transcribe_media,
            ai::cancel_ai_task,
            ai::save_text_file
        ])
        .build(tauri::generate_context!())
        .expect("error al iniciar Ikusi");

    app.run(|handle, event| match event {
        // macOS: archivos abiertos con «Abrir con… > Ikusi» o arrastrados al icono del Dock.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        RunEvent::Opened { urls } => {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            if paths.is_empty() {
                return;
            }
            let state = handle.state::<AppState>();
            state.pending_open.lock().unwrap().extend(paths.clone());
            let _ = handle.emit("ikusi://open-files", paths);
        }
        RunEvent::Exit => {
            if let Ok(m) = handle.state::<AppState>().manager() {
                tauri::async_runtime::block_on(m.shutdown());
            }
        }
        _ => {}
    });
}
