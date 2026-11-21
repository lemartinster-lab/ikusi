//! Comandos de la fase 2: traducción con Claude, transcripción con Whisper,
//! clave de API y exportación de archivos de texto.
//!
//! Solo hay una tarea de IA a la vez; su avance se emite como evento
//! `ikusi://ai-progress` y se puede cancelar con `cancel_ai_task`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use ikusi_core::cues::{parse_vtt, serialize_vtt};
use ikusi_core::transcribe::{self, Stage, TranscribeJob};
use ikusi_core::translate::{self, cache_key, hash_parts, ClaudeClient, TranslateOptions};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::secrets::{self, KeyStatus};
use crate::AppState;

pub const PROGRESS_EVENT: &str = "ikusi://ai-progress";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AiProgress {
    /// "translate" | "transcribe" | "download"
    task: &'static str,
    /// "translating" | "extractingAudio" | "transcribing" | "downloading"
    stage: &'static str,
    percent: f32,
}

fn emit(app: &AppHandle, task: &'static str, stage: &'static str, percent: f32) {
    let _ = app.emit(PROGRESS_EVENT, AiProgress { task, stage, percent });
}

/// Marca la tarea de IA como ocupada y la libera al salir (también si falla).
struct BusyGuard(Arc<AtomicBool>);

impl BusyGuard {
    fn acquire(state: &AppState) -> Result<Self, String> {
        if state.ai_busy.swap(true, Ordering::SeqCst) {
            return Err("Ya hay una tarea de IA en marcha; espera a que termine o cancélala".into());
        }
        state.ai_cancel.store(false, Ordering::SeqCst);
        Ok(Self(state.ai_busy.clone()))
    }
}

impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn app_dir(app: &AppHandle, cache: bool, sub: &str) -> Result<PathBuf, String> {
    let base = if cache { app.path().app_cache_dir() } else { app.path().app_data_dir() };
    Ok(base.map_err(|e| e.to_string())?.join(sub))
}

// ------------------------------------------------------------- clave de API

#[tauri::command]
pub fn api_key_status() -> KeyStatus {
    secrets::status()
}

#[tauri::command]
pub fn set_api_key(key: String) -> Result<KeyStatus, String> {
    secrets::set(&key)?;
    Ok(secrets::status())
}

#[tauri::command]
pub fn delete_api_key() -> Result<KeyStatus, String> {
    secrets::delete()?;
    Ok(secrets::status())
}

// ---------------------------------------------------------------- traducción

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn translate_subtitles(
    app: AppHandle,
    state: State<'_, AppState>,
    vtt: String,
    source_lang: Option<String>,
    target_lang: String,
    model: String,
    title: Option<String>,
) -> Result<String, String> {
    if !translate::MODELS.iter().any(|(id, _)| *id == model) {
        return Err(format!("Modelo no admitido: {model}"));
    }
    let (api_key, _) = secrets::get().ok_or("Falta la clave de API de Anthropic: añádela en Ajustes")?;

    let cache_dir = app_dir(&app, true, "translations")?;
    let cache_file = cache_dir.join(format!("{}.vtt", cache_key(&vtt, &target_lang, &model)));
    if let Ok(cached) = tokio::fs::read_to_string(&cache_file).await {
        return Ok(cached);
    }

    let cues = parse_vtt(&vtt);
    if cues.is_empty() {
        return Err("Estos subtítulos no tienen líneas que traducir".into());
    }
    let _busy = BusyGuard::acquire(&state)?;
    emit(&app, "translate", "translating", 0.0);

    let progress_app = app.clone();
    let progress: Arc<dyn Fn(usize, usize) + Send + Sync> = Arc::new(move |done, total| {
        emit(&progress_app, "translate", "translating", done as f32 / total as f32 * 100.0);
    });
    let opts = TranslateOptions { source_lang, target_lang, title };
    let client = Arc::new(ClaudeClient::new(api_key, model));
    let translated = translate::translate_cues(client, &cues, &opts, progress, state.ai_cancel.clone())
        .await
        .map_err(|e| e.to_string())?;

    let out = serialize_vtt(&translated);
    let _ = tokio::fs::create_dir_all(&cache_dir).await;
    let _ = tokio::fs::write(&cache_file, &out).await;
    Ok(out)
}

// ------------------------------------------------------------- transcripción

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelInfo {
    name: &'static str,
    size_mb: u32,
    description: &'static str,
    downloaded: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperStatus {
    /// Ruta de whisper-cli, o null si no está instalado.
    binary: Option<String>,
    models: Vec<WhisperModelInfo>,
}

fn model_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    Ok(app_dir(app, false, "whisper-models")?.join(transcribe::model_file_name(name)))
}

