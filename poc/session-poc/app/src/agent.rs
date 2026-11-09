//! Reading the last job-agent run for the desktop UI.
//!
//! The agent writes one `run-<timestamp>.json` per run. The desktop app reads the newest
//! one and projects exactly what the window shows: the postings that cleared the user's
//! threshold, with the percentage, the verdict and any accepted gap. The projection is a
//! pure function over the file's text, so it is tested without a filesystem or a window.

use std::path::{Path, PathBuf};
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command};
use std::time::Duration;

use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize, PartialEq)]
pub struct SelectedView {
    pub key: String,
    pub title: String,
    pub company: Option<String>,
    pub url: String,
    pub source: String,
    pub probability: f64,
    pub verdict: String,
    pub stack_stance: String,
    pub gaps: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct DroppedCount {
    pub reason: String,
    pub count: u64,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct RunSummary {
    pub run_at: String,
    pub threshold: f64,
    pub fetched: u64,
    pub kept: u64,
    pub judged: u64,
    /** How many survivors the run was allowed to judge. */
    pub budget: u64,
    pub input_tokens: u64,
    pub dropped: Vec<DroppedCount>,
    pub selected: Vec<SelectedView>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct AgentRunView {
    pub evidence_path: String,
    pub summary: RunSummary,
}

/// Where the agent writes its evidence: the same default it uses, overridable for a test.
pub fn evidence_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("OPENJOB_EVIDENCE_DIR") {
        return PathBuf::from(dir);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".local/share/openjob/evidence")
}

/// The newest `run-*.json` in a directory. Timestamps are ISO-8601, so the names sort.
pub fn latest_run(dir: &Path) -> Result<Option<PathBuf>> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        // No directory yet means the agent has never run: not an error, an empty answer.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error).with_context(|| format!("reading {}", dir.display())),
    };

    let mut newest: Option<PathBuf> = None;
    for entry in entries {
        let entry = entry.context("reading an evidence entry")?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("run-") || !name.ends_with(".json") {
            continue;
        }
        let path = entry.path();
        let is_newer = newest
            .as_ref()
            .and_then(|current| current.file_name())
            .map(|current| name > current.to_string_lossy().to_string())
            .unwrap_or(true);
        if is_newer {
            newest = Some(path);
        }
    }
    Ok(newest)
}

fn number(value: Option<&Value>) -> f64 {
    value.and_then(Value::as_f64).unwrap_or(0.0)
}

fn count(value: Option<&Value>) -> u64 {
    value.and_then(Value::as_u64).unwrap_or(0)
}

fn text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
}

