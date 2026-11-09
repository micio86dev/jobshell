//! ZipRecruiter's MCP server, as a client.
//!
//! ZipRecruiter publishes a standard MCP endpoint behind OAuth 2.0 with PKCE, and its
//! discovery metadata advertises `client_id_metadata_document_supported` with no dynamic
//! registration endpoint. So this client identifies itself with a metadata document hosted
//! at an HTTPS URL the maintainer controls, uses a loopback redirect (RFC 8252) and stores
//! the token in the OS keyring.
//!
//! Everything that can be decided without the network is a pure function here, so the
//! shapes are tested: the document to host, the PKCE pair, the authorize URL, the callback
//! parser.

use anyhow::{Context, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// The port the loopback redirect listens on. Fixed, because the hosted document has to
/// name the same redirect URI.
pub const REDIRECT_PORT: u16 = 8788;
pub const REDIRECT_PATH: &str = "/callback";
pub const SCOPE: &str = "mcp:search";
pub const AUTHORIZE_URL: &str = "https://www.ziprecruiter.com/oauth2/authorize";
pub const TOKEN_URL: &str = "https://www.ziprecruiter.com/oauth2/token";
pub const MCP_URL: &str = "https://api.ziprecruiter.com/mcp";

pub fn redirect_uri() -> String {
    format!("http://127.0.0.1:{REDIRECT_PORT}{REDIRECT_PATH}")
}

/// The document the maintainer publishes. Its URL is the client id.
///
/// `client_id` must equal the URL it is served from, so the caller passes that URL in.
pub fn client_document(client_id_url: &str) -> String {
    serde_json::json!({
        "client_id": client_id_url,
        "client_name": "openjob.dev",
        "client_uri": "https://openjob.dev",
        "redirect_uris": [redirect_uri()],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "scope": SCOPE,
    })
    .to_string()
}

/// A PKCE pair. The verifier is random per attempt; the challenge is its S256 digest.
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

const BASE64URL: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::URL_SAFE_NO_PAD;

/// The S256 challenge of a verifier. Pure, so a known answer pins the encoding.
pub fn challenge_for(verifier: &str) -> String {
    BASE64URL.encode(Sha256::digest(verifier.as_bytes()))
}

/// A fresh pair, from the OS random source.
pub fn pkce() -> Result<Pkce> {
    let mut bytes = [0u8; 32];
    getrandom(&mut bytes)?;
    let verifier = BASE64URL.encode(bytes);
    Ok(Pkce {
        challenge: challenge_for(&verifier),
        verifier,
    })
}

fn getrandom(buffer: &mut [u8]) -> Result<()> {
    use std::io::Read;
    std::fs::File::open("/dev/urandom")
        .context("opening the system random source")?
        .read_exact(buffer)
        .context("reading the system random source")
}

/// The URL the browser opens to ask the user for consent.
pub fn authorize_url(client_id: &str, state: &str, challenge: &str) -> String {
    let query = [
        ("response_type", "code"),
        ("client_id", client_id),
        ("redirect_uri", &redirect_uri()),
        ("scope", SCOPE),
        ("state", state),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
    ]
    .iter()
    .map(|(key, value)| format!("{key}={}", percent_encode(value)))
    .collect::<Vec<_>>()
    .join("&");
    format!("{AUTHORIZE_URL}?{query}")
}

/// Percent-encode the characters that matter in a query value.
pub fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// What the loopback listener receives.
#[derive(Debug, PartialEq)]
pub struct Callback {
    pub code: String,
    pub state: String,
}

/// Read `code` and `state` out of a request line, and refuse anything else.
///
/// Pure: the listener hands it the first line it reads, so a malformed callback is a test
/// case rather than a manual experiment.
pub fn parse_callback(request_line: &str) -> Result<Callback> {
    let target = request_line
        .split_whitespace()
        .nth(1)
        .context("the callback has no request target")?;
    let query = target
        .split_once('?')
        .map(|(_, query)| query)
        .context("the callback carries no query")?;

    let mut code = None;
    let mut state = None;
    let mut error = None;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let value = percent_decode(value);
        match key {
            "code" => code = Some(value),
            "state" => state = Some(value),
            "error" => error = Some(value),
            _ => {}
        }
    }

    if let Some(error) = error {
        anyhow::bail!("the authorization was refused: {error}");
    }
    Ok(Callback {
        code: code.context("the callback carries no code")?,
        state: state.context("the callback carries no state")?,
    })
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or("");
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// What the token endpoint returns.
#[derive(Debug, Deserialize)]
pub struct TokenSet {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_in: Option<u64>,
    #[serde(default)]
    pub token_type: Option<String>,
}

/// The body of the token request. Public client, so no secret.
pub fn token_request_body(client_id: &str, code: &str, verifier: &str) -> Vec<(String, String)> {
    vec![
        ("grant_type".into(), "authorization_code".into()),
        ("code".into(), code.into()),
        ("redirect_uri".into(), redirect_uri()),
        ("client_id".into(), client_id.into()),
        ("code_verifier".into(), verifier.into()),
    ]
}

/// Exchange the code for a token.
pub fn exchange_code(client_id: &str, code: &str, verifier: &str) -> Result<TokenSet> {
    let body = token_request_body(client_id, code, verifier)
        .into_iter()
        .map(|(key, value)| format!("{}={}", percent_encode(&key), percent_encode(&value)))
        .collect::<Vec<_>>()
        .join("&");

    let response = ureq::post(TOKEN_URL)
        .set("content-type", "application/x-www-form-urlencoded")
        .set("accept", "application/json")
        .send_string(&body);

    match response {
        Ok(response) => response
            .into_json::<TokenSet>()
            .context("the token endpoint answered with something unexpected"),
        Err(ureq::Error::Status(status, response)) => {
            let text = response.into_string().unwrap_or_default();
            anyhow::bail!("the token endpoint refused the exchange ({status}): {text}")
        }
        Err(error) => Err(error).context("calling the token endpoint"),
    }
}

/// Wait for the browser to come back with the code.
pub fn wait_for_callback(expected_state: &str, timeout: std::time::Duration) -> Result<String> {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT))
        .with_context(|| format!("listening on 127.0.0.1:{REDIRECT_PORT}"))?;
    listener
        .set_nonblocking(false)
        .context("configuring the redirect listener")?;

    let deadline = std::time::Instant::now() + timeout;
    for stream in listener.incoming() {
        if std::time::Instant::now() > deadline {
            anyhow::bail!("no authorization came back within the timeout");
        }
        let mut stream = stream.context("accepting the redirect")?;
        let mut buffer = [0u8; 4096];
        let read = stream.read(&mut buffer).context("reading the redirect")?;
        let request = String::from_utf8_lossy(&buffer[..read]).to_string();
        let first_line = request.lines().next().unwrap_or("");

        let answer = match parse_callback(first_line) {
            Ok(callback) if callback.state == expected_state => {
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\ncontent-type: text/html\r\n\r\n<h1>openjob.dev</h1><p>Autorizzazione completata: puoi chiudere questa scheda.</p>",
                );
                return Ok(callback.code);
            }
            Ok(_) => "HTTP/1.1 400 Bad Request\r\ncontent-type: text/plain\r\n\r\nstate non valido",
            Err(_) => "HTTP/1.1 400 Bad Request\r\ncontent-type: text/plain\r\n\r\nrichiesta non valida",
        };
        let _ = stream.write_all(answer.as_bytes());
    }
    anyhow::bail!("the redirect listener stopped before an authorization arrived")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_document_names_the_redirect_and_the_public_client() {
        let document: serde_json::Value =
            serde_json::from_str(&client_document("https://example.test/client.json")).expect("json");

        assert_eq!(document["client_id"], "https://example.test/client.json");
        assert_eq!(document["redirect_uris"][0], "http://127.0.0.1:8788/callback");
        assert_eq!(document["token_endpoint_auth_method"], "none");
        assert_eq!(document["scope"], "mcp:search");
        assert_eq!(document["grant_types"][1], "refresh_token");
    }

    #[test]
    fn the_challenge_is_the_s256_of_the_verifier_in_base64url() {
        // Known answer: the RFC 7636 example verifier.
        assert_eq!(
            challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn a_fresh_pair_is_url_safe_and_matches() {
        let pair = pkce().expect("random");
        assert!(!pair.verifier.contains('+') && !pair.verifier.contains('/'));
        assert!(!pair.challenge.contains('='));
        assert_eq!(pair.challenge, challenge_for(&pair.verifier));
    }

    #[test]
    fn the_authorize_url_carries_pkce_and_the_redirect() {
        let url = authorize_url("https://example.test/client.json", "state-1", "challenge-1");
        assert!(url.starts_with(AUTHORIZE_URL));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("code_challenge=challenge-1"));
        assert!(url.contains("state=state-1"));
        assert!(url.contains(&format!(
            "redirect_uri={}",
            percent_encode("http://127.0.0.1:8788/callback")
        )));
        assert!(url.contains(&format!("client_id={}", percent_encode("https://example.test/client.json"))));
    }

    #[test]
    fn a_callback_yields_the_code_and_the_state() {
        let callback = parse_callback("GET /callback?code=abc123&state=xyz HTTP/1.1").expect("callback");
        assert_eq!(callback.code, "abc123");
        assert_eq!(callback.state, "xyz");
    }

    #[test]
    fn a_refused_authorization_is_an_error_naming_the_reason() {
        let error = parse_callback("GET /callback?error=access_denied&state=x HTTP/1.1").unwrap_err();
        assert!(error.to_string().contains("access_denied"));
    }

    #[test]
    fn a_callback_without_a_code_is_refused() {
        assert!(parse_callback("GET /callback?state=x HTTP/1.1").is_err());
        assert!(parse_callback("GET /callback HTTP/1.1").is_err());
        assert!(parse_callback("garbage").is_err());
    }

    #[test]
    fn the_token_request_is_a_public_client_exchange() {
        let body = token_request_body("https://example.test/client.json", "code-1", "verifier-1");
        let map: std::collections::BTreeMap<_, _> = body.into_iter().collect();
        assert_eq!(map["grant_type"], "authorization_code");
        assert_eq!(map["code"], "code-1");
        assert_eq!(map["code_verifier"], "verifier-1");
        assert_eq!(map["client_id"], "https://example.test/client.json");
        assert!(!map.contains_key("client_secret"), "a public client has no secret");
    }
}
