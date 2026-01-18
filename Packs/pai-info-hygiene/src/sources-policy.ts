/**
 * Public Policy Sources for Information Hygiene
 *
 * Think tanks, research institutions, and policy organizations across
 * the political spectrum. Covers immigration, gun policy, housing,
 * economics, healthcare, and other matters of public policy.
 *
 * ENHANCED METADATA: Includes funding sources and key personnel to
 * help understand the interests behind each source's framing.
 *
 * Source Selection Criteria:
 * - MBFC factual rating (High or better preferred)
 * - Transparent methodology
 * - Spectrum coverage (left to right)
 * - Documented funding sources where available
 */

import type { BiasRating } from './sources';

/**
 * Funding source with transparency level
 */
export interface FundingSource {
  name: string;
  type: 'foundation' | 'corporate' | 'government' | 'individual' | 'membership' | 'unknown';
  amount?: string; // e.g., "$1M+", "$10M+", "major donor"
  notes?: string;
}

/**
 * Key personnel with background
 */
export interface KeyPerson {
  name: string;
  role: string;
  background?: string; // Former positions, affiliations
}

/**
 * Network/affiliated organizations
 */
export interface NetworkAffiliation {
  name: string;
  relationship: 'founder' | 'sister-org' | 'funder' | 'partner' | 'spin-off';
  notes?: string;
}

/**
 * Enhanced policy source interface with funding/personnel tracking
 */
export interface PolicySource {
  name: string;
  rssUrl: string;
  website: string;
  bias: BiasRating;
  focus: PolicyFocus[];
  description: string;
  factualRating: 'very-high' | 'high' | 'mostly-factual' | 'mixed';

  // Enhanced metadata
  founded?: number;
  headquarters?: string;
  credibilityNote?: string;

  // Funding & personnel tracking
  funding?: {
    sources: FundingSource[];
    transparency: 'high' | 'moderate' | 'low' | 'opaque';
    notes?: string;
  };
  keyPersonnel?: KeyPerson[];
  network?: NetworkAffiliation[];
  controversies?: string[];
}

/**
 * Policy focus areas
 */
export type PolicyFocus =
  | 'immigration'
  | 'gun-policy'
  | 'housing'
  | 'economics'
  | 'healthcare'
  | 'education'
  | 'environment'
  | 'foreign-policy'
  | 'criminal-justice'
  | 'civil-rights'
  | 'labor'
  | 'technology'
  | 'general';

