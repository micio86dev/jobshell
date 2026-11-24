//! Learning from the user's own decisions, in the open and undoable.
//!
//! The leads the user marked wanted or not wanted say which sources tend to give them what they want.
//! That becomes one bounded weight per source, and the weights do exactly one thing: when the judgment
//! budget cannot cover every company, a source the user usually wants is judged earlier and one they
//! usually do not is judged later. Nothing is rejected, scored or hidden because of a weight.
//!
//! It is off until the user turns it on. Nothing is stored apart from the on/off flag: the weights are
//! recomputed from the decisions every time, so changing a decision (they are an append-only log) or
//! turning the switch off puts everything back at once, and the settings page shows every number.

use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Decisions a source needs before it moves at all. Fewer say nothing.
pub const MIN_DECIDED: i64 = 5;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Flag {
    #[serde(default)]
    pub enabled: bool,
}

/// Read the switch. No file is "off"; a file that cannot be read is an error, never "on".
pub fn load(path: &Path) -> Result<Flag> {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).context("the learning switch is damaged"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Flag::default()),
        Err(error) => Err(error).context("reading the learning switch"),
    }
}

pub fn save(path: &Path, flag: &Flag) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
    }
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, serde_json::to_string(flag)?).context("writing the learning switch")?;
    std::fs::rename(&temporary, path).context("replacing the learning switch")
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SourceLearning {
    pub source: String,
    pub decided: i64,
    pub wanted: i64,
    /// 1.0 when the source has too few decisions to move; otherwise between 0.5 and 1.5.
    pub weight: f64,
    pub applied: bool,
}

/// The weight of a source from its decisions: the share wanted, smoothed so two decisions never swing it,
/// mapped to 0.5 (never wanted) .. 1.5 (always wanted), with 1.0 for "half and half".
pub fn weight_for(wanted: i64, decided: i64) -> f64 {
    let rate = (wanted as f64 + 1.0) / (decided as f64 + 2.0);
    ((0.5 + rate) * 100.0).round() / 100.0
}

/// Every source with at least one decision, with the weight it would get.
pub fn learn(decisions: &[(String, i64, i64)]) -> Vec<SourceLearning> {
    decisions
        .iter()
        .map(|(source, wanted, unwanted)| {
            let decided = wanted + unwanted;
            let applied = decided >= MIN_DECIDED;
            SourceLearning {
                source: source.clone(),
                decided,
                wanted: *wanted,
                weight: if applied { weight_for(*wanted, decided) } else { 1.0 },
                applied,
            }
        })
        .collect()
}

/// The file the agent reads: only the sources whose weight moves.
pub fn preferences(items: &[SourceLearning]) -> Value {
    let mut weights = serde_json::Map::new();
    for item in items.iter().filter(|item| item.applied) {
        weights.insert(item.source.clone(), json!(item.weight));
    }
    json!({ "source_weights": weights })
}

/// Write the preferences file, or remove it when there is nothing to apply, so a run never reads a stale one.
pub fn write_preferences(path: &Path, items: &[SourceLearning]) -> Result<bool> {
    if !items.iter().any(|item| item.applied) {
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error).context("removing the preferences file"),
        }
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
    }
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, serde_json::to_string(&preferences(items))?).context("writing the preferences file")?;
    std::fs::rename(&temporary, path).context("replacing the preferences file")?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("jobshell-learning-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("scratch");
        path
    }

    #[test]
    fn it_is_off_until_the_user_turns_it_on_and_a_damaged_file_is_never_on() {
        let dir = scratch("flag");
        let path = dir.join("learning.json");
        assert_eq!(load(&path).expect("none"), Flag { enabled: false });
        save(&path, &Flag { enabled: true }).expect("save");
        assert!(load(&path).expect("on").enabled);
        std::fs::write(&path, "not json").expect("damage");
        assert!(load(&path).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_weight_is_bounded_smoothed_and_neutral_at_half() {
        assert_eq!(weight_for(5, 10), 1.0, "half wanted is neutral");
        assert!(weight_for(0, 5) >= 0.5 && weight_for(0, 5) < 0.7, "never wanted is judged later, not dropped: {}", weight_for(0, 5));
        assert!(weight_for(1000, 1000) <= 1.5 && weight_for(1000, 1000) > 1.4);
        assert!(weight_for(4, 5) > weight_for(3, 5), "more wanted weighs more");
        assert!(weight_for(5, 5) < 1.5, "smoothed: five out of five is not the maximum");
    }

    #[test]
    fn a_source_with_too_few_decisions_does_not_move() {
        let items = learn(&[("hn-hiring".to_string(), 4, 0), ("yc-hiring".to_string(), 1, 4), ("sifted".to_string(), 0, 2)]);
        let by = |name: &str| items.iter().find(|item| item.source == name).expect(name).clone();
        assert!(!by("hn-hiring").applied && by("hn-hiring").weight == 1.0, "four decisions say nothing yet");
        assert!(by("yc-hiring").applied && by("yc-hiring").weight < 1.0);
        assert!(!by("sifted").applied);
        assert_eq!(by("yc-hiring").decided, 5);
        assert_eq!(preferences(&items), json!({"source_weights": {"yc-hiring": by("yc-hiring").weight}}));
    }

    /// The file the agent reads, as the agent's own test reads it: one fixture, two languages.
    #[test]
    fn the_preferences_match_the_file_the_agent_is_tested_with() {
        let fixture: Value = serde_json::from_str(include_str!("../../../job-agent/test/fixtures/leads/preferences.json")).expect("fixture");
        let items = learn(&[("hn-hiring".to_string(), 6, 0), ("yc-hiring".to_string(), 1, 5), ("sifted".to_string(), 1, 1)]);
        assert_eq!(preferences(&items), fixture);
    }

    #[test]
    fn the_preferences_file_is_written_when_something_moves_and_removed_when_nothing_does() {
        let dir = scratch("prefs");
        let path = dir.join("prefs.json");
        let moving = learn(&[("yc-hiring".to_string(), 0, 6)]);
        assert!(write_preferences(&path, &moving).expect("write"));
        let written: Value = serde_json::from_str(&std::fs::read_to_string(&path).expect("read")).expect("json");
        assert!(written["source_weights"]["yc-hiring"].as_f64().expect("weight") < 1.0);
        assert!(!write_preferences(&path, &learn(&[("yc-hiring".to_string(), 1, 1)])).expect("nothing moves"));
        assert!(!path.exists(), "a stale file is never left behind");
        assert!(!write_preferences(&path, &[]).expect("again"), "removing what is not there is fine");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
