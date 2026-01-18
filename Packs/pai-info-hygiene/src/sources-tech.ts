/**
 * Technology News Sources for Information Hygiene
 *
 * Balanced selection of tech news outlets across categories:
 * - General tech news
 * - Hardware/reviews
 * - EV/sustainability
 * - Science/engineering
 *
 * Note: Tech media overall tends to lean slightly left. Sources marked
 * 'center' are considered least-biased by fact-checkers.
 */

import type { BiasRating } from './sources';

export interface TechSource {
  name: string;
  rssUrl: string;
  website: string;
  bias: BiasRating;
  category: 'general' | 'hardware' | 'ev' | 'science' | 'aggregator';
  description: string;
  factualRating: 'high' | 'mostly-factual' | 'very-high';
}

export const TECH_SOURCES: TechSource[] = [
  // CENTER / LEAST BIASED
  {
    name: 'Ars Technica',
    rssUrl: 'https://feeds.arstechnica.com/arstechnica/index',
    website: 'arstechnica.com',
    bias: 'center',
    category: 'general',
    description: 'In-depth tech reporting. Rated Least Biased by MBFC.',
    factualRating: 'high'
  },
  {
    name: 'IEEE Spectrum',
    rssUrl: 'https://spectrum.ieee.org/feeds/feed.rss',
    website: 'spectrum.ieee.org',
    bias: 'center',
    category: 'science',
    description: 'Engineering and applied science. Pro-Science rated.',
    factualRating: 'very-high'
  },
  {
    name: 'Hacker News',
    rssUrl: 'https://hnrss.org/frontpage',
    website: 'news.ycombinator.com',
    bias: 'center',
    category: 'aggregator',
    description: 'Y Combinator tech aggregator. Diverse story selection.',
    factualRating: 'mostly-factual'
  },

  // LEAN-LEFT / LEFT-CENTER
  {
    name: 'The Verge',
    rssUrl: 'https://www.theverge.com/rss/index.xml',
    website: 'theverge.com',
    bias: 'lean-left',
    category: 'general',
    description: 'Tech, science, culture. Vox Media. High factual rating.',
    factualRating: 'high'
  },
  {
    name: 'TechCrunch',
    rssUrl: 'https://techcrunch.com/feed/',
    website: 'techcrunch.com',
    bias: 'lean-left',
    category: 'general',
    description: 'Startups, venture capital, Silicon Valley news.',
    factualRating: 'high'
  },
  {
    name: 'Wired',
    rssUrl: 'https://www.wired.com/feed/rss',
    website: 'wired.com',
    bias: 'lean-left',
    category: 'general',
    description: 'Tech, science, culture, security. Conde Nast.',
    factualRating: 'high'
  },
  {
    name: 'Engadget',
    rssUrl: 'https://www.engadget.com/rss.xml',
    website: 'engadget.com',
    bias: 'lean-left',
    category: 'general',
    description: 'Consumer electronics, gadgets, gaming. Yahoo owned.',
    factualRating: 'high'
  },
  {
    name: 'Electrek',
    rssUrl: 'https://electrek.co/feed/',
    website: 'electrek.co',
    bias: 'lean-left',
    category: 'ev',
    description: 'Electric vehicles, Tesla, sustainable energy.',
    factualRating: 'mostly-factual'
  },

  // HARDWARE (Generally neutral, product-focused)
  {
    name: 'Toms Hardware',
    rssUrl: 'https://www.tomshardware.com/feeds/all',
    website: 'tomshardware.com',
    bias: 'center',
    category: 'hardware',
    description: 'PC hardware reviews, benchmarks, buying guides.',
    factualRating: 'high'
  },
  {
    name: 'AnandTech',
    rssUrl: 'https://www.anandtech.com/rss/',
    website: 'anandtech.com',
    bias: 'center',
    category: 'hardware',
    description: 'Deep-dive hardware analysis and reviews.',
    factualRating: 'high'
  }
];

export function getTechSourcesByCategory(category: TechSource['category']): TechSource[] {
  return TECH_SOURCES.filter(s => s.category === category);
}

export function getTechSourcesByBias(bias: BiasRating): TechSource[] {
  return TECH_SOURCES.filter(s => s.bias === bias);
}
