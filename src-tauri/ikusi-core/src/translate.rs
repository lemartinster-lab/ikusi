//! Traducción de subtítulos con Claude.
//!
//! - Los cues se envían en bloques de [`CHUNK_SIZE`] con unas líneas previas
//!   como contexto, varios bloques en paralelo.
//! - Claude devuelve JSON `{"lines":[{"id":..,"text":..}]}`; se exige que vuelvan
//!   exactamente los mismos ids. Si no cuadran (o el JSON está mal, o la API
//!   está saturada) se reintenta ese bloque. Así los tiempos nunca se desajustan:
//!   solo se sustituye el texto de cada cue.
//! - El cliente HTTP va detrás de [`LlmClient`] para poder testearlo sin red.

use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::cues::Cue;
use crate::{CoreError, Result};

pub const DEFAULT_MODEL: &str = "claude-haiku-5-5";
pub const MODELS: [(&str, &str); 2] = [("claude-haiku-5-5", "Haiku 5.5"), ("claude-sonnet-5-5", "Sonnet 5.5")];

pub const CHUNK_SIZE: usize = 60;
const CONTEXT_LINES: usize = 6;
const CONCURRENCY: usize = 4;
const MAX_ATTEMPTS: u32 = 3;

#[derive(Debug, Clone, PartialEq)]
pub enum LlmError {
    /// Clave inválida o sin permiso: no se reintenta.
    Auth,
    RateLimited,
    Overloaded,
    Http(u16, String),
    Network(String),
}

impl LlmError {
    /// Saturación, límite de ritmo o red: merece la pena reintentar. Clave
    /// inválida o petición mal formada (4xx): no.
    fn retryable(&self) -> bool {
        matches!(self, LlmError::RateLimited | LlmError::Overloaded | LlmError::Network(_))
    }

    fn message(&self) -> String {
        match self {
            LlmError::Auth => "La clave de API de Anthropic no es válida o no tiene permiso".into(),
            LlmError::RateLimited => "Demasiadas peticiones a la API de Anthropic; prueba en un momento".into(),
            LlmError::Overloaded => "La API de Anthropic está saturada; prueba en un momento".into(),
            LlmError::Http(code, body) => format!("La API de Anthropic respondió {code}: {body}"),
            LlmError::Network(e) => format!("Sin conexión con la API de Anthropic: {e}"),
        }
    }
}

/// Un modelo que recibe un prompt de sistema y un mensaje y devuelve texto.
pub trait LlmClient: Send + Sync + 'static {
    fn complete(&self, system: String, user: String) -> impl Future<Output = std::result::Result<String, LlmError>> + Send;
}

// ------------------------------------------------------------------ prompts

/// Nombre del idioma para el prompt (en inglés, que es como mejor sigue Claude
/// las instrucciones; la traducción en sí va al idioma pedido).
pub fn language_name(code: &str) -> String {
    match code {
        "eu" => "Basque (Euskara, standard Batua)".into(),
        "es" => "Spanish (Spain)".into(),
        "en" => "English".into(),
        "fr" => "French".into(),
        "ca" => "Catalan".into(),
        "gl" => "Galician".into(),
        "de" => "German".into(),
        "it" => "Italian".into(),
        "pt" => "Portuguese".into(),
        other => other.to_string(),
    }
}

#[derive(Debug, Clone)]
pub struct TranslateOptions {
    /// Código del idioma original, si se conoce.
    pub source_lang: Option<String>,
    pub target_lang: String,
    /// Título del archivo, como contexto.
    pub title: Option<String>,
}

pub fn system_prompt(opts: &TranslateOptions) -> String {
    let from = opts
        .source_lang
        .as_deref()
        .map(language_name)
        .unwrap_or_else(|| "the original language (detect it)".into());
    let to = language_name(&opts.target_lang);
    format!(
        "You are a professional subtitle translator. Translate each subtitle line from {from} into {to}.\n\
         Rules:\n\
         - Translate meaning and register naturally, as a native subtitler would; keep it concise enough to read on screen.\n\
         - Return exactly one translation per input id. Never merge, split, skip or reorder lines.\n\
         - Keep line breaks (\\n) inside a line where they make sense, proper names, numbers and simple tags like <i>…</i>.\n\
         - The \"context\" lines are only for continuity: do not translate or return them.\n\
         - Reply with JSON only, no commentary: {{\"lines\":[{{\"id\":<id>,\"text\":\"<translation>\"}}]}}"
    )
}

