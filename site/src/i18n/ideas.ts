import ideasFile from '../../../data/waitlist-ideas.json' with { type: 'json' };
import type { Lang } from './strings.js';

export interface Idea {
  id: string;
  kind: 'free' | 'paid';
  title: Record<Lang, string>;
  summary: Record<Lang, string>;
}

export const ideas: readonly Idea[] = ideasFile.ideas.map((i) => ({
  id: i.id,
  kind: i.kind === 'paid' ? 'paid' : 'free',
  title: i.title,
  summary: i.summary,
}));