/// Project the evidence file into exactly what the window draws.
pub fn project_run(raw: &str, path: &str) -> Result<AgentRunView> {
    let parsed: Value = serde_json::from_str(raw).context("the evidence file is not valid JSON")?;
    let root = parsed.as_object().context("the evidence file is not an object")?;

    let empty = serde_json::Map::new();
    let funnel = root.get("funnel").and_then(Value::as_object).unwrap_or(&empty);
    let scoring = root.get("scoring").and_then(Value::as_object).unwrap_or(&empty);

    let mut dropped: Vec<DroppedCount> = funnel
        .get("dropped")
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .map(|(reason, value)| DroppedCount {
                    reason: reason.clone(),
                    count: count(Some(value)),
                })
                .collect()
        })
        .unwrap_or_default();
    // Biggest reason first: that is the question the user actually asks.
    dropped.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.reason.cmp(&b.reason)));

    let selected = root
        .get("selected")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let object = item.as_object()?;
                    let title = text(object.get("title"))?;
                    let url = text(object.get("url"))?;
                    Some(SelectedView {
                        key: text(object.get("key")).unwrap_or_default(),
                        title,
                        company: text(object.get("company")),
                        url,
                        source: text(object.get("source")).unwrap_or_default(),
                        probability: number(object.get("probability")),
                        verdict: text(object.get("verdict")).unwrap_or_default(),
                        stack_stance: text(object.get("stack_stance")).unwrap_or_default(),
                        gaps: object
                            .get("gaps")
                            .and_then(Value::as_array)
                            .map(|gaps| gaps.iter().filter_map(|gap| gap.as_str().map(str::to_string)).collect())
                            .unwrap_or_default(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(AgentRunView {
        evidence_path: path.to_string(),
        summary: RunSummary {
            run_at: text(root.get("run_at")).unwrap_or_default(),
            threshold: number(scoring.get("threshold").or_else(|| root.get("threshold"))),
            fetched: count(funnel.get("fetched")),
            kept: count(funnel.get("kept")),
            judged: count(scoring.get("judged")),
            budget: count(scoring.get("budget")),
            input_tokens: count(scoring.get("input_tokens")),
            dropped,
            selected,
        },
    })
}

/// Where the agent package lives.
///
/// Baked in at compile time, because this is a development-stage app that runs the agent
/// from the repository. A packaged build overrides it with `OPENJOB_AGENT_DIR`.
pub fn agent_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("OPENJOB_AGENT_DIR") {
        return PathBuf::from(dir);
    }
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../job-agent")
}

/// The profile the run uses: the app's own copy, not a file the user has to place.
pub fn profile_path() -> PathBuf {
    if let Ok(path) = std::env::var("OPENJOB_PROFILE") {
        return PathBuf::from(path);
    }
    evidence_dir().join("profile.json")
}

/// The starter profile shipped with the app, used on the very first run.
const STARTER_PROFILE: &str = include_str!("../../../job-agent/profile.example.json");

/// Write the starter profile when there is none, and never overwrite an edited one.
pub fn ensure_profile(path: &Path) -> Result<bool> {
    if path.exists() {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
    }
    std::fs::write(path, STARTER_PROFILE).with_context(|| format!("writing {}", path.display()))?;
    Ok(true)
}

/// The arguments one run needs. Pure, so the shape is tested without spawning anything.
pub fn run_args(profile: &Path, dry_run: bool) -> Vec<String> {
    let mut args = vec![
        "src/cli.ts".to_string(),
        "--profile".to_string(),
        profile.display().to_string(),
    ];
    if dry_run {
        args.push("--dry-run".to_string());
    }
    args
}

/// One run of the agent, as the app launches it.
///
/// The output is returned rather than streamed: a dry run takes seconds, and a judged run
/// a minute, so the window shows a running state and then reloads the evidence.
pub fn run_once(dry_run: bool) -> Result<String> {
    let dir = agent_dir();
    let profile = profile_path();
    ensure_profile(&profile)?;

    let output = Command::new("node")
        .args(run_args(&profile, dry_run))
        .current_dir(&dir)
        .output()
        .with_context(|| format!("starting the agent in {}", dir.display()))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        // The agent already prints a readable reason; surface it instead of a bare code.
        anyhow::bail!("{}", if stderr.trim().is_empty() { stdout } else { stderr });
    }
    Ok(stdout)
}

/// The browser the app drives: a dedicated Chrome for Testing, because a branded Chrome
/// ignores `--load-extension` (the finding recorded in the Phase 0 evidence).
pub fn chrome_path() -> PathBuf {
    if let Ok(path) = std::env::var("OPENJOB_CHROME") {
        return PathBuf::from(path);
    }
    Path::new(env!("CARGO_MANIFEST_DIR")).join(
        "../../../.cache/pw-browsers/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    )
}

/// A profile the app owns, so the user's everyday browser is never touched.
pub fn browser_profile_dir() -> PathBuf {
    evidence_dir().join("browser-profile")
}

/// The extension that reads a page when the user asks it to.
pub fn extension_dir() -> PathBuf {
    agent_dir().join("extension")
}

/// The arguments the dedicated browser starts with. Pure, so the shape is tested.
pub fn chrome_args(profile: &Path, extension: &Path) -> Vec<String> {
    vec![
        format!("--user-data-dir={}", profile.display()),
        format!("--load-extension={}", extension.display()),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
    ]
}

/// Whether the bridge is already answering on its port.
pub fn bridge_is_up() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], 8787));
    TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok()
}

