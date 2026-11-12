//! Secure credential storage through the operating system keyring.
//!
//! The spike stores one probe secret to prove the round trip works on the host.
//! Nothing else is ever written: CVs and profiles stay in files and SQLite, and
//! only API tokens belong in the keyring.

use anyhow::{Context, Result};
use keyring::Entry;

/// The keyring service of every key the desktop app writes, and the one the agent reads from.
const SERVICE: &str = "dev.openjob.desktop";

fn entry(account: &str) -> Result<Entry> {
    Entry::new(SERVICE, account).with_context(|| format!("opening keyring entry for {account}"))
}

/// Store a secret, replacing any previous value for the same account.
pub fn store_secret(account: &str, secret: &str) -> Result<()> {
    entry(account)?
        .set_password(secret)
        .with_context(|| format!("writing keyring entry for {account}"))
}

/// Read a secret back. Returns `Ok(None)` when the account has no stored value.
pub fn read_secret(account: &str) -> Result<Option<String>> {
    match entry(account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error).with_context(|| format!("reading keyring entry for {account}")),
    }
}

/// Remove a secret. A missing entry is not an error.
pub fn delete_secret(account: &str) -> Result<()> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error).with_context(|| format!("deleting keyring entry for {account}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round trip against the real OS keyring. Ignored by default because a CI
    /// runner has no unlocked keychain; the Phase 0 self-test runs it explicitly.
    #[test]
    #[ignore = "requires an unlocked OS keyring"]
    fn secret_round_trip_and_delete() {
        let account = "selftest-account";
        store_secret(account, "probe-value").expect("store");
        assert_eq!(read_secret(account).expect("read").as_deref(), Some("probe-value"));
        delete_secret(account).expect("delete");
        assert_eq!(read_secret(account).expect("read after delete"), None);
    }
}