pub fn user_message(title: Option<&str>, context: &[&Cue], chunk: &[(usize, &Cue)]) -> String {
    json!({
        "title": title,
        "context": context.iter().map(|c| c.text.as_str()).collect::<Vec<_>>(),
        "lines": chunk.iter().map(|(id, c)| json!({"id": id, "text": c.text})).collect::<Vec<_>>(),
    })
    .to_string()
}

#[derive(Deserialize)]
struct Reply {
    lines: Vec<ReplyLine>,
}

#[derive(Deserialize)]
struct ReplyLine {
    id: usize,
    text: String,
}

/// Extrae y valida la respuesta: mismo conjunto de ids que se enviaron.
pub fn parse_reply(reply: &str, expected_ids: &[usize]) -> std::result::Result<Vec<String>, String> {
    // Tolerar ```json … ``` o texto alrededor: se toma del primer { al último }.
    let start = reply.find('{').ok_or("la respuesta no contiene JSON")?;
    let end = reply.rfind('}').ok_or("la respuesta no contiene JSON")?;
    let parsed: Reply = serde_json::from_str(&reply[start..=end]).map_err(|e| format!("JSON inválido: {e}"))?;
    if parsed.lines.len() != expected_ids.len() {
        return Err(format!("se esperaban {} líneas y llegaron {}", expected_ids.len(), parsed.lines.len()));
    }
    let mut out = Vec::with_capacity(expected_ids.len());
    for id in expected_ids {
        let line = parsed.lines.iter().find(|l| l.id == *id).ok_or(format!("falta la línea {id}"))?;
        out.push(line.text.trim().to_string());
    }
    Ok(out)
}

// --------------------------------------------------------------- traducción

/// Traduce todos los cues. `progress(hechos, total)` se llama al terminar cada
/// bloque. Si `cancel` se activa, se aborta con [`CoreError::Cancelled`].
pub async fn translate_cues<C: LlmClient>(
    client: Arc<C>,
    cues: &[Cue],
    opts: &TranslateOptions,
    progress: Arc<dyn Fn(usize, usize) + Send + Sync>,
    cancel: Arc<AtomicBool>,
) -> Result<Vec<Cue>> {
    let total = cues.len();
    if total == 0 {
        return Ok(Vec::new());
    }
    let system = system_prompt(opts);
    let semaphore = Arc::new(tokio::sync::Semaphore::new(CONCURRENCY));
    let done = Arc::new(AtomicUsize::new(0));
    let mut set = tokio::task::JoinSet::new();

    for chunk_start in (0..total).step_by(CHUNK_SIZE) {
        let chunk_end = (chunk_start + CHUNK_SIZE).min(total);
        let ids: Vec<usize> = (chunk_start..chunk_end).collect();
        let ctx_start = chunk_start.saturating_sub(CONTEXT_LINES);
        let context: Vec<&Cue> = cues[ctx_start..chunk_start].iter().collect();
        let chunk: Vec<(usize, &Cue)> = ids.iter().map(|i| (*i, &cues[*i])).collect();
        let user = user_message(opts.title.as_deref(), &context, &chunk);

        let (client, system, semaphore, cancel, done, progress) =
            (client.clone(), system.clone(), semaphore.clone(), cancel.clone(), done.clone(), progress.clone());
        set.spawn(async move {
            let _permit = semaphore.acquire_owned().await.expect("semáforo cerrado");
            let texts = translate_chunk(&*client, &system, &user, &ids, &cancel).await?;
            let n = done.fetch_add(ids.len(), Ordering::SeqCst) + ids.len();
            progress(n, total);
            Ok::<_, CoreError>((chunk_start, texts))
        });
    }

    let mut out: Vec<Cue> = cues.to_vec();
    while let Some(joined) = set.join_next().await {
        let (chunk_start, texts) = match joined.map_err(|e| CoreError::Translation(e.to_string()))? {
            Ok(v) => v,
            Err(e) => {
                cancel.store(true, Ordering::SeqCst); // detener los demás bloques
                set.abort_all();
                return Err(e);
            }
        };
        for (i, text) in texts.into_iter().enumerate() {
            out[chunk_start + i].text = text;
        }
    }
    Ok(out)
}

