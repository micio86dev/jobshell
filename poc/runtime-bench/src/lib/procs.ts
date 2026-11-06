import { execFileSync } from 'node:child_process';

export type ProcRow = {
  pid: number;
  ppid: number;
  rss_kb: number;
  cpu_seconds: number;
  command: string;
};

/**
 * Parse `ps -o time` output into seconds.
 *
 * Accepted shapes: `SS.ss`, `MM:SS.ss`, `HH:MM:SS`, `DD-HH:MM:SS`. The day
 * prefix is separated by a hyphen, not a colon, so it must be peeled off before
 * splitting the clock part.
 */
export const parseCpuTime = (raw: string): number => {
  let rest = raw.trim();
  if (rest.length === 0) return 0;

  let days = 0;
  const dash = rest.indexOf('-');
  if (dash !== -1) {
    days = Number.parseInt(rest.slice(0, dash), 10);
    rest = rest.slice(dash + 1);
    if (!Number.isFinite(days)) return 0;
  }

  const clock = rest.split(':');
  const seconds = Number.parseFloat(clock.pop() ?? '0');
  const minutes = clock.length > 0 ? Number.parseInt(clock.pop() ?? '0', 10) : 0;
  const hours = clock.length > 0 ? Number.parseInt(clock.pop() ?? '0', 10) : 0;
  return (
    (Number.isFinite(days) ? days : 0) * 86400 +
    (Number.isFinite(hours) ? hours : 0) * 3600 +
    (Number.isFinite(minutes) ? minutes : 0) * 60 +
    (Number.isFinite(seconds) ? seconds : 0)
  );
};

/** Snapshot every process once. One `ps` call keeps sampling cheap. */
export const snapshotProcesses = (): ProcRow[] => {
  const out = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,time=,command='], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const rows: ProcRow[] = [];
  for (const line of out.split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed.length === 0) continue;
    const match = /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, pid, ppid, rss, time, command] = match;
    if (!pid || !ppid || !rss || !time || command === undefined) continue;
    rows.push({
      pid: Number.parseInt(pid, 10),
      ppid: Number.parseInt(ppid, 10),
      rss_kb: Number.parseInt(rss, 10),
      cpu_seconds: parseCpuTime(time),
      command,
    });
  }
  return rows;
};

/** Processes whose command line contains `marker` (e.g. a unique --user-data-dir). */
export const findRootPids = (rows: ProcRow[], marker: string): number[] =>
  rows.filter((row) => row.command.includes(marker)).map((row) => row.pid);

/** Sum a process and every descendant, discovered through the ppid graph. */
export const sumSubtree = (
  rows: ProcRow[],
  roots: number[],
): { processes: number; rss_kb: number; cpu_seconds: number } => {
  const childrenOf = new Map<number, number[]>();
  for (const row of rows) {
    const list = childrenOf.get(row.ppid) ?? [];
    list.push(row.pid);
    childrenOf.set(row.ppid, list);
  }
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const seen = new Set<number>();
  const stack = [...roots];
  let rss = 0;
  let cpu = 0;
  while (stack.length > 0) {
    const pid = stack.pop();
    if (pid === undefined || seen.has(pid)) continue;
    const row = byPid.get(pid);
    // A pid that no longer exists is not a process: never count it.
    if (row === undefined) continue;
    seen.add(pid);
    rss += row.rss_kb;
    cpu += row.cpu_seconds;
    for (const child of childrenOf.get(pid) ?? []) stack.push(child);
  }
  return { processes: seen.size, rss_kb: rss, cpu_seconds: cpu };
};
