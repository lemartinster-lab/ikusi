//! Clave de API de Anthropic guardada en el Llavero de macOS (o el almacén
//! seguro del sistema en otras plataformas). La clave nunca llega a la
//! interfaz web: las llamadas a Claude se hacen desde Rust.
//!
//! En desarrollo también se acepta la variable de entorno `ANTHROPIC_API_KEY`.
//!
//! La clave se lee del almacén una vez (al arrancar, desde el hilo principal) y
//! se guarda en memoria: así macOS no pide permiso del Llavero en cada
//! traducción, y en Linux se evita que el almacén del kernel no sea visible
//! desde los hilos de trabajo.

use std::sync::{Mutex, OnceLock};

use serde::Serialize;

const SERVICE: &str = "com.lemartinster.ikusi";
const ACCOUNT: &str = "anthropic-api-key";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    pub configured: bool,
    /// "keychain" o "env".
    pub source: Option<&'static str>,
    /// Últimos 4 caracteres, para reconocerla sin mostrarla.
    pub hint: Option<String>,
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Llavero no disponible: {e}"))
}

fn cache() -> &'static Mutex<Option<String>> {
    static CACHE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn read_store() -> Option<String> {
    entry().ok().and_then(|e| e.get_password().ok()).filter(|k| !k.trim().is_empty())
}

/// Carga la clave del almacén a memoria. Se llama al arrancar la app.
pub fn preload() {
    if let Some(k) = read_store() {
        *cache().lock().unwrap() = Some(k);
    }
}

pub fn get() -> Option<(String, &'static str)> {
    let mut cached = cache().lock().unwrap();
    if cached.is_none() {
        *cached = read_store();
    }
    if let Some(k) = cached.clone() {
        return Some((k, "keychain"));
    }
    std::env::var("ANTHROPIC_API_KEY").ok().filter(|k| !k.trim().is_empty()).map(|k| (k, "env"))
}

pub fn status() -> KeyStatus {
    match get() {
        Some((k, source)) => KeyStatus {
            configured: true,
            source: Some(source),
            hint: Some(k.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect()),
        },
        None => KeyStatus { configured: false, source: None, hint: None },
    }
}

pub fn set(key: &str) -> Result<(), String> {
    let key = key.trim();
    if !key.starts_with("sk-ant-") || key.len() < 20 {
        return Err("Eso no parece una clave de API de Anthropic (empiezan por «sk-ant-»)".into());
    }
    entry()?.set_password(key).map_err(|e| format!("No se pudo guardar en el Llavero: {e}"))?;
    *cache().lock().unwrap() = Some(key.to_string());
    Ok(())
}

pub fn delete() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {
            *cache().lock().unwrap() = None;
            Ok(())
        }
        Err(e) => Err(format!("No se pudo borrar del Llavero: {e}")),
    }
}