async fn translate_chunk<C: LlmClient>(
    client: &C,
    system: &str,
    user: &str,
    ids: &[usize],
    cancel: &AtomicBool,
) -> Result<Vec<String>> {
    let mut last_error = String::new();
    for attempt in 0..MAX_ATTEMPTS {
        if cancel.load(Ordering::SeqCst) {
            return Err(CoreError::Cancelled);
        }
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(800 * 2u64.pow(attempt - 1))).await;
        }
        match client.complete(system.to_string(), user.to_string()).await {
            Ok(reply) => match parse_reply(&reply, ids) {
                Ok(texts) => return Ok(texts),
                Err(e) => last_error = e,
            },
            Err(e) if !e.retryable() => return Err(CoreError::Api(e.message())),
            Err(e) => last_error = e.message(),
        }
    }
    Err(CoreError::Translation(format!(
        "un bloque de líneas falló {MAX_ATTEMPTS} veces ({last_error})"
    )))
}

/// SHA-256 en hexadecimal de varias partes separadas (para claves de caché).
pub fn hash_parts(parts: &[&[u8]]) -> String {
    let mut h = Sha256::new();
    for p in parts {
        h.update(p);
        h.update([0]);
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Clave de caché: mismo texto de origen, idioma y modelo → misma traducción.
pub fn cache_key(source_vtt: &str, target_lang: &str, model: &str) -> String {
    hash_parts(&[source_vtt.as_bytes(), target_lang.as_bytes(), model.as_bytes()])
}

// ------------------------------------------------------- cliente de Anthropic

pub struct ClaudeClient {
    http: reqwest::Client,
    api_key: String,
    model: String,
    base_url: String,
}

impl ClaudeClient {
    pub fn new(api_key: String, model: String) -> Self {
        Self::with_base_url(api_key, model, "https://api.anthropic.com".into())
    }

    pub fn with_base_url(api_key: String, model: String, base_url: String) -> Self {
        let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(120));
        if base_url.starts_with("http://127.0.0.1") {
            builder = builder.no_proxy(); // servidor local de pruebas
        }
        let http = builder.build().expect("cliente HTTP");
        Self { http, api_key, model, base_url }
    }
}

#[derive(Deserialize)]
struct MessagesResponse {
    content: Vec<ContentBlock>,
}

#[derive(Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: String,
}

