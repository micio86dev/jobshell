/**
 * Every adapter the runner, the bridge and the extension can use.
 *
 * The registry is the single place that knows a source id, so policy, the funnel
 * and the evidence all agree on what "iprogrammatori" means.
 */
import {
  arbeitnow,
  hn,
  iprogrammatori,
  jobicy,
  remoteok,
  remotive,
  weworkremotely,
  workingnomads,
} from './feeds.ts';
import { greenhouse } from './greenhouse.ts';
import { indeed } from './indeed.ts';
import { linkedin } from './linkedin.ts';
import type { SourceAdapter } from './types.ts';

export const adapters: Record<string, SourceAdapter> = {
  arbeitnow,
  greenhouse,
  hn,
  indeed,
  iprogrammatori,
  jobicy,
  linkedin,
  remoteok,
  remotive,
  weworkremotely,
  workingnomads,
};

export const listSources = (): string[] => Object.keys(adapters).sort();

export const adapterFor = (id: string): SourceAdapter | null => adapters[id] ?? null;
