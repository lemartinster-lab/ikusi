//! Núcleo de Ikusi, independiente de Tauri para poder testearlo con `cargo test`
//! sin necesidad de abrir ventanas.
//!
//! Flujo de reproducción:
//! 1. [`probe`] lee códecs y pistas del archivo con `ffprobe`.
//! 2. [`decision`] decide si se reproduce directo, por remux (HLS sin recodificar
//!    el vídeo) o transcodificando.
//! 3. [`ffmpeg_args`] construye la orden de ffmpeg que genera el HLS.
//! 4. [`session`] lanza ffmpeg y espera al primer segmento.
//! 5. [`server`] sirve los segmentos al `<video>` del webview (WebKit reproduce
//!    HLS de forma nativa en macOS).
//!
//! Fase 2: [`translate`] traduce subtítulos con Claude y [`transcribe`] los
//! genera con Whisper en local; [`cues`] los convierte entre WebVTT y listas.

pub mod binaries;
pub mod cues;
pub mod decision;
pub mod error;
pub mod ffmpeg_args;
pub mod probe;
pub mod server;
pub mod session;
pub mod subtitles;
pub mod transcribe;
pub mod translate;

pub use error::{CoreError, Result};
