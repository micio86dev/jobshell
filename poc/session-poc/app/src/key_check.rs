//! Checks that a stored API key is accepted by its provider.
//!
//! Each provider has a model-list endpoint that answers for the key without
//! running a judgment or a completion, so the check spends no tokens.

use std::time::Duration;

use serde::Serialize;

use session_poc_core::secrets;

/// The `anthropic-version` header the agent sends too (`ANTHROPIC_VERSION` in job-agent).
const ANTHROPIC_VERSION: &str = "2023-06-01";
const TIMEOUT: Duration = Duration::from_secs(10);

/// One GET request that a provider answers for a key without spending tokens.
#[derive(Debug, PartialEq, Eq)]
pub struct Probe {
    pub url: &'static str,
    pub headers: Vec<(&'static str, String)>,
}

/// The request that checks `key` for `account`, or `None` for an account the app does not know.
pub fn probe_for(account: &str, key: &str) -> Option<Probe> {
    match account {
        "typesafe" => Some(Probe {
            url: "https://api.typesafe.ai/v1/models",
            headers: vec![("Authorization", format!("Bearer {key}"))],
        }),
        "anthropic" => Some(Probe {
            url: "https://api.anthropic.com/v1/models",
            headers: vec![
                ("x-api-key", key.to_string()),
                ("anthropic-version", ANTHROPIC_VERSION.to_string()),
            ],
        }),
        "openai" => Some(Probe {
            url: "https://api.openai.com/v1/models",
            headers: vec![("Authorization", format!("Bearer {key}"))],
        }),
        "gemini" => Some(Probe {
            url: "https://generativelanguage.googleapis.com/v1beta/models",
            headers: vec![("x-goog-api-key", key.to_string())],
        }),
        "qwen" => Some(Probe {
            url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
            headers: vec![("Authorization", format!("Bearer {key}"))],
        }),
        _ => None,
    }
}

/// What the provider said about the key.
#[derive(Debug, PartialEq, Eq)]
pub enum KeyCheck {
    /// The provider accepted the key.
    Valid,
    /// The provider refused the key (401 invalid or expired, 403 not allowed).
    Rejected(u16),
    /// No answer that proves anything either way: network, timeout, or another status.
    Unverified(String),
}

/// Map a provider's HTTP status to what it means for the key.
pub fn classify(status: u16) -> KeyCheck {
    match status {
        200..=299 => KeyCheck::Valid,
        401 | 403 => KeyCheck::Rejected(status),
        other => KeyCheck::Unverified(format!("HTTP {other}")),
    }
}

/// The result as the window shows it. It never carries the key.
#[derive(Debug, Serialize)]
pub struct KeyCheckReport {
    pub account: String,
    pub outcome: &'static str,
    pub status: Option<u16>,
    pub detail: String,
}

pub fn report_for(account: &str, check: KeyCheck) -> KeyCheckReport {
    match check {
        KeyCheck::Valid => KeyCheckReport { account: account.to_string(), outcome: "valid", status: None, detail: String::new() },
        KeyCheck::Rejected(status) => KeyCheckReport {
            account: account.to_string(),
            outcome: "rejected",
            status: Some(status),
            detail: "the provider does not accept this key: it is wrong, expired or revoked".to_string(),
        },
        KeyCheck::Unverified(detail) => KeyCheckReport { account: account.to_string(), outcome: "unverified", status: None, detail },
    }
}

/// Send the probe for `key` and classify the answer.
pub fn check_key(account: &str, key: &str) -> Result<KeyCheck, String> {
    let probe = probe_for(account, key).ok_or_else(|| format!("unknown key account: {account}"))?;
    let mut request = ureq::get(probe.url).timeout(TIMEOUT);
    for (name, value) in &probe.headers {
        request = request.set(name, value);
    }
    match request.call() {
        Ok(response) => Ok(classify(response.status())),
        Err(ureq::Error::Status(status, _)) => Ok(classify(status)),
        Err(ureq::Error::Transport(error)) => Ok(KeyCheck::Unverified(format!("no answer from the provider: {}", error.kind()))),
    }
}

/// The model names in a provider's model-list answer, sorted and without duplicates.
/// Anything that is not the expected list is an error, never an empty list.
pub fn parse_model_names(account: &str, body: &str) -> Result<Vec<String>, String> {
    let value: serde_json::Value = serde_json::from_str(body).map_err(|_| format!("{account}: the answer is not JSON"))?;
    let mut names: Vec<String> = match account {
        "openai" | "anthropic" | "qwen" => list_of(&value, "data", "id", account)?,
        "gemini" => list_of(&value, "models", "name", account)?
            .into_iter()
            .map(|name| name.strip_prefix("models/").map(str::to_string).unwrap_or(name))
            .collect(),
        "typesafe" => list_of(&value, "models", "name", account)?,
        _ => return Err(format!("{account}: no model list is known for this service")),
    };
    names.sort();
    names.dedup();
    Ok(names)
}

fn list_of(value: &serde_json::Value, field: &str, key: &str, account: &str) -> Result<Vec<String>, String> {
    let items = value
        .get(field)
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| format!("{account}: the answer has no {field} list"))?;
    items
        .iter()
        .map(|item| {
            item.get(key)
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
                .ok_or_else(|| format!("{account}: a model has no {key}"))
        })
        .collect()
}