impl LlmClient for ClaudeClient {
    fn complete(&self, system: String, user: String) -> impl Future<Output = std::result::Result<String, LlmError>> + Send {
        let req = self
            .http
            .post(format!("{}/v1/messages", self.base_url))
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&json!({
                "model": self.model,
                "max_tokens": 8192,
                "system": system,
                "messages": [{"role": "user", "content": user}],
            }));
        async move {
            let res = req.send().await.map_err(|e| LlmError::Network(e.to_string()))?;
            let status = res.status().as_u16();
            let body = res.text().await.map_err(|e| LlmError::Network(e.to_string()))?;
            match status {
                200 => {
                    let parsed: MessagesResponse =
                        serde_json::from_str(&body).map_err(|e| LlmError::Http(200, e.to_string()))?;
                    Ok(parsed.content.into_iter().filter(|b| b.kind == "text").map(|b| b.text).collect())
                }
                401 | 403 => Err(LlmError::Auth),
                429 => Err(LlmError::RateLimited),
                500 | 502 | 503 | 504 | 529 => Err(LlmError::Overloaded),
                code => Err(LlmError::Http(code, body.chars().take(300).collect())),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn cues(n: usize) -> Vec<Cue> {
        (0..n).map(|i| Cue { start: i as f64, end: i as f64 + 0.9, text: format!("lerroa {i}") }).collect()
    }

    fn opts() -> TranslateOptions {
        TranslateOptions { source_lang: Some("eu".into()), target_lang: "es".into(), title: Some("Proba".into()) }
    }

    /// Falso Claude: "traduce" poniendo el texto en mayúsculas y responde con el
    /// JSON pedido. Permite inyectar fallos.
    struct FakeClaude {
        calls: AtomicUsize,
        fail_first: Mutex<Vec<&'static str>>,
        drop_a_line: bool,
        auth_error: bool,
    }

    impl FakeClaude {
        fn ok() -> Self {
            Self { calls: AtomicUsize::new(0), fail_first: Mutex::new(vec![]), drop_a_line: false, auth_error: false }
        }
    }

    impl LlmClient for FakeClaude {
        fn complete(&self, _system: String, user: String) -> impl Future<Output = std::result::Result<String, LlmError>> + Send {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let injected = self.fail_first.lock().unwrap().pop();
            let (drop_a_line, auth) = (self.drop_a_line, self.auth_error);
            async move {
                if auth {
                    return Err(LlmError::Auth);
                }
                match injected {
                    Some("overloaded") => return Err(LlmError::Overloaded),
                    Some("garbage") => return Ok("Lo siento, no puedo".into()),
                    _ => {}
                }
                let v: serde_json::Value = serde_json::from_str(&user).unwrap();
                let mut lines: Vec<serde_json::Value> = v["lines"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|l| json!({"id": l["id"], "text": l["text"].as_str().unwrap().to_uppercase()}))
                    .collect();
                if drop_a_line {
                    lines.pop();
                }
                Ok(format!("```json\n{}\n```", json!({ "lines": lines })))
            }
        }
    }

    fn no_progress() -> Arc<dyn Fn(usize, usize) + Send + Sync> {
        Arc::new(|_, _| {})
    }

    #[tokio::test]
    async fn translates_all_chunks_keeping_timings() {
        let input = cues(150); // 3 bloques
        let client = Arc::new(FakeClaude::ok());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        let progress: Arc<dyn Fn(usize, usize) + Send + Sync> = Arc::new(move |d, t| seen2.lock().unwrap().push((d, t)));

        let out = translate_cues(client.clone(), &input, &opts(), progress, Arc::new(AtomicBool::new(false)))
            .await
            .unwrap();

        assert_eq!(out.len(), 150);
        for (a, b) in input.iter().zip(&out) {
            assert_eq!((a.start, a.end), (b.start, b.end));
            assert_eq!(b.text, a.text.to_uppercase());
        }
        assert_eq!(client.calls.load(Ordering::SeqCst), 3);
        let mut p = seen.lock().unwrap().clone();
        p.sort();
        assert_eq!(p.last(), Some(&(150, 150)));
    }

    #[tokio::test]
    async fn retries_on_overload_and_bad_json() {
        let client = Arc::new(FakeClaude::ok());
        *client.fail_first.lock().unwrap() = vec!["garbage", "overloaded"];
        let out = translate_cues(client.clone(), &cues(10), &opts(), no_progress(), Arc::new(AtomicBool::new(false)))
            .await
            .unwrap();
        assert_eq!(out[3].text, "LERROA 3");
        assert_eq!(client.calls.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn fails_if_lines_keep_missing() {
        let client = Arc::new(FakeClaude { drop_a_line: true, ..FakeClaude::ok() });
        let err = translate_cues(client.clone(), &cues(5), &opts(), no_progress(), Arc::new(AtomicBool::new(false)))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("se esperaban 5 líneas"), "{err}");
        assert_eq!(client.calls.load(Ordering::SeqCst), MAX_ATTEMPTS as usize);
    }

    #[tokio::test]
    async fn auth_errors_are_not_retried() {
        let client = Arc::new(FakeClaude { auth_error: true, ..FakeClaude::ok() });
        let err = translate_cues(client.clone(), &cues(5), &opts(), no_progress(), Arc::new(AtomicBool::new(false)))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("clave de API"), "{err}");
        assert_eq!(client.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn cancellation_stops_work() {
        let client = Arc::new(FakeClaude::ok());
        let err = translate_cues(client, &cues(5), &opts(), no_progress(), Arc::new(AtomicBool::new(true)))
            .await
            .unwrap_err();
        assert!(matches!(err, CoreError::Cancelled));
    }

    #[test]
    fn reply_parsing_validates_ids() {
        assert_eq!(
            parse_reply(r#"{"lines":[{"id":1,"text":" Hola "},{"id":0,"text":"Kaixo"}]}"#, &[0, 1]).unwrap(),
            vec!["Kaixo", "Hola"]
        );
        assert!(parse_reply(r#"{"lines":[{"id":0,"text":"a"},{"id":7,"text":"b"}]}"#, &[0, 1]).is_err());
        assert!(parse_reply("nada", &[0]).is_err());
    }

    #[test]
    fn prompt_mentions_languages_and_context_is_separate() {
        let p = system_prompt(&opts());
        assert!(p.contains("Basque") && p.contains("Spanish (Spain)"));
        let c = cues(3);
        let msg = user_message(Some("Filma"), &[&c[0]], &[(1, &c[1]), (2, &c[2])]);
        let v: serde_json::Value = serde_json::from_str(&msg).unwrap();
        assert_eq!(v["context"][0], "lerroa 0");
        assert_eq!(v["lines"][1]["id"], 2);
        assert_eq!(v["title"], "Filma");
    }

    #[test]
    fn cache_key_depends_on_all_inputs() {
        let a = cache_key("WEBVTT", "es", DEFAULT_MODEL);
        assert_eq!(a.len(), 64);
        assert_ne!(a, cache_key("WEBVTT", "eu", DEFAULT_MODEL));
        assert_ne!(a, cache_key("WEBVTT", "es", "claude-sonnet-5-5"));
        assert_eq!(a, cache_key("WEBVTT", "es", DEFAULT_MODEL));
    }

    /// El cliente real contra un servidor local que imita la API de Anthropic:
    /// comprueba cabeceras, cuerpo y la lectura de la respuesta.
    #[tokio::test]
    async fn claude_client_speaks_the_messages_api() {
        use axum::http::HeaderMap;
        use axum::routing::post;
        use axum::{Json, Router};

        let captured: Arc<Mutex<Option<(HeaderMap, serde_json::Value)>>> = Arc::new(Mutex::new(None));
        let cap = captured.clone();
        let app = Router::new().route(
            "/v1/messages",
            post(move |headers: HeaderMap, Json(body): Json<serde_json::Value>| {
                let cap = cap.clone();
                async move {
                    let bad_key = headers.get("x-api-key").map(|v| v != "sk-ant-proba").unwrap_or(true);
                    *cap.lock().unwrap() = Some((headers, body));
                    if bad_key {
                        return (axum::http::StatusCode::UNAUTHORIZED, Json(json!({"type":"error"})));
                    }
                    (
                        axum::http::StatusCode::OK,
                        Json(json!({"content":[{"type":"text","text":"{\"lines\":[]}"}],"stop_reason":"end_turn"})),
                    )
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let client = ClaudeClient::with_base_url("sk-ant-proba".into(), DEFAULT_MODEL.into(), base.clone());
        let text = client.complete("sistema".into(), "mensaje".into()).await.unwrap();
        assert_eq!(text, "{\"lines\":[]}");

        let (headers, body) = captured.lock().unwrap().take().unwrap();
        assert_eq!(headers["anthropic-version"], "2023-06-01");
        assert_eq!(body["model"], "claude-haiku-5-5");
        assert_eq!(body["system"], "sistema");
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][0]["content"], "mensaje");

        let bad = ClaudeClient::with_base_url("sk-ant-mala".into(), DEFAULT_MODEL.into(), base);
        assert_eq!(bad.complete("s".into(), "m".into()).await.unwrap_err(), LlmError::Auth);
    }
}