export const POLICY_SOURCES: PolicySource[] = [
  // ============================================================================
  // GOVERNMENT / NONPARTISAN - HIGHEST CREDIBILITY
  // ============================================================================
  {
    name: 'Congressional Budget Office',
    rssUrl: 'https://www.cbo.gov/publications/all/rss.xml',
    website: 'cbo.gov',
    bias: 'center',
    focus: ['economics', 'healthcare', 'general'],
    description: 'Nonpartisan agency providing budget and economic analysis to Congress.',
    factualRating: 'very-high',
    founded: 1974,
    headquarters: 'Washington, DC',
    credibilityNote: 'Legally required to be nonpartisan. Gold standard for fiscal analysis.',
    funding: {
      sources: [{ name: 'U.S. Congress', type: 'government' }],
      transparency: 'high',
      notes: 'Fully government funded'
    }
  },
  {
    name: 'GAO Reports',
    rssUrl: 'https://www.gao.gov/rss/reports.xml',
    website: 'gao.gov',
    bias: 'center',
    focus: ['general', 'economics', 'criminal-justice'],
    description: 'Government Accountability Office. Congressional watchdog and auditor.',
    factualRating: 'very-high',
    founded: 1921,
    headquarters: 'Washington, DC',
    credibilityNote: 'Independent, nonpartisan agency in legislative branch.',
    funding: {
      sources: [{ name: 'U.S. Congress', type: 'government' }],
      transparency: 'high'
    }
  },
  {
    name: 'CBP Border Security',
    rssUrl: 'https://www.cbp.gov/rss/border-security',
    website: 'cbp.gov',
    bias: 'center',
    focus: ['immigration'],
    description: 'Official U.S. Customs and Border Protection updates.',
    factualRating: 'high',
    credibilityNote: 'Government source. Verify with independent data.',
    funding: {
      sources: [{ name: 'DHS', type: 'government' }],
      transparency: 'high'
    }
  },
  {
    name: 'CBP Newsroom',
    rssUrl: 'https://www.cbp.gov/rss/newsroom',
    website: 'cbp.gov',
    bias: 'center',
    focus: ['immigration'],
    description: 'Official CBP newsroom and media releases.',
    factualRating: 'high',
    funding: {
      sources: [{ name: 'DHS', type: 'government' }],
      transparency: 'high'
    }
  },

  // ============================================================================
  // TRANSPARENCY / WATCHDOG ORGANIZATIONS
  // ============================================================================

  // --- MONEY IN POLITICS ---
  {
    name: 'OpenSecrets',
    rssUrl: 'https://www.opensecrets.org/news/feed/',
    website: 'opensecrets.org',
    bias: 'center',
    focus: ['economics', 'general'],
    description: 'Tracks money in US politics. Campaign finance, lobbying, dark money.',
    factualRating: 'very-high',
    founded: 1983,
    headquarters: 'Washington, DC',
    credibilityNote: 'MBFC: Least Biased, Very High Factual. Primary source for political money data.',
    funding: {
      sources: [
        { name: 'Pew Charitable Trusts', type: 'foundation' },
        { name: 'Ford Foundation', type: 'foundation' },
        { name: 'Open Society Foundations', type: 'foundation' },
        { name: 'Sunlight Foundation', type: 'foundation' }
      ],
      transparency: 'high',
      notes: 'Nonprofit. Bulk data at opensecrets.org/bulk-data. Merged with FollowTheMoney.'
    }
  },

  // --- INVESTIGATIVE JOURNALISM ---
  {
    name: 'ProPublica',
    rssUrl: 'https://www.propublica.org/feeds/propublica/main',
    website: 'propublica.org',
    bias: 'lean-left',
    focus: ['general', 'criminal-justice', 'economics', 'healthcare'],
    description: 'Nonprofit investigative journalism. Multiple Pulitzer Prize winner.',
    factualRating: 'very-high',
    founded: 2007,
    headquarters: 'New York, NY',
    credibilityNote: 'MBFC: Left-Center, Very High Factual. First online Pulitzer (2010).',
    funding: {
      sources: [
        { name: 'Sandler Foundation', type: 'foundation', amount: 'founding donor' },
        { name: 'MacArthur Foundation', type: 'foundation' },
        { name: 'Knight Foundation', type: 'foundation' },
        { name: 'Individual donors', type: 'individual' }
      ],
      transparency: 'high',
      notes: 'Nonprofit newsroom. Stories free to republish.'
    }
  },
  {
    name: 'ICIJ',
    rssUrl: 'https://www.icij.org/feed/',
    website: 'icij.org',
    bias: 'center',
    focus: ['economics', 'general', 'foreign-policy'],
    description: 'International Consortium of Investigative Journalists. Panama/Pandora Papers.',
    factualRating: 'very-high',
    founded: 1997,
    headquarters: 'Washington, DC',
    credibilityNote: 'MBFC: Least Biased, Very High Factual. 280+ journalists in 100+ countries.',
    funding: {
      sources: [
        { name: 'Open Society Foundations', type: 'foundation' },
        { name: 'Ford Foundation', type: 'foundation' },
        { name: 'Adessium Foundation', type: 'foundation' }
      ],
      transparency: 'high',
      notes: 'Global network. Spun off from Center for Public Integrity (1997).'
    }
  },
  // NOTE: POGO (pogo.org) RSS feed returns 404 - may have switched to newsletters only
  // Project on Government Oversight - Federal watchdog since 1981
  // MBFC: Least Biased, High Factual. Taking over Center for Public Integrity archives.

  // --- LEFT-LEANING WATCHDOGS ---
  {
    name: 'Exposed by CMD',
    rssUrl: 'https://www.exposedbycmd.org/feed/',
    website: 'exposedbycmd.org',
    bias: 'left',
    focus: ['economics', 'environment', 'labor', 'general'],
    description: 'Center for Media and Democracy. Publishes SourceWatch wiki.',
    factualRating: 'high',
    founded: 1993,
    headquarters: 'Madison, WI',
    credibilityNote: 'MBFC: Left, High Factual. Exposes corporate/conservative dark money.',
    funding: {
      sources: [
        { name: 'AFL-CIO', type: 'membership' },
        { name: 'AFSCME', type: 'membership' },
        { name: 'SEIU', type: 'membership' },
        { name: 'Foundation grants', type: 'foundation' }
      ],
      transparency: 'moderate',
      notes: 'Union-funded since 2012. Also runs SourceWatch.org, ALECexposed.org.'
    },
    network: [
      { name: 'SourceWatch', relationship: 'sister-org', notes: 'Wiki database of corporate/conservative groups' },
      { name: 'ALECexposed', relationship: 'sister-org', notes: 'Tracks ALEC model legislation' }
    ]
  },

  // --- RIGHT-LEANING WATCHDOGS ---
  {
    name: 'Capital Research Center',
    rssUrl: 'https://capitalresearch.org/feed/',
    website: 'capitalresearch.org',
    bias: 'right',
    focus: ['economics', 'general'],
    description: 'Conservative watchdog. Publishes InfluenceWatch wiki.',
    factualRating: 'mostly-factual',
    founded: 1984,
    headquarters: 'Washington, DC',
    credibilityNote: 'MBFC: Right, Mostly Factual. Counter to SourceWatch.',
    funding: {
      sources: [
        { name: 'Koch Industries', type: 'corporate' },
        { name: 'Exxon-Mobil', type: 'corporate' },
        { name: 'Lynde and Harry Bradley Foundation', type: 'foundation' },
        { name: 'DonorsTrust', type: 'foundation', notes: 'Dark money conduit' }
      ],
      transparency: 'low',
      notes: 'Koch/corporate funded. Runs InfluenceWatch.org (encyclopedia of liberal groups).'
    },
    network: [
      { name: 'InfluenceWatch', relationship: 'sister-org', notes: 'Wiki database of liberal/progressive groups' }
    ]
  },

  // NOTE: LittleSis (littlesis.org) tracks power networks but has no RSS - API/JSON only
  // NOTE: Transparify (transparify.org) rates think tank transparency but no news feed

  // ============================================================================
  // LEFT-CENTER THINK TANKS
  // ============================================================================
  // NOTE: Brookings Institution RSS feed has XML parsing issues
  // Their feed structure is malformed - may need manual monitoring
  // Funding: Ford Foundation, Gates Foundation, Hewlett Foundation
  // MBFC: Left-Center, Very High Factual

  // NOTE: Urban Institute does not have a public RSS feed

  // NOTE: Center for American Progress has bot protection (403)
  // Funding: George Soros/Open Society, Sandler Foundation
  // MBFC: Left, High Factual
  {
    name: 'American Immigration Council',
    rssUrl: 'https://immigrationimpact.com/feed/',
    website: 'americanimmigrationcouncil.org',
    bias: 'lean-left',
    focus: ['immigration'],
    description: 'Pro-immigration nonprofit. Immigration Impact blog.',
    factualRating: 'high',
    credibilityNote: 'Advocacy org but high factual reporting.'
  },

  // ============================================================================
  // CENTER / NONPARTISAN RESEARCH
  // ============================================================================
  // NOTE: RAND Corporation has bot protection on RSS feeds (404)
  // Funding: ~70% U.S. Government contracts, foundations, corporations
  // MBFC: Least Biased, Very High Factual

  // ============================================================================
  // RIGHT-CENTER / LIBERTARIAN
  // ============================================================================
  // NOTE: Cato Institute has bot protection on RSS feeds (Incapsula)
  // Funding: Koch Foundation, individual donors
  // MBFC: Right-Center, High Factual
  {
    name: 'American Enterprise Institute',
    rssUrl: 'https://www.aei.org/feed/',
    website: 'aei.org',
    bias: 'lean-right',
    focus: ['economics', 'foreign-policy', 'healthcare', 'education', 'general'],
    description: 'Center-right think tank. Free enterprise focus.',
    factualRating: 'high',
    founded: 1938,
    headquarters: 'Washington, DC',
    credibilityNote: 'MBFC: Right-Center, High Factual.',
    funding: {
      sources: [
        { name: 'Corporations', type: 'corporate' },
        { name: 'Conservative foundations', type: 'foundation' },
        { name: 'Scaife Foundation', type: 'foundation' }
      ],
      transparency: 'moderate'
    }
  },

  // ============================================================================
  // RIGHT / CONSERVATIVE
  // ============================================================================
  {
    name: 'Daily Signal (Heritage)',
    rssUrl: 'https://www.dailysignal.com/feed/',
    website: 'dailysignal.com',
    bias: 'right',
    focus: ['economics', 'immigration', 'foreign-policy', 'general'],
    description: 'News arm of Heritage Foundation. Conservative policy news.',
    factualRating: 'mostly-factual',
    founded: 1973,
    headquarters: 'Washington, DC',
    credibilityNote: 'MBFC: Right, Mostly Factual. Strong conservative advocacy.',
    funding: {
      sources: [
        { name: 'Richard Mellon Scaife', type: 'individual', amount: 'founding donor' },
        { name: 'Coors family', type: 'individual', amount: 'founding donor' },
        { name: 'Koch Foundation', type: 'foundation' },
        { name: 'DonorsTrust', type: 'foundation', notes: 'Dark money conduit' }
      ],
      transparency: 'low',
      notes: 'Does not fully disclose donors'
    },
    keyPersonnel: [
      { name: 'Kevin Roberts', role: 'President', background: 'Project 2025 architect' }
    ],
    controversies: ['Project 2025 transition plan']
  },
  {
    name: 'Center for Immigration Studies',
    rssUrl: 'https://cis.org/rss.xml',
    website: 'cis.org',
    bias: 'right',
    focus: ['immigration'],
    description: 'Restrictionist immigration think tank. Part of Tanton network.',
    factualRating: 'mixed',
    founded: 1985,
    headquarters: 'Washington, DC',
    credibilityNote: 'MBFC: Right, Mixed Factual. SPLC anti-immigrant designation.',
    funding: {
      sources: [
        { name: 'Colcom Foundation', type: 'foundation', amount: '$10M+', notes: 'Cordelia Scaife May bequest' },
        { name: 'John Tanton network', type: 'foundation' }
      ],
      transparency: 'low'
    },
    network: [
      { name: 'FAIR', relationship: 'sister-org', notes: 'Same founder' },
      { name: 'NumbersUSA', relationship: 'sister-org', notes: 'Tanton network' }
    ],
    keyPersonnel: [
      { name: 'John Tanton', role: 'Founder', background: 'White nationalist ties documented by SPLC' }
    ],
    controversies: ['Tanton network ties', 'SPLC hate group adjacent designation', 'Methodological criticism from Cato']
  }
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get sources by policy focus area
 */
export function getPolicySourcesByFocus(focus: PolicyFocus): PolicySource[] {
  return POLICY_SOURCES.filter(s => s.focus.includes(focus));
}

/**
 * Get sources by bias rating
 */
export function getPolicySourcesByBias(bias: BiasRating): PolicySource[] {
  return POLICY_SOURCES.filter(s => s.bias === bias);
}

/**
 * Get high-credibility sources only (excludes mixed factual)
 */
export function getCrediblePolicySources(): PolicySource[] {
  return POLICY_SOURCES.filter(s => s.factualRating !== 'mixed');
}

/**
 * Get sources with high funding transparency
 */
export function getTransparentPolicySources(): PolicySource[] {
  return POLICY_SOURCES.filter(s => s.funding?.transparency === 'high');
}

/**
 * Get sources covering specific topic
 */
export function getImmigrationSources(): PolicySource[] {
  return getPolicySourcesByFocus('immigration');
}

export function getGunPolicySources(): PolicySource[] {
  return getPolicySourcesByFocus('gun-policy');
}

export function getHousingSources(): PolicySource[] {
  return getPolicySourcesByFocus('housing');
}

export function getEconomicsSources(): PolicySource[] {
  return getPolicySourcesByFocus('economics');
}

/**
 * Analyze funding network - find sources with shared funders
 */
export function analyzeFundingNetwork(): Map<string, PolicySource[]> {
  const funderMap = new Map<string, PolicySource[]>();

  for (const source of POLICY_SOURCES) {
    if (source.funding?.sources) {
      for (const funder of source.funding.sources) {
        const existing = funderMap.get(funder.name) || [];
        existing.push(source);
        funderMap.set(funder.name, existing);
      }
    }
  }

  return funderMap;
}
