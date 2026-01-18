/**
 * Automotive News Sources for Information Hygiene
 *
 * Mainstream automotive journalism covering:
 * - New vehicle coverage and reviews
 * - EV/Tesla/FSD technology
 * - Industry news and trends
 * - Car culture
 *
 * Provides perspective from automotive journalists vs tech media.
 */

import type { BiasRating } from './sources';

export interface AutoSource {
  name: string;
  rssUrl: string;
  website: string;
  bias: BiasRating;
  focus: 'general' | 'ev' | 'enthusiast' | 'industry';
  description: string;
  factualRating: 'high' | 'mostly-factual';
}

export const AUTO_SOURCES: AutoSource[] = [
  // CENTER / LEAST BIASED
  {
    name: 'Car and Driver',
    rssUrl: 'https://www.caranddriver.com/rss/all.xml/',
    website: 'caranddriver.com',
    bias: 'center',
    focus: 'general',
    description: 'Hearst publication since 1955. In-depth reviews and testing.',
    factualRating: 'high'
  },
  {
    name: 'The Drive',
    rssUrl: 'https://www.thedrive.com/feed',
    website: 'thedrive.com',
    bias: 'center',
    focus: 'enthusiast',
    description: 'Independent automotive news, culture, and analysis.',
    factualRating: 'high'
  },
  {
    name: 'Motor Trend',
    rssUrl: 'https://www.motortrend.com/feed/',
    website: 'motortrend.com',
    bias: 'center',
    focus: 'general',
    description: 'Largest automotive media company. Reviews and comparisons.',
    factualRating: 'high'
  },

  // LEAN-LEFT / LEFT-CENTER
  {
    name: 'Jalopnik',
    rssUrl: 'https://jalopnik.com/rss',
    website: 'jalopnik.com',
    bias: 'lean-left',
    focus: 'enthusiast',
    description: 'Car culture and industry news. G/O Media.',
    factualRating: 'high'
  },
  {
    name: 'Autoblog',
    rssUrl: 'https://www.autoblog.com/rss.xml',
    website: 'autoblog.com',
    bias: 'lean-left',
    focus: 'general',
    description: 'Yahoo-owned. News, reviews, and car buying guides.',
    factualRating: 'mostly-factual'
  },
  {
    name: 'InsideEVs',
    rssUrl: 'https://insideevs.com/rss/articles/all/',
    website: 'insideevs.com',
    bias: 'lean-left',
    focus: 'ev',
    description: 'Dedicated EV coverage. Motor1/Motorsport Network.',
    factualRating: 'high'
  }
];

export function getAutoSourcesByFocus(focus: AutoSource['focus']): AutoSource[] {
  return AUTO_SOURCES.filter(s => s.focus === focus);
}

export function getAutoSourcesByBias(bias: BiasRating): AutoSource[] {
  return AUTO_SOURCES.filter(s => s.bias === bias);
}
