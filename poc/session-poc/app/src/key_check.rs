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
