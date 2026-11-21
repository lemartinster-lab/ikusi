//! Prueba de extremo a extremo con ffmpeg real: genera un MKV sintético
//! (H.264 + AC3 + subtítulos SRT), lo analiza, lo prepara por remux y por
//! transcodificación y descarga la lista HLS desde el servidor local.
//!
//! Si ffmpeg no está instalado, la prueba se salta (no falla).

use std::path::{Path, PathBuf};
use std::process::Command;

use ikusi_core::binaries::Binaries;
use ikusi_core::decision::{Mode, PlanOptions};
use ikusi_core::ffmpeg_args::VideoEncoder;
use ikusi_core::session::PlaybackManager;
use ikusi_core::subtitles;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn make_sample_mkv(bins: &Binaries, dir: &Path) -> PathBuf {
    let srt = dir.join("subs.srt");
    std::fs::write(&srt, "1\n00:00:01,000 --> 00:00:03,000\nKaixo, zer moduz?\n\n2\n00:00:04,000 --> 00:00:06,000\n¿Qué tal?\n").unwrap();
    let out = dir.join("muestra.mkv");
    let status = Command::new(&bins.ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .args(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=12"])
        .args(["-f", "lavfi", "-i", "sine=frequency=440:duration=12"])
        .arg("-i")
        .arg(&srt)
        .args(["-map", "0:v", "-map", "1:a", "-map", "2:s"])
        .args(["-c:v", "libx264", "-preset", "ultrafast", "-g", "50", "-pix_fmt", "yuv420p"])
        .args(["-c:a", "ac3", "-c:s", "srt", "-metadata:s:a:0", "language=spa"])
        .arg(&out)
        .status()
        .unwrap();
    assert!(status.success(), "no se pudo generar el MKV de prueba");
    out
}

async fn http_get(url: &str) -> (u16, Vec<u8>) {
    let rest = url.strip_prefix("http://").unwrap();
    let (host, path) = rest.split_once('/').unwrap();
    let mut s = tokio::net::TcpStream::connect(host).await.unwrap();
    let req = format!("GET /{path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    s.write_all(req.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    s.read_to_end(&mut buf).await.unwrap();
    let split = buf.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
    let head = String::from_utf8_lossy(&buf[..split]).to_string();
    let status = head.split_whitespace().nth(1).unwrap().parse().unwrap();
    (status, buf[split + 4..].to_vec())
}

#[tokio::test]
async fn mkv_remux_transcode_and_subtitles() {
    let Ok(bins) = Binaries::locate() else {
        eprintln!("ffmpeg no disponible: prueba omitida");
        return;
    };
    let work = tempfile::tempdir().unwrap();
    let mkv = make_sample_mkv(&bins, work.path());

    let mgr = PlaybackManager::new(bins.clone(), VideoEncoder::Libx264).await.unwrap();

    // --- Análisis ---
    let info = mgr.probe(&mkv).await.unwrap();
    assert_eq!(info.video.as_ref().unwrap().codec, "h264");
    assert_eq!(info.audio[0].codec, "ac3");
    assert_eq!(info.subtitles.len(), 1);
    assert!(info.duration.unwrap() > 11.0);

    // --- Remux: copia el vídeo y convierte el AC3 ---
    let src = mgr.open(&mkv, PlanOptions::default(), 0.0).await.unwrap();
    assert_eq!(src.mode, Mode::Remux);
    let url = src.url.clone();
    let (status, body) = http_get(&url).await;
    assert_eq!(status, 200);
    let playlist = String::from_utf8(body).unwrap();
    assert!(playlist.contains("#EXT-X-MAP:URI=\"init.mp4\""), "{playlist}");
    assert!(playlist.contains("seg_00000.m4s"));

    let init_url = url.replace("index.m3u8", "init.mp4");
    let (status, init) = http_get(&init_url).await;
    assert_eq!(status, 200);
    assert!(init.windows(4).any(|w| w == b"ftyp"), "init.mp4 debe ser un MP4 válido");

    // --- Transcodificación desde el segundo 6 ---
    let src = mgr
        .open(&mkv, PlanOptions { force_transcode: true, ..Default::default() }, 6.0)
        .await
        .unwrap();
    assert_eq!(src.mode, Mode::Transcode);
    assert_eq!(src.offset, 6.0);
    let (status, _) = http_get(&src.url).await;
    assert_eq!(status, 200);

    // La sesión anterior se ha borrado al abrir la nueva.
    let (status, _) = http_get(&url).await;
    assert_eq!(status, 404);

    // --- Subtítulos incrustados a WebVTT ---
    let vtt = subtitles::extract_embedded(&bins.ffmpeg, &mkv, &info.subtitles[0]).await.unwrap();
    assert!(vtt.starts_with("WEBVTT"), "{vtt}");
    assert!(vtt.contains("Kaixo, zer moduz?"));
    assert!(vtt.contains("¿Qué tal?"));

    // --- MP4 compatible: modo directo servido con rangos HTTP ---
    let mp4 = work.path().join("directo.mp4");
    let status = Command::new(&bins.ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .args(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=3"])
        .args(["-f", "lavfi", "-i", "sine=duration=3"])
        .args(["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"])
        .arg(&mp4)
        .status()
        .unwrap();
    assert!(status.success());
    let src = mgr.open(&mp4, PlanOptions::default(), 0.0).await.unwrap();
    assert_eq!(src.mode, Mode::Direct);
    assert!(src.url.ends_with("/media.mp4"), "{}", src.url);
    let (status, body) = http_get(&src.url).await;
    assert_eq!(status, 200);
    assert_eq!(body.len() as u64, std::fs::metadata(&mp4).unwrap().len());

    // Al parar, el archivo deja de estar accesible.
    mgr.stop().await;
    assert_eq!(http_get(&src.url).await.0, 404);

    mgr.shutdown().await;
}
