/**
 * Fact-Checking Sources for Information Hygiene
 *
 * Independent fact-checkers for claim verification and misinformation tracking.
 * All sources are IFCN signatories or widely recognized fact-checkers.
 *
 * These sources are rated 'center' as they aim for nonpartisan analysis,
 * though perception of bias may vary.
 */

import type { BiasRating } from './sources';

export interface FactCheckSource {
  name: string;
  rssUrl: string;
  website: string;
  bias: BiasRating;
  focus: 'political' | 'viral' | 'media' | 'general';
  description: string;
  ifcnCertified: boolean;
}

export const FACTCHECK_SOURCES: FactCheckSource[] = [
  // POLITICAL FACT-CHECKERS
  {
    name: 'PolitiFact',
    rssUrl: 'https://www.politifact.com/rss/all/',
    website: 'politifact.com',
    bias: 'center',
    focus: 'political',
    description: 'Pulitzer Prize-winning. Truth-O-Meter ratings for political claims.',
    ifcnCertified: true
  },
  {
    name: 'FactCheck.org',
    rssUrl: 'https://www.factcheck.org/feed/',
    website: 'factcheck.org',
    bias: 'center',
    focus: 'political',
    description: 'Annenberg Public Policy Center. Monitors political accuracy.',
    ifcnCertified: true
  },

  // VIRAL/GENERAL MISINFORMATION
  {
    name: 'Snopes',
    rssUrl: 'https://www.snopes.com/feed/',
    website: 'snopes.com',
    bias: 'center',
    focus: 'viral',
    description: 'Oldest fact-checker (1994). Urban legends, viral claims, rumors.',
    ifcnCertified: true
  },
  {
    name: 'Lead Stories',
    rssUrl: 'https://leadstories.com/atom.xml',
    website: 'leadstories.com',
    bias: 'center',
    focus: 'viral',
    description: 'Trendolizer tech to find viral misinformation. Facebook partner.',
    ifcnCertified: true
  },

  // INTERNATIONAL
  {
    name: 'Full Fact',
    rssUrl: 'https://fullfact.org/feed/',
    website: 'fullfact.org',
    bias: 'center',
    focus: 'general',
    description: 'UK independent charity. Politics, health, immigration claims.',
    ifcnCertified: true
  },

  // META / MEDIA ANALYSIS
  {
    name: 'Media Bias/Fact Check',
    rssUrl: 'https://mediabiasfactcheck.com/feed/',
    website: 'mediabiasfactcheck.com',
    bias: 'center',
    focus: 'media',
    description: 'Rates media outlets for bias and factual reporting. 10K+ sources.',
    ifcnCertified: false
  }
];

export function getFactCheckSourcesByFocus(focus: FactCheckSource['focus']): FactCheckSource[] {
  return FACTCHECK_SOURCES.filter(s => s.focus === focus);
}

export function getIFCNCertifiedSources(): FactCheckSource[] {
  return FACTCHECK_SOURCES.filter(s => s.ifcnCertified);
}
