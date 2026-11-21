use thiserror::Error;

/// Errores del núcleo. Los mensajes están en español porque llegan tal cual a la
/// interfaz como aviso al usuario.
#[derive(Debug, Error)]
pub enum CoreError {
    #[error("No se encuentra {0}. Instálalo con `brew install ffmpeg` o ejecuta `pnpm ffmpeg:fetch`.")]
    BinaryNotFound(String),

    #[error("No se pudo analizar el archivo: {0}")]
    Probe(String),

    #[error("ffmpeg falló: {0}")]
    Ffmpeg(String),

    #[error("El archivo no contiene pistas reproducibles")]
    NoPlayableStreams,

    #[error("Los subtítulos de esta pista son de imagen (PGS/DVD) y aún no se pueden mostrar")]
    BitmapSubtitles,

    #[error("Tiempo de espera agotado preparando la reproducción")]
    Timeout,

    #[error("Cancelado")]
    Cancelled,

    #[error("{0}")]
    Api(String),

    #[error("La traducción falló: {0}")]
    Translation(String),

    #[error("La transcripción falló: {0}")]
    Transcription(String),

    #[error("Error de entrada/salida: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON inválido de ffprobe: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, CoreError>;
