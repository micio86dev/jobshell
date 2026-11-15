/**
 * Every adapter the runner, the bridge and the extension can use.
 *
 * The registry is the single place that knows a source id, so policy, the funnel
 * and the evidence all agree on what "iprogrammatori" means.
 */
import {
  arbeitnow,
  hn,
  himalayas,
  iprogrammatori,
  jobicy,
  jobspresso,
  remoteok,
  remotive,
  weworkremotely,
  workingnomads,
} from './feeds.ts';
import { ashby, lever, personio, recruitee } from './boards.ts';
import { greenhouse } from './greenhouse.ts';
import { indeed } from './indeed.ts';
import { linkedin } from './linkedin.ts';
import type { SourceAdapter } from './types.ts';

export const adapters: Record<string, SourceAdapter> = {
  arbeitnow,
  ashby,
  greenhouse,
  himalayas,
  hn,
  indeed,
  iprogrammatori,
  jobicy,
  jobspresso,
  lever,
  linkedin,
  personio,
  recruitee,
  remoteok,
  remotive,
  weworkremotely,
  workingnomads,
};

export const listSources = (): string[] => Object.keys(adapters).sort();

export const adapterFor = (id: string): SourceAdapter | null => adapters[id] ?? null;