/// Start the bridge if it is not already running, and hand the child back to the caller.
pub fn start_bridge() -> Result<Option<Child>> {
    if bridge_is_up() {
        return Ok(None);
    }
    let child = Command::new("node")
        .args([
            "src/bridge-cli.ts",
            "--profile",
            &profile_path().display().to_string(),
        ])
        .current_dir(agent_dir())
        .spawn()
        .context("starting the bridge")?;
    Ok(Some(child))
}

/// Open the dedicated browser on the sources that need a login.
pub fn open_browser() -> Result<Child> {
    let chrome = chrome_path();
    if !chrome.exists() {
        anyhow::bail!(
            "no browser at {}. Set OPENJOB_CHROME to a Chrome for Testing binary.",
            chrome.display()
        );
    }
    let profile = browser_profile_dir();
    std::fs::create_dir_all(&profile).with_context(|| format!("creating {}", profile.display()))?;

    Command::new(&chrome)
        .args(chrome_args(&profile, &extension_dir()))
        .spawn()
        .with_context(|| format!("starting {}", chrome.display()))
}

/// Read the newest run, if there is one.
pub fn read_latest(dir: &Path) -> Result<Option<AgentRunView>> {
    let Some(path) = latest_run(dir)? else {
        return Ok(None);
    };
    let raw = std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
    let view = project_run(&raw, &path.display().to_string())?;
    Ok(Some(view))
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUN: &str = r#"{
      "run_at": "2026-11-09T10:13:44.430Z",
      "queries": { "list": ["desktop app"], "source": "fallback", "reason": null },
      "sources": [{ "source": "remoteok", "policy": "allowed", "url": "https://remoteok.com/api", "pages": 1, "status": 200, "postings": 99, "challenge": null, "ms": 1170, "skipped": null }],
      "funnel": { "fetched": 538, "kept": 114, "dropped": { "stale": 335, "remote_mode": 87, "language": 2 }, "unknown_date": 0, "unknown_language": 0, "unknown_remote": 0 },
      "scoring": { "threshold": 0.9, "judged": 114, "budget": 120, "above_threshold": 1, "below_threshold": 113, "input_tokens": 17100, "ms": 2400 },
      "selected": [
        { "key": "remoteok:1", "title": "Fullstack Engineer", "company": "Acme", "url": "https://example.test/1", "source": "remoteok", "probability": 0.93, "verdict": "yes_with_gap", "stack_stance": "not_specified", "gaps": ["stack"] }
      ],
      "overflow": []
    }"#;

    #[test]
    fn a_run_is_projected_into_what_the_window_shows() {
        let view = project_run(RUN, "/tmp/run-1.json").expect("project");

        assert_eq!(view.evidence_path, "/tmp/run-1.json");
        assert_eq!(view.summary.run_at, "2026-11-09T10:13:44.430Z");
        assert_eq!(view.summary.fetched, 538);
        assert_eq!(view.summary.kept, 114);
        assert_eq!(view.summary.judged, 114);
        assert_eq!(view.summary.budget, 120, "the window can say what the ceiling was");
        assert_eq!(view.summary.threshold, 0.9, "the window shows the threshold the run used");
        assert_eq!(view.summary.input_tokens, 17100);
        assert_eq!(view.summary.selected.len(), 1);

        let first = &view.summary.selected[0];
        assert_eq!(first.key, "remoteok:1");
        assert_eq!(first.title, "Fullstack Engineer");
        assert_eq!(first.company.as_deref(), Some("Acme"));
        assert_eq!(first.probability, 0.93);
        assert_eq!(first.verdict, "yes_with_gap");
        assert_eq!(first.gaps, vec!["stack".to_string()]);
    }

    #[test]
    fn dropped_reasons_come_back_biggest_first() {
        let view = project_run(RUN, "/tmp/run-1.json").expect("project");
        let reasons: Vec<&str> = view.summary.dropped.iter().map(|drop| drop.reason.as_str()).collect();
        assert_eq!(reasons, vec!["stale", "remote_mode", "language"]);
        assert_eq!(view.summary.dropped[0].count, 335);
    }

    #[test]
    fn a_quiet_day_projects_an_empty_selection() {
        let quiet = RUN.replace(r#""selected": [
        { "key": "remoteok:1", "title": "Fullstack Engineer", "company": "Acme", "url": "https://example.test/1", "source": "remoteok", "probability": 0.93, "verdict": "yes_with_gap", "stack_stance": "not_specified", "gaps": ["stack"] }
      ]"#, r#""selected": []"#);
        let view = project_run(&quiet, "/tmp/run-2.json").expect("project");
        assert!(view.summary.selected.is_empty());
        assert_eq!(view.summary.fetched, 538);
    }

    #[test]
    fn a_posting_without_a_url_is_skipped_instead_of_breaking_the_list() {
        let broken = RUN.replace(r#""url": "https://example.test/1""#, r#""url": """#);
        let view = project_run(&broken, "/tmp/run-3.json").expect("project");
        assert!(view.summary.selected.is_empty(), "an entry that cannot be opened is not shown");
    }

    #[test]
    fn an_invalid_file_is_an_error_not_a_silent_empty_list() {
        assert!(project_run("not json", "/tmp/x.json").is_err());
        assert!(project_run("[]", "/tmp/x.json").is_err());
    }

    #[test]
    fn a_dry_run_carries_the_profile_and_the_flag() {
        let args = run_args(Path::new("/tmp/p.json"), true);
        assert_eq!(args, vec!["src/cli.ts", "--profile", "/tmp/p.json", "--dry-run"]);
    }

    #[test]
    fn a_real_run_does_not_carry_the_flag() {
        let args = run_args(Path::new("/tmp/p.json"), false);
        assert_eq!(args, vec!["src/cli.ts", "--profile", "/tmp/p.json"]);
    }

    #[test]
    fn the_starter_profile_is_written_once_and_never_overwritten() {
        let dir = std::env::temp_dir().join(format!("openjob-profile-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("profile.json");

        assert!(ensure_profile(&path).expect("first write"), "the first call creates it");
        assert!(std::fs::read_to_string(&path).expect("read").contains("capabilities"));

        std::fs::write(&path, "{\"headline\":\"mine\"}").expect("edit");
        assert!(!ensure_profile(&path).expect("second call"), "an edited profile is left alone");
        assert!(std::fs::read_to_string(&path).expect("read").contains("mine"));

        std::fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn the_agent_directory_points_at_the_package() {
        let dir = agent_dir();
        assert!(dir.join("src/cli.ts").exists(), "expected the agent package at {}", dir.display());
    }

    #[test]
    fn the_browser_starts_with_its_own_profile_and_the_extension() {
        let args = chrome_args(Path::new("/tmp/profile"), Path::new("/tmp/ext"));
        assert_eq!(
            args,
            vec![
                "--user-data-dir=/tmp/profile",
                "--load-extension=/tmp/ext",
                "--no-first-run",
                "--no-default-browser-check",
            ]
        );
    }

    #[test]
    fn the_browser_profile_lives_under_the_app_data_directory() {
        let dir = browser_profile_dir();
        assert!(dir.ends_with("browser-profile"), "unexpected profile dir {}", dir.display());
        assert!(extension_dir().join("manifest.json").exists(), "the extension ships with the agent");
    }

    #[test]
    fn the_newest_run_wins_and_a_missing_directory_is_not_an_error() {
        let dir = std::env::temp_dir().join(format!("openjob-evidence-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        assert!(latest_run(&dir).expect("missing dir").is_none(), "no directory yet is an empty answer");

        std::fs::create_dir_all(&dir).expect("create");
        std::fs::write(dir.join("run-2026-11-08T10-00-00-000Z.json"), "{}").expect("write");
        std::fs::write(dir.join("run-2026-11-09T10-00-00-000Z.json"), "{}").expect("write");
        std::fs::write(dir.join("seen.json"), "[]").expect("write");

        let newest = latest_run(&dir).expect("latest").expect("one file");
        assert_eq!(
            newest.file_name().unwrap().to_string_lossy(),
            "run-2026-11-09T10-00-00-000Z.json"
        );

        std::fs::remove_dir_all(&dir).expect("cleanup");
    }
}
