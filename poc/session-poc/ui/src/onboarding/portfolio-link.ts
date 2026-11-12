/**
 * The portfolio is a public https link. This is a pre-check the wizard runs before it asks the
 * agent whether the link answers, so an obviously bad link is refused without a request. It is
 * not the authority: the agent's own rule decides, and its verdict is read through zod too.
 */
import { z } from 'zod';

const PRIVATE_NAME = /^(localhost|.*\.localhost|.*\.local|\[?::.*|\[?f[cd][0-9a-f]{2}:.*|\[?fe80:.*)$/i;
const PRIVATE_IPV4 =
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|198\.(18|19)\.|(22[4-9]|23\d|24\d|25[0-5])\.)/;

export const isPortfolioLink = (value: string): boolean => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false;
  const host = url.hostname.replace(/\.$/, '');
  return host.length > 0 && !PRIVATE_NAME.test(host) && !PRIVATE_IPV4.test(host);
};

const checkSchema = z.object({
  reachable: z.boolean(),
  status: z.number().int(),
  text: z.string(),
});

/** The agent's verdict on a link, or null when the answer is not the shape the wizard expects. */
export const parseCheckResult = (raw: string): z.infer<typeof checkSchema> | null => {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = checkSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
};