#[tauri::command]
pub fn whisper_status(app: AppHandle) -> Result<WhisperStatus, String> {
    let mut models = Vec::new();
    for (name, size_mb, description) in transcribe::MODELS {
        models.push(WhisperModelInfo { name, size_mb, description, downloaded: model_path(&app, name)?.is_file() });
    }
    Ok(WhisperStatus {
        binary: transcribe::locate_whisper().map(|p| p.to_string_lossy().into_owned()),
        models,
    })
}

#[tauri::command]
pub async fn download_whisper_model(app: AppHandle, state: State<'_, AppState>, name: String) -> Result<(), String> {
    if !transcribe::is_known_model(&name) {
        return Err(format!("Modelo desconocido: {name}"));
    }
    let _busy = BusyGuard::acquire(&state)?;
    let dir = app_dir(&app, false, "whisper-models")?;
    let progress_app = app.clone();
    transcribe::download_model(
        &name,
        &dir,
        Arc::new(move |s| {
            if let Stage::Downloading(p) = s {
                emit(&progress_app, "download", "downloading", p);
            }
        }),
        state.ai_cancel.clone(),
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn transcribe_media(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    audio_track: Option<usize>,
    language: String,
    model: String,
) -> Result<String, String> {
    let whisper = transcribe::locate_whisper()
        .ok_or("No encuentro whisper-cli. Instálalo con: brew install whisper-cpp")?;
    let model_file = model_path(&app, &model)?;
    if !model_file.is_file() {
        return Err(format!("Descarga primero el modelo «{model}» en Ajustes"));
    }
    let manager = state.manager()?;
    let input = PathBuf::from(&path);
    let info = manager.probe(&input).await.map_err(|e| e.to_string())?;
    let track = audio_track.filter(|t| *t < info.audio.len()).unwrap_or(0);
    let stream = info.audio.get(track).map(|a| a.index).ok_or("Este archivo no tiene audio")?;

    // Caché: mismo archivo (ruta, tamaño, fecha), pista, idioma y modelo.
    let meta = std::fs::metadata(&input).map_err(|e| e.to_string())?;
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs());
    let key = hash_parts(&[
        path.as_bytes(),
        meta.len().to_string().as_bytes(),
        format!("{mtime:?}").as_bytes(),
        stream.to_string().as_bytes(),
        language.as_bytes(),
        model.as_bytes(),
    ]);
    let cache_dir = app_dir(&app, true, "transcriptions")?;
    let cache_file = cache_dir.join(format!("{key}.vtt"));
    if let Ok(cached) = tokio::fs::read_to_string(&cache_file).await {
        return Ok(cached);
    }

    let _busy = BusyGuard::acquire(&state)?;
    let work_dir = app_dir(&app, true, "work")?.join(&key[..16]);
    let progress_app = app.clone();
    let result = transcribe::transcribe(
        TranscribeJob {
            ffmpeg: &manager.binaries().ffmpeg,
            whisper: &whisper,
            model: &model_file,
            input: &input,
            audio_stream: Some(stream),
            language: &language,
            duration: info.duration,
            work_dir: &work_dir,
        },
        Arc::new(move |s| match s {
            Stage::ExtractingAudio(p) => emit(&progress_app, "transcribe", "extractingAudio", p),
            Stage::Transcribing(p) => emit(&progress_app, "transcribe", "transcribing", p),
            Stage::Downloading(_) => {}
        }),
        state.ai_cancel.clone(),
    )
    .await;
    let _ = tokio::fs::remove_dir_all(&work_dir).await;
    let vtt = result.map_err(|e| e.to_string())?;

    if parse_vtt(&vtt).is_empty() {
        return Err("Whisper no ha reconocido voz en esta pista".into());
    }
    let _ = tokio::fs::create_dir_all(&cache_dir).await;
    let _ = tokio::fs::write(&cache_file, &vtt).await;
    Ok(vtt)
}

#[tauri::command]
pub fn cancel_ai_task(state: State<'_, AppState>) {
    state.ai_cancel.store(true, Ordering::SeqCst);
}

// ---------------------------------------------------------------- exportar

const EXPORT_EXTENSIONS: [&str; 4] = ["md", "txt", "vtt", "srt"];

/// Guarda texto en la ruta elegida con el diálogo «Guardar». Solo se admiten
/// extensiones de texto, para que la interfaz no pueda sobrescribir otra cosa.
#[tauri::command]
pub async fn save_text_file(path: String, contents: String) -> Result<(), String> {
    let p = Path::new(&path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !EXPORT_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("Solo se pueden guardar archivos {}", EXPORT_EXTENSIONS.join(", ")));
    }
    tokio::fs::write(p, contents).await.map_err(|e| e.to_string())
}
