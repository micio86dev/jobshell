//! The automatic search: when it is due, and the lock that keeps two searches from running at once.
//!
//! The schedule is off until the user turns it on, because a run spends money. The pieces here are
//! pure, so the rules are tested without a clock, a window or a network: whether a search is due, which
//! intervals are allowed, and a lock whose guard is released however the search ends.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

/// The intervals the settings offer, in hours. Zero is off.
pub const ALLOWED_HOURS: [u32; 5] = [0, 6, 12, 24, 48];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Schedule {
    /// Hours between two searches; zero means the user runs them by hand.
    #[serde(default)]
    pub every_hours: u32,
    /// When the last search was started, in seconds since the epoch. Written before the search
    /// runs, so a crash in the middle never makes the next tick start another at once.
    #[serde(default)]
    pub last_attempt: Option<i64>,
    /// Why the last scheduled search failed, if it did. It is cleared by the next one that works.
    #[serde(default)]
    pub last_error: Option<String>,
}

/// The schedule after the user picks an interval. Turning it on from off counts as an attempt now, so
/// the first paid search comes one interval later, not within the minute.
pub fn with_hours(current: &Schedule, every_hours: u32, now: i64) -> Schedule {
    let turning_on = current.every_hours == 0 && every_hours > 0;
    Schedule {
        every_hours,
        last_attempt: if turning_on { Some(now) } else { current.last_attempt },
        last_error: current.last_error.clone(),
    }
}

/// Read the schedule. No file is "off". A file that cannot be read is an error, never "on".
pub fn load(path: &Path) -> Result<Schedule> {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).context("the search schedule is damaged"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Schedule::default()),
        Err(error) => Err(error).context("reading the search schedule"),
    }
}

/// Store the schedule, after checking the interval is one the settings offer.
pub fn save(path: &Path, schedule: &Schedule) -> Result<()> {
    anyhow::ensure!(ALLOWED_HOURS.contains(&schedule.every_hours), "the interval must be one of {ALLOWED_HOURS:?} hours");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
    }
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, serde_json::to_string(schedule)?).context("writing the search schedule")?;
    std::fs::rename(&temporary, path).context("replacing the search schedule")
}

/// Whether a search should start now.
pub fn due(schedule: &Schedule, now: i64) -> bool {
    if schedule.every_hours == 0 {
        return false;
    }
    match schedule.last_attempt {
        None => true,
        Some(last) => now.saturating_sub(last) >= i64::from(schedule.every_hours) * 3600,
    }
}

/// One search at a time, whoever starts it: the button, or the schedule.
#[derive(Clone, Default)]
pub struct RunLock(Arc<AtomicBool>);

/// Holding it is the right to run. Dropping it, for any reason, gives the right back.
pub struct RunGuard(Arc<AtomicBool>);

impl RunLock {
    pub fn try_acquire(&self) -> Option<RunGuard> {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| RunGuard(Arc::clone(&self.0)))
    }
}

impl Drop for RunGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn on(hours: u32, last: Option<i64>) -> Schedule {
        Schedule { every_hours: hours, last_attempt: last, last_error: None }
    }

    #[test]
    fn turning_the_schedule_on_waits_one_interval_before_the_first_paid_search() {
        let off = Schedule::default();
        let turned_on = with_hours(&off, 12, 5000);
        assert_eq!(turned_on.last_attempt, Some(5000));
        assert!(!due(&turned_on, 5001), "not within the minute");
        assert!(due(&turned_on, 5000 + 12 * 3600));
        let changed = with_hours(&on(12, Some(100)), 24, 9000);
        assert_eq!(changed.last_attempt, Some(100), "changing the interval keeps the last attempt");
        assert_eq!(with_hours(&on(12, Some(100)), 0, 9000).every_hours, 0);
    }

    #[test]
    fn a_failure_is_kept_for_the_screen_and_an_old_file_without_it_still_reads() {
        let path = scratch("error").join("lead-schedule.json");
        let failed = Schedule { every_hours: 6, last_attempt: Some(1), last_error: Some("the judgment key is missing".into()) };
        save(&path, &failed).unwrap();
        assert_eq!(load(&path).unwrap().last_error.as_deref(), Some("the judgment key is missing"));
        std::fs::write(&path, r#"{"every_hours":6,"last_attempt":1}"#).unwrap();
        assert_eq!(load(&path).unwrap().last_error, None);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("jobshell-schedule-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn nothing_runs_until_the_user_turns_it_on() {
        assert!(!due(&Schedule::default(), 1_000_000));
        assert!(!due(&on(0, None), 1_000_000));
    }

    #[test]
    fn a_search_is_due_the_first_time_and_then_once_the_interval_has_passed() {
        assert!(due(&on(12, None), 5));
        let hour = 3600;
        assert!(!due(&on(12, Some(1000)), 1000 + 12 * hour - 1));
        assert!(due(&on(12, Some(1000)), 1000 + 12 * hour));
        assert!(!due(&on(6, Some(1000)), 999), "a clock that went back never makes a search due");
    }

    #[test]
    fn only_the_offered_intervals_are_stored_and_a_missing_file_is_off() {
        let path = scratch("save").join("lead-schedule.json");
        assert_eq!(load(&path).unwrap(), Schedule::default());
        save(&path, &on(24, Some(7))).unwrap();
        assert_eq!(load(&path).unwrap(), on(24, Some(7)));
        assert!(save(&path, &on(5, None)).is_err());
        assert_eq!(load(&path).unwrap(), on(24, Some(7)), "a refused change leaves the file as it was");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_damaged_schedule_is_an_error_not_a_search_every_minute() {
        let path = scratch("damaged").join("lead-schedule.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{broken").unwrap();
        assert!(load(&path).is_err());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn only_one_search_runs_at_a_time_and_the_lock_is_shared_by_every_clone() {
        let lock = RunLock::default();
        let other = lock.clone();
        let first = lock.try_acquire().expect("free");
        assert!(lock.try_acquire().is_none());
        assert!(other.try_acquire().is_none(), "the schedule and the button share one lock");
        drop(first);
        assert!(other.try_acquire().is_some(), "released on drop");
    }

    #[test]
    fn the_lock_is_released_even_when_the_search_panics() {
        let lock = RunLock::default();
        let held = lock.clone();
        let result = std::thread::spawn(move || {
            let _guard = held.try_acquire().expect("free");
            panic!("the search failed");
        })
        .join();
        assert!(result.is_err());
        assert!(lock.try_acquire().is_some(), "a crashed search never blocks the next one");
    }
}
