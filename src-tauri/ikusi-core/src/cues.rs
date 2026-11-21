//! Lectura y escritura de WebVTT como lista de cues, para poder traducir línea a
//! línea sin tocar los tiempos.

#[derive(Debug, Clone, PartialEq)]
pub struct Cue {
    /// Segundos.
    pub start: f64,
    pub end: f64,
    /// Texto, con saltos de línea `\n` si ocupa varias.
    pub text: String,
}

/// "01:02:03.456", "02:03.456" o "02:03,456" → segundos.
pub fn parse_timestamp(s: &str) -> Option<f64> {
    let s = s.trim().replace(',', ".");
    let parts: Vec<&str> = s.split(':').collect();
    let (h, m, sec) = match parts.as_slice() {
        [h, m, s] => (h.parse::<f64>().ok()?, m.parse::<f64>().ok()?, s.parse::<f64>().ok()?),
        [m, s] => (0.0, m.parse::<f64>().ok()?, s.parse::<f64>().ok()?),
        _ => return None,
    };
    Some(h * 3600.0 + m * 60.0 + sec)
}

pub fn format_timestamp(t: f64) -> String {
    let ms_total = (t.max(0.0) * 1000.0).round() as u64;
    let (h, rest) = (ms_total / 3_600_000, ms_total % 3_600_000);
    let (m, rest) = (rest / 60_000, rest % 60_000);
    let (s, ms) = (rest / 1000, rest % 1000);
    format!("{h:02}:{m:02}:{s:02}.{ms:03}")
}

/// Parsea WebVTT (o SRT, que tiene la misma estructura de bloques). Ignora la
/// cabecera, los bloques NOTE/STYLE/REGION y los ajustes de posición.
pub fn parse_vtt(text: &str) -> Vec<Cue> {
    let normalized = text.trim_start_matches('\u{feff}').replace("\r\n", "\n").replace('\r', "\n");
    let mut cues = Vec::new();
    for block in normalized.split("\n\n") {
        let lines: Vec<&str> = block.lines().collect();
        let Some(ti) = lines.iter().position(|l| l.contains("-->")) else { continue };
        let first = lines.first().map(|l| l.trim()).unwrap_or("");
        if first.starts_with("NOTE") || first == "STYLE" || first == "REGION" {
            continue;
        }
        let timing = lines[ti];
        let Some((a, b)) = timing.split_once("-->") else { continue };
        // Tras el tiempo final puede haber ajustes ("line:-3 align:center").
        let b = b.split_whitespace().next().unwrap_or("");
        let (Some(start), Some(end)) = (parse_timestamp(a), parse_timestamp(b)) else { continue };
        let body = lines[ti + 1..].join("\n");
        if body.trim().is_empty() {
            continue;
        }
        cues.push(Cue { start, end, text: body.trim_end().to_string() });
    }
    cues
}

pub fn serialize_vtt(cues: &[Cue]) -> String {
    let mut out = String::from("WEBVTT\n\n");
    for c in cues {
        out.push_str(&format!("{} --> {}\n{}\n\n", format_timestamp(c.start), format_timestamp(c.end), c.text));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps() {
        assert_eq!(parse_timestamp("01:02:03.456"), Some(3723.456));
        assert_eq!(parse_timestamp("02:03.5"), Some(123.5));
        assert_eq!(parse_timestamp("00:00:01,250"), Some(1.25));
        assert_eq!(parse_timestamp("basura"), None);
        assert_eq!(format_timestamp(3723.456), "01:02:03.456");
        assert_eq!(format_timestamp(-1.0), "00:00:00.000");
    }

    #[test]
    fn parses_vtt_ignoring_header_notes_and_settings() {
        let vtt = "\u{feff}WEBVTT - Ikusi\r\n\r\nNOTE esto es un comentario\r\n--> no es un cue\r\n\r\n1\r\n00:00:01.000 --> 00:00:03.000 line:-3 align:center\r\nKaixo!\r\n<i>Zer moduz?</i>\r\n\r\n00:04.000 --> 00:06.000\r\n¿Qué tal?\r\n";
        let cues = parse_vtt(vtt);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0], Cue { start: 1.0, end: 3.0, text: "Kaixo!\n<i>Zer moduz?</i>".into() });
        assert_eq!(cues[1].start, 4.0);
    }

    #[test]
    fn parses_srt_too() {
        let srt = "1\n00:00:01,000 --> 00:00:02,500\nHola\n\n2\n00:00:03,000 --> 00:00:04,000\nAdiós\n";
        let cues = parse_vtt(srt);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].end, 2.5);
    }

    #[test]
    fn roundtrip() {
        let cues = vec![
            Cue { start: 1.0, end: 2.0, text: "Bat".into() },
            Cue { start: 3600.5, end: 3602.0, text: "Bi\nhiru".into() },
        ];
        assert_eq!(parse_vtt(&serialize_vtt(&cues)), cues);
    }
}