/// Ask the provider for its model names with the given key. The key is not part of any error.
pub fn fetch_model_names(account: &str, key: &str) -> Result<Vec<String>, String> {
    let probe = probe_for(account, key).ok_or_else(|| format!("unknown key account: {account}"))?;
    let mut request = ureq::get(probe.url).timeout(TIMEOUT);
    for (name, value) in &probe.headers {
        request = request.set(name, value);
    }
    let response = request.call().map_err(|error| match error {
        ureq::Error::Status(status, _) => format!("{account} answered HTTP {status}"),
        ureq::Error::Transport(error) => format!("no answer from {account}: {}", error.kind()),
    })?;
    let body = response.into_string().map_err(|_| format!("{account}: the answer could not be read"))?;
    parse_model_names(account, &body)
}

/// Check the key stored for `account` in the OS keyring. A missing key is a report, not an error.
pub fn verify_stored_key(account: &str) -> Result<KeyCheckReport, String> {
    let Some(key) = secrets::read_secret(account).map_err(|error| error.to_string())? else {
        return Ok(KeyCheckReport { account: account.to_string(), outcome: "missing", status: None, detail: String::new() });
    };
    let check = check_key(account, key.trim())?;
    Ok(report_for(account, check))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typesafe_is_checked_on_its_model_list_with_a_bearer_token() {
        let probe = probe_for("typesafe", "tk-123").expect("typesafe is a known account");
        assert_eq!(probe.url, "https://api.typesafe.ai/v1/models");
        assert!(probe.headers.contains(&("Authorization", "Bearer tk-123".to_string())));
    }

    #[test]
    fn anthropic_is_checked_with_its_key_header_and_api_version() {
        let probe = probe_for("anthropic", "sk-ant-1").expect("anthropic is a known account");
        assert_eq!(probe.url, "https://api.anthropic.com/v1/models");
        assert!(probe.headers.contains(&("x-api-key", "sk-ant-1".to_string())));
        assert!(probe.headers.iter().any(|(name, _)| *name == "anthropic-version"));
    }

    #[test]
    fn qwen_is_checked_on_its_openai_compatible_model_list() {
        let probe = probe_for("qwen", "sk-q").expect("qwen is a known account");
        assert_eq!(probe.url, "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models");
        assert!(probe.headers.contains(&("Authorization", "Bearer sk-q".to_string())));
    }

    #[test]
    fn openai_is_checked_on_its_model_list_with_a_bearer_token() {
        let probe = probe_for("openai", "sk-o").expect("openai is a known account");
        assert_eq!(probe.url, "https://api.openai.com/v1/models");
        assert!(probe.headers.contains(&("Authorization", "Bearer sk-o".to_string())));
    }

    #[test]
    fn gemini_is_checked_with_a_header_so_the_key_stays_out_of_the_url() {
        let probe = probe_for("gemini", "AIza-secret").expect("gemini is a known account");
        assert_eq!(probe.url, "https://generativelanguage.googleapis.com/v1beta/models");
        assert!(probe.headers.contains(&("x-goog-api-key", "AIza-secret".to_string())));
        assert!(!probe.url.contains("AIza-secret"));
    }

    #[test]
    fn openai_model_names_are_the_ids_in_data() {
        let body = r#"{"object":"list","data":[{"id":"gpt-b"},{"id":"gpt-a"}]}"#;
        assert_eq!(parse_model_names("openai", body).expect("parse"), vec!["gpt-a", "gpt-b"]);
    }

    #[test]
    fn gemini_model_names_drop_the_models_prefix() {
        let body = r#"{"models":[{"name":"models/gemini-2.5-flash"},{"name":"models/gemini-2.5-pro"}]}"#;
        assert_eq!(
            parse_model_names("gemini", body).expect("parse"),
            vec!["gemini-2.5-flash", "gemini-2.5-pro"]
        );
    }

    #[test]
    fn typesafe_model_names_come_from_its_model_list() {
        let body = r#"{"models":[{"name":"jev-1.14.0"},{"name":"jev-latest"}]}"#;
        assert_eq!(parse_model_names("typesafe", body).expect("parse"), vec!["jev-1.14.0", "jev-latest"]);
    }

    #[test]
    fn an_answer_that_is_not_a_model_list_is_an_error_not_an_empty_list() {
        assert!(parse_model_names("openai", "<html>oops</html>").is_err());
        assert!(parse_model_names("gemini", r#"{"models":"nope"}"#).is_err());
    }

    #[test]
    fn a_service_without_a_known_model_list_is_refused() {
        assert!(parse_model_names("laya", "{}").is_err());
    }

    #[test]
    fn an_unknown_account_has_no_probe() {
        assert!(probe_for("ziprecruiter", "x").is_none());
    }

    #[test]
    fn success_means_the_key_is_valid() {
        assert_eq!(classify(200), KeyCheck::Valid);
    }

    #[test]
    fn unauthorized_and_forbidden_mean_the_key_is_rejected() {
        assert_eq!(classify(401), KeyCheck::Rejected(401));
        assert_eq!(classify(403), KeyCheck::Rejected(403));
    }

    #[test]
    fn any_other_status_is_unverified_not_rejected() {
        assert_eq!(classify(500), KeyCheck::Unverified("HTTP 500".to_string()));
    }

    #[test]
    fn the_key_never_appears_in_the_report() {
        let report = report_for("typesafe", KeyCheck::Rejected(401));
        let text = format!("{report:?}");
        assert!(!text.contains("tk-123"));
        assert_eq!(report.outcome, "rejected");
        assert_eq!(report.status, Some(401));
    }
}
