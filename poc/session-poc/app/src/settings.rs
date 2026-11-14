//! The provider the user chose, saved as a small JSON file in the app data folder.
//!
//! The file holds names and an address only. Keys never go here: they stay in the OS keychain.
//! The chosen values reach the agent as environment variables, never as arguments or files.

use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

pub const LLM_PROVIDERS: [&str; 4] = ["anthropic", "openai", "gemini", "qwen"];
pub const JUDGMENT_SERVICES: [&str; 3] = ["typesafe", "ollama", "laya"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ProviderSettings {
    pub llm_provider: String,
    pub llm_model: String,
    pub judgment_service: String,
    pub judgment_model: String,
    pub judgment_address: String,
    /// The share of postings that must clear, from 1 to 100. Saved as a percentage.
    pub match_threshold: u8,
}

impl Default for ProviderSettings {
    fn default() -> Self {
        Self {
            llm_provider: "anthropic".to_string(),
            llm_model: "claude-sonnet-5-5".to_string(),
            judgment_service: "typesafe".to_string(),
            judgment_model: "jev-1.14.0".to_string(),
            judgment_address: String::new(),
            match_threshold: 70,
        }
    }
}

impl ProviderSettings {
    /// Refuse a name the agent does not know. The model and address are checked by the agent.
    pub fn validate(&self) -> Result<()> {
        if !LLM_PROVIDERS.contains(&self.llm_provider.as_str()) {
            bail!("unknown LLM provider: {}", self.llm_provider);
        }
        if !JUDGMENT_SERVICES.contains(&self.judgment_service.as_str()) {
            bail!("unknown judgment service: {}", self.judgment_service);
        }
        if self.llm_model.trim().is_empty() {
            bail!("choose a model for {}", self.llm_provider);
        }
        if !(1..=100).contains(&self.match_threshold) {
            bail!("the match threshold must be a whole percentage from 1 to 100");
        }
        Ok(())
    }

    /// The environment the agent reads its choice from. No key is ever part of it.
    pub fn agent_env(&self) -> Vec<(String, String)> {
        vec![
            ("JOBSHELL_LLM_PROVIDER".to_string(), self.llm_provider.clone()),
            ("JOBSHELL_LLM_MODEL".to_string(), self.llm_model.clone()),
            ("JOBSHELL_JUDGMENT_SERVICE".to_string(), self.judgment_service.clone()),
            ("JOBSHELL_JUDGMENT_MODEL".to_string(), self.judgment_model.clone()),
            ("JOBSHELL_JUDGMENT_ADDRESS".to_string(), self.judgment_address.clone()),
            ("JOBSHELL_MATCH_THRESHOLD".to_string(), self.match_threshold.to_string()),
        ]
    }
}

/// Read the saved choice, or the defaults when nothing is saved yet.
pub fn load(path: &Path) -> Result<ProviderSettings> {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).context("reading the provider settings"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(ProviderSettings::default()),
        Err(error) => Err(error).context("reading the provider settings"),
    }
}

/// Validate, then write the choice. Nothing is written when the choice is refused.
pub fn save(path: &Path, settings: &ProviderSettings) -> Result<()> {
    settings.validate()?;
    let text = serde_json::to_string_pretty(settings).context("encoding the provider settings")?;
    std::fs::write(path, text).context("writing the provider settings")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("jobshell-settings-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir.join("provider-settings.json")
    }

    #[test]
    fn with_nothing_saved_the_defaults_are_anthropic_and_jev() {
        let path = temp_file("missing");
        let _ = std::fs::remove_file(&path);
        let settings = load(&path).expect("defaults");
        assert_eq!(settings, ProviderSettings::default());
    }

    #[test]
    fn a_saved_choice_is_read_back_unchanged() {
        let path = temp_file("roundtrip");
        let chosen = ProviderSettings { llm_provider: "openai".into(), llm_model: "gpt-x".into(), ..Default::default() };
        save(&path, &chosen).expect("save");
        assert_eq!(load(&path).expect("load"), chosen);
    }

    #[test]
    fn an_unknown_provider_is_refused_and_nothing_is_written() {
        let path = temp_file("refused");
        let _ = std::fs::remove_file(&path);
        let bad = ProviderSettings { llm_provider: "mistral".into(), ..Default::default() };
        assert!(save(&path, &bad).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn a_provider_without_a_model_is_refused() {
        let no_model = ProviderSettings { llm_provider: "gemini".into(), llm_model: "  ".into(), ..Default::default() };
        assert!(no_model.validate().is_err());
    }

    #[test]
    fn the_saved_file_never_contains_a_key() {
        let path = temp_file("nokey");
        save(&path, &ProviderSettings::default()).expect("save");
        let text = std::fs::read_to_string(&path).expect("read");
        assert!(!text.to_lowercase().contains("key"), "no key-like field: {text}");
        assert!(!text.to_lowercase().contains("token"), "no token-like field: {text}");
    }

    #[test]
    fn the_match_threshold_defaults_to_seventy_percent() {
        assert_eq!(ProviderSettings::default().match_threshold, 70);
    }

    #[test]
    fn a_threshold_outside_one_to_one_hundred_is_refused() {
        for bad in [0_u8, 101] {
            let settings = ProviderSettings { match_threshold: bad, ..Default::default() };
            assert!(settings.validate().is_err(), "{bad} must be refused");
        }
        let edge = ProviderSettings { match_threshold: 100, ..Default::default() };
        assert!(edge.validate().is_ok());
    }

    #[test]
    fn a_file_saved_before_the_threshold_existed_gets_the_default() {
        let path = temp_file("old-format");
        std::fs::write(&path, r#"{"llm_provider":"anthropic","llm_model":"m","judgment_service":"typesafe","judgment_model":"jev-1.14.0","judgment_address":""}"#).expect("write");
        assert_eq!(load(&path).expect("load").match_threshold, 70);
    }

    #[test]
    fn the_agent_environment_carries_the_threshold() {
        let env = ProviderSettings { match_threshold: 85, ..Default::default() }.agent_env();
        assert!(env.contains(&("JOBSHELL_MATCH_THRESHOLD".to_string(), "85".to_string())));
    }

    #[test]
    fn the_agent_environment_names_every_choice_and_no_secret() {
        let env = ProviderSettings { llm_provider: "gemini".into(), llm_model: "gemini-2.5-flash".into(), ..Default::default() }
            .agent_env();
        assert!(env.contains(&("JOBSHELL_LLM_PROVIDER".to_string(), "gemini".to_string())));
        assert!(env.contains(&("JOBSHELL_LLM_MODEL".to_string(), "gemini-2.5-flash".to_string())));
        assert!(env.iter().all(|(name, _)| !name.to_lowercase().contains("key")));
    }
}
