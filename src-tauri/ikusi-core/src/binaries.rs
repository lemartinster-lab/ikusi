//! Localización de `ffmpeg` y `ffprobe`.
//!
//! Detalle importante en macOS: una app abierta desde el Finder NO hereda el
//! PATH de la terminal, así que no basta con buscar "ffmpeg" en el PATH. Se
//! prueba, por orden:
//! 1. La variable de entorno `IKUSI_FFMPEG_DIR` (útil para pruebas).
//! 2. La carpeta del propio ejecutable (donde Tauri coloca los sidecars en el
//!    paquete .app de la versión de release).
//! 3. Las rutas habituales de Homebrew (`/usr/local/bin` en Mac Intel,
//!    `/opt/homebrew/bin` en Apple Silicon) y `/usr/bin`.
//! 4. El PATH.

use std::path::{Path, PathBuf};

use crate::{CoreError, Result};

#[derive(Debug, Clone)]
pub struct Binaries {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

impl Binaries {
    pub fn locate() -> Result<Self> {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(Path::to_path_buf));
        let env_dir = std::env::var_os("IKUSI_FFMPEG_DIR").map(PathBuf::from);
        let path_var = std::env::var_os("PATH");
        Ok(Self {
            ffmpeg: find("ffmpeg", env_dir.as_deref(), exe_dir.as_deref(), path_var.as_deref())?,
            ffprobe: find("ffprobe", env_dir.as_deref(), exe_dir.as_deref(), path_var.as_deref())?,
        })
    }
}

const SYSTEM_DIRS: [&str; 3] = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"];

/// Busca el binario `name` en el orden documentado arriba.
pub fn find(
    name: &str,
    env_dir: Option<&Path>,
    exe_dir: Option<&Path>,
    path_var: Option<&std::ffi::OsStr>,
) -> Result<PathBuf> {
    let file_name = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = env_dir {
        candidates.push(dir.join(&file_name));
    }
    if let Some(dir) = exe_dir {
        candidates.push(dir.join(&file_name));
    }
    candidates.extend(SYSTEM_DIRS.iter().map(|d| Path::new(d).join(&file_name)));
    if let Some(path_var) = path_var {
        candidates.extend(std::env::split_paths(path_var).map(|d| d.join(&file_name)));
    }

    candidates
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| CoreError::BinaryNotFound(name.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_env_dir_over_everything_else() {
        let env_dir = tempfile::tempdir().unwrap();
        let exe_dir = tempfile::tempdir().unwrap();
        std::fs::write(env_dir.path().join("fakebin"), b"").unwrap();
        std::fs::write(exe_dir.path().join("fakebin"), b"").unwrap();

        let found = find("fakebin", Some(env_dir.path()), Some(exe_dir.path()), None).unwrap();
        assert_eq!(found, env_dir.path().join("fakebin"));
    }

    #[test]
    fn falls_back_to_exe_dir_then_path() {
        let exe_dir = tempfile::tempdir().unwrap();
        let path_dir = tempfile::tempdir().unwrap();
        std::fs::write(path_dir.path().join("otrobin"), b"").unwrap();

        let path_var = std::env::join_paths([path_dir.path()]).unwrap();
        let found = find("otrobin", None, Some(exe_dir.path()), Some(&path_var)).unwrap();
        assert_eq!(found, path_dir.path().join("otrobin"));

        std::fs::write(exe_dir.path().join("otrobin"), b"").unwrap();
        let found = find("otrobin", None, Some(exe_dir.path()), Some(&path_var)).unwrap();
        assert_eq!(found, exe_dir.path().join("otrobin"));
    }

    #[test]
    fn reports_missing_binary_with_install_hint() {
        let err = find("no-existe-ikusi", None, None, None).unwrap_err();
        assert!(err.to_string().contains("brew install ffmpeg"));
    }
}
