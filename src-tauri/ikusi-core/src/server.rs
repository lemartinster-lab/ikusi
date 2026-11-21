//! Servidor HTTP mínimo en `127.0.0.1` que entrega el contenido al `<video>`:
//!
//! - `/{token}/{sesión}/{archivo}`: lista y segmentos HLS de la carpeta temporal.
//! - `/{token}/f/{id}/{nombre}`: el archivo original en modo directo, con
//!   soporte de rangos HTTP (necesario para saltar dentro de un MP4).
//!
//! Servir también el modo directo por aquí (en lugar del protocolo `asset://` de
//! Tauri) da un único camino para todos los modos y funciona igual en macOS,
//! Linux y Windows.
//!
//! Seguridad: escucha solo en local, en un puerto aleatorio, y exige un token
//! aleatorio en la ruta para que otros programas del equipo no puedan leer
//! archivos. En modo directo solo se sirve el archivo registrado en ese momento
//! (por un id aleatorio, nunca por ruta), y los nombres HLS se validan para
//! impedir salir de la carpeta temporal (`../`).

use std::collections::HashMap;
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::extract::{Path as AxPath, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::net::TcpListener;
use tokio_util::io::ReaderStream;

struct ServerState {
    root: PathBuf,
    token: String,
    /// Archivos servibles en modo directo: id aleatorio → ruta.
    direct: Mutex<HashMap<String, PathBuf>>,
}

#[derive(Clone)]
pub struct ServerHandle {
    pub port: u16,
    pub token: String,
    state: Arc<ServerState>,
}

impl ServerHandle {
    pub fn url_for(&self, session: &str, file: &str) -> String {
        format!("http://127.0.0.1:{}/{}/{}/{}", self.port, self.token, session, file)
    }

    /// Autoriza `path` para el modo directo (sustituyendo al anterior) y
    /// devuelve su URL. El nombre final de la URL es solo informativo; la
    /// extensión ayuda a WebKit a reconocer el formato.
    pub fn register_direct(&self, path: &Path) -> String {
        let id = uuid::Uuid::new_v4().simple().to_string();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("bin").to_lowercase();
        let ext: String = ext.chars().filter(char::is_ascii_alphanumeric).take(8).collect();
        let mut map = self.state.direct.lock().unwrap();
        map.clear();
        map.insert(id.clone(), path.to_path_buf());
        format!("http://127.0.0.1:{}/{}/f/{}/media.{}", self.port, self.token, id, ext)
    }

    pub fn clear_direct(&self) {
        self.state.direct.lock().unwrap().clear();
    }
}

/// Solo letras, números, `_`, `-` y `.`, sin empezar por punto. Evita `..`, rutas
/// absolutas y archivos ocultos.
pub fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

pub fn content_type_for(file: &str) -> &'static str {
    match file.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "m3u8" => "application/vnd.apple.mpegurl",
        "m4s" => "video/iso.segment",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "vtt" => "text/vtt; charset=utf-8",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

/// Interpreta una cabecera `Range` (`bytes=inicio-fin`, `bytes=inicio-` o
/// `bytes=-sufijo`) para un archivo de `size` bytes. Devuelve el rango
/// inclusivo, o `None` si no es satisfacible. Con varios rangos se usa el primero.
pub fn parse_range(value: &str, size: u64) -> Option<(u64, u64)> {
    let spec = value.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (start, end) = spec.split_once('-')?;
    if size == 0 {
        return None;
    }
    let last = size - 1;
    if start.is_empty() {
        let suffix: u64 = end.parse().ok()?;
        if suffix == 0 {
            return None;
        }
        return Some((size.saturating_sub(suffix), last));
    }
    let start: u64 = start.parse().ok()?;
    if start > last {
        return None;
    }
    let end = if end.is_empty() { last } else { end.parse::<u64>().ok()?.min(last) };
    (end >= start).then_some((start, end))
}

fn common_headers(res: &mut Response, content_type: &'static str) {
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    // El webview carga desde tauri:// así que hay que permitir el origen cruzado.
    h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
}

async fn serve_hls(
    State(state): State<Arc<ServerState>>,
    AxPath((token, session, file)): AxPath<(String, String, String)>,
) -> Response {
    if token != state.token || !is_safe_name(&session) || !is_safe_name(&file) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let path = state.root.join(&session).join(&file);
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let mut res = bytes.into_response();
            common_headers(&mut res, content_type_for(&file));
            // La lista crece mientras ffmpeg trabaja: nunca cachearla.
            if file.ends_with(".m3u8") {
                res.headers_mut()
                    .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache, no-store"));
            }
            res
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn serve_direct(
    State(state): State<Arc<ServerState>>,
    AxPath((token, id, _name)): AxPath<(String, String, String)>,
    headers: HeaderMap,
) -> Response {
    if token != state.token {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(path) = state.direct.lock().unwrap().get(&id).cloned() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(mut file) = tokio::fs::File::open(&path).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(size) = file.metadata().await.map(|m| m.len()) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let content_type = content_type_for(&path.to_string_lossy());

    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let (status, start, end) = match range.map(|r| parse_range(r, size)) {
        None => (StatusCode::OK, 0, size.saturating_sub(1)),
        Some(Some((s, e))) => (StatusCode::PARTIAL_CONTENT, s, e),
        Some(None) => {
            let mut res = StatusCode::RANGE_NOT_SATISFIABLE.into_response();
            res.headers_mut().insert(
                header::CONTENT_RANGE,
                HeaderValue::from_str(&format!("bytes */{size}")).unwrap(),
            );
            return res;
        }
    };
    let len = if size == 0 { 0 } else { end - start + 1 };
    if file.seek(SeekFrom::Start(start)).await.is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    // Se envía en flujo: nunca se carga el archivo entero en memoria.
    let body = Body::from_stream(ReaderStream::new(file.take(len)));
    let mut res = (status, body).into_response();
    common_headers(&mut res, content_type);
    let h = res.headers_mut();
    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(len));
    if status == StatusCode::PARTIAL_CONTENT {
        h.insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{end}/{size}")).unwrap(),
        );
    }
    res
}

/// Arranca el servidor en segundo plano y devuelve el puerto y el token.
pub async fn start(root: PathBuf) -> std::io::Result<ServerHandle> {
    let token = uuid::Uuid::new_v4().simple().to_string();
    let state = Arc::new(ServerState { root, token: token.clone(), direct: Mutex::new(HashMap::new()) });
    let app = Router::new()
        .route("/{token}/f/{id}/{name}", get(serve_direct))
        .route("/{token}/{session}/{file}", get(serve_hls))
        .with_state(state.clone());

    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Ok(ServerHandle { port, token, state })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    #[test]
    fn rejects_traversal_and_odd_names() {
        assert!(is_safe_name("seg_00001.m4s"));
        assert!(is_safe_name("index.m3u8"));
        assert!(is_safe_name("3f2a-b"));
        assert!(!is_safe_name(".."));
        assert!(!is_safe_name("../secreto"));
        assert!(!is_safe_name("a/b"));
        assert!(!is_safe_name(".oculto"));
        assert!(!is_safe_name(""));
        assert!(!is_safe_name("a%2f..%2fb"));
    }

    #[test]
    fn content_types() {
        assert_eq!(content_type_for("index.m3u8"), "application/vnd.apple.mpegurl");
        assert_eq!(content_type_for("seg_00000.m4s"), "video/iso.segment");
        assert_eq!(content_type_for("/Users/yo/Peli.MP4"), "video/mp4");
        assert_eq!(content_type_for("canción.flac"), "audio/flac");
    }

    #[test]
    fn range_parsing() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=500-", 1000), Some((500, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=900-5000", 1000), Some((900, 999)), "fin recortado al tamaño");
        assert_eq!(parse_range("bytes=0-1, 5-6", 1000), Some((0, 1)));
        assert_eq!(parse_range("bytes=1000-", 1000), None, "inicio fuera del archivo");
        assert_eq!(parse_range("bytes=50-10", 1000), None);
        assert_eq!(parse_range("bytes=-0", 1000), None);
        assert_eq!(parse_range("items=0-1", 1000), None);
        assert_eq!(parse_range("bytes=0-", 0), None);
    }

    pub async fn http_get(port: u16, path: &str, extra: &str) -> (u16, String, Vec<u8>) {
        let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{extra}Connection: close\r\n\r\n");
        s.write_all(req.as_bytes()).await.unwrap();
        let mut buf = Vec::new();
        s.read_to_end(&mut buf).await.unwrap();
        let split = buf.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let head = String::from_utf8_lossy(&buf[..split]).to_lowercase();
        let status = head.split_whitespace().nth(1).unwrap().parse().unwrap();
        (status, head, buf[split + 4..].to_vec())
    }

    #[tokio::test]
    async fn serves_hls_files_only_with_valid_token() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("s1")).unwrap();
        std::fs::write(root.path().join("s1/index.m3u8"), "#EXTM3U\n").unwrap();
        std::fs::write(root.path().join("secreto.txt"), "no").unwrap();

        let h = start(root.path().to_path_buf()).await.unwrap();

        let (status, head, body) = http_get(h.port, &format!("/{}/s1/index.m3u8", h.token), "").await;
        assert_eq!(status, 200);
        assert_eq!(body, b"#EXTM3U\n");
        assert!(head.contains("application/vnd.apple.mpegurl"));
        assert!(head.contains("access-control-allow-origin: *"));

        assert_eq!(http_get(h.port, "/token-falso/s1/index.m3u8", "").await.0, 404);
        assert_eq!(http_get(h.port, &format!("/{}/s1/no-existe.m4s", h.token), "").await.0, 404);
        assert_eq!(http_get(h.port, &format!("/{}/%2E%2E/secreto.txt", h.token), "").await.0, 404);
    }

    #[tokio::test]
    async fn serves_direct_file_with_ranges() {
        let root = tempfile::tempdir().unwrap();
        let media = root.path().join("Película.mp4");
        let data: Vec<u8> = (0..=255u8).cycle().take(10_000).collect();
        std::fs::write(&media, &data).unwrap();

        let h = start(root.path().join("hls")).await.unwrap();
        let url = h.register_direct(&media);
        let path = url.split_once(&format!(":{}", h.port)).unwrap().1.to_string();
        assert!(path.ends_with("/media.mp4"));

        // Sin Range: archivo completo
        let (status, head, body) = http_get(h.port, &path, "").await;
        assert_eq!(status, 200);
        assert_eq!(body, data);
        assert!(head.contains("accept-ranges: bytes"));
        assert!(head.contains("content-type: video/mp4"));

        // Con Range: solo el trozo pedido
        let (status, head, body) = http_get(h.port, &path, "Range: bytes=100-199\r\n").await;
        assert_eq!(status, 206);
        assert_eq!(body, &data[100..200]);
        assert!(head.contains("content-range: bytes 100-199/10000"));

        // Rango imposible
        let (status, head, _) = http_get(h.port, &path, "Range: bytes=20000-\r\n").await;
        assert_eq!(status, 416);
        assert!(head.contains("content-range: bytes */10000"));

        // Al registrar otro archivo, el anterior deja de ser accesible
        let other = root.path().join("otra.mp3");
        std::fs::write(&other, b"ID3").unwrap();
        h.register_direct(&other);
        assert_eq!(http_get(h.port, &path, "").await.0, 404);

        h.clear_direct();
    }
}
