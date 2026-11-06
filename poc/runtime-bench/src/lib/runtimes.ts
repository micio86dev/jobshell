/** The candidate browser runtimes compared in Phase 0, in evaluation order. */
export const RUNTIME_REPOS = [
  'vercel-labs/agent-browser',
  'browser-use/browser-harness',
  'browser-use/jev-ultrafast',
  'browserbase/stagehand',
  'microsoft/playwright',
] as const;

export type RuntimeSlug = (typeof RUNTIME_REPOS)[number];

/** `vercel-labs/agent-browser` -> `agent-browser`. */
export const repoName = (slug: string): string => slug.split('/')[1] ?? slug;
