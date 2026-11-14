/**
 * Where the API key may travel. A key is sent only to an HTTPS host on the approved list,
 * or to the loopback address of a model the user runs on this machine (Ollama, laya-serve).
 * Any other host is refused, so a mistyped or hostile URL never receives a secret.
 */

export const APPROVED_HOSTS: readonly string[] = [
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'dashscope-intl.aliyuncs.com',
  'api.typesafe.ai',
];

const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

export type EndpointCheck = { ok: true } | { ok: false; reason: string };

export const checkEndpoint = (raw: string): EndpointCheck => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'the endpoint is not a valid URL' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'the endpoint must not carry credentials in the URL' };
  }
  const host = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.includes(host)) {
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? { ok: true }
      : { ok: false, reason: 'the endpoint must use http or https' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'a remote endpoint must use https' };
  }
  if (APPROVED_HOSTS.includes(host)) return { ok: true };
  return { ok: false, reason: `the host ${host} is not in the approved list` };
};
