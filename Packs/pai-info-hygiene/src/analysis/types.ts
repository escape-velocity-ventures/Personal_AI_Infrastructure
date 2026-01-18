/**
 * Content Analysis Types
 *
 * Schema for separating facts from narratives in news coverage.
 * Enables triangulation across sources to identify:
 * - What actually happened (agreed facts)
 * - How each side frames it (narrative)
 * - What each side omits (blind spots)
 */

/**
 * Content type classification
 * Wire services and straight reporting have minimal narrative
 * Analysis and opinion have increasing levels of framing
 */
export type ContentType =
  | 'wire'        // AP, Reuters, AFP - just facts
  | 'reporting'   // Original investigation, interviews
  | 'analysis'    // Facts + interpretation
  | 'opinion'     // Explicit viewpoint, op-ed
  | 'editorial';  // Institutional position

/**
 * A specific, verifiable claim extracted from an article
 */
export interface VerifiableClaim {
  claim: string;              // The specific statement
  source: string;             // Who made the claim (person/org)
  sourceType: 'named' | 'anonymous' | 'document' | 'data';
  verifiable: boolean;        // Can this be fact-checked?
  verified?: boolean;         // Has it been verified?
  factCheckUrl?: string;      // Link to fact-check if exists
  confidence: number;         // 0-1 extraction confidence
}

/**
 * A statistic or numerical claim
 */
export interface Statistic {
  value: string;              // The number/percentage
  context: string;            // What it measures
  source: string;             // Where the data comes from
  timeframe?: string;         // When the data is from
  verifiable: boolean;
}

/**
 * Named entity extracted from article
 */
export interface NamedEntity {
  name: string;
  type: 'person' | 'organization' | 'location' | 'event';
  role?: string;              // Their role in the story
  sentiment?: 'positive' | 'negative' | 'neutral';
}

/**
 * Narrative/framing detection
 */
export interface NarrativeAnalysis {
  framing: string;                    // How the subject is positioned
  emotionalLanguageScore: number;     // 0-1, higher = more emotional
  loadedTerms: LoadedTerm[];          // Words that carry implicit judgment
  headlines: {
    original: string;
    neutralized?: string;             // Same info, neutral framing
  };
  impliedConclusion?: string;         // What reader is led to believe
}

/**
 * A word or phrase that carries implicit judgment
 */
export interface LoadedTerm {
  term: string;
  neutralAlternative: string;
  bias: 'left' | 'right' | 'sensational';
}

/**
 * Cross-source triangulation result
 */
export interface Triangulation {
  eventId: string;                    // Identifier for the event/story
  eventDescription: string;           // What happened
  sources: TriangulatedSource[];
  agreedFacts: string[];              // Facts confirmed by 2+ sources
  contestedClaims: ContestedClaim[];  // Claims sources disagree on
  framingDifferences: FramingDiff[];  // How sources frame differently
  omissions: Omission[];              // What each side leaves out
}

/**
 * A source's coverage of an event
 */
export interface TriangulatedSource {
  articleId: string;
  sourceName: string;
  bias: string;
  contentType: ContentType;
  claims: VerifiableClaim[];
  entities: NamedEntity[];
  narrative: NarrativeAnalysis;
}

/**
 * A claim that sources disagree about
 */
export interface ContestedClaim {
  claim: string;
  leftPosition?: string;
  rightPosition?: string;
  factCheckResult?: string;
}

/**
 * How different sources frame the same event
 */
export interface FramingDiff {
  aspect: string;                     // What aspect of story
  leftFraming: string;
  centerFraming?: string;
  rightFraming: string;
}

/**
 * Facts that one side covers but another omits
 */
export interface Omission {
  fact: string;
  includedBy: string[];               // Sources that include it
  omittedBy: string[];                // Sources that leave it out
  significance: 'low' | 'medium' | 'high';
}

/**
 * Complete analysis of an article
 */
export interface ArticleAnalysis {
  articleId: string;
  url: string;
  sourceName: string;
  sourceBias: string;
  analyzedAt: string;

  // Classification
  contentType: ContentType;
  contentTypeConfidence: number;

  // Fact extraction
  claims: VerifiableClaim[];
  statistics: Statistic[];
  entities: NamedEntity[];
  primarySource: boolean;             // Is this original reporting?

  // Narrative detection
  narrative: NarrativeAnalysis;

  // Quality signals
  qualitySignals: {
    namedSourceCount: number;
    anonymousSourceCount: number;
    citedDocuments: number;
    hasDataVisualization: boolean;
    wordCount: number;
  };
}

/**
 * Loaded terms database - words that reveal bias
 */
export const LOADED_TERMS: Record<string, { neutral: string; bias: 'left' | 'right' | 'sensational' }> = {
  // ══════════════════════════════════════════════════════════
  // IMMIGRATION-SPECIFIC TERMS
  // ══════════════════════════════════════════════════════════

  // Left-leaning immigration terms
  'undocumented': { neutral: 'unauthorized immigrant', bias: 'left' },
  'undocumented immigrant': { neutral: 'unauthorized immigrant', bias: 'left' },
  'undocumented worker': { neutral: 'unauthorized worker', bias: 'left' },
  'undocumented person': { neutral: 'unauthorized immigrant', bias: 'left' },
  'migrant worker': { neutral: 'foreign worker', bias: 'left' },
  'asylum seeker': { neutral: 'asylum applicant', bias: 'left' },
  'detained families': { neutral: 'families in immigration custody', bias: 'left' },
  'family separation': { neutral: 'separating families at border', bias: 'left' },
  'caged children': { neutral: 'children in detention facilities', bias: 'left' },
  'kids in cages': { neutral: 'children in detention facilities', bias: 'left' },
  'deportation force': { neutral: 'immigration enforcement', bias: 'left' },
  'mass deportation': { neutral: 'large-scale removal', bias: 'left' },
  'raids': { neutral: 'enforcement operations', bias: 'left' },
  'ice raids': { neutral: 'ICE enforcement operations', bias: 'left' },
  'anti-immigrant': { neutral: 'immigration restrictionist', bias: 'left' },
  'xenophobic': { neutral: 'anti-immigration', bias: 'left' },
  'nativist': { neutral: 'immigration restrictionist', bias: 'left' },
  'dreamers': { neutral: 'DACA recipients', bias: 'left' },

  // Right-leaning immigration terms
  'illegal alien': { neutral: 'unauthorized immigrant', bias: 'right' },
  'illegal aliens': { neutral: 'unauthorized immigrants', bias: 'right' },
  'illegal immigrant': { neutral: 'unauthorized immigrant', bias: 'right' },
  'illegal immigrants': { neutral: 'unauthorized immigrants', bias: 'right' },
  'illegals': { neutral: 'unauthorized immigrants', bias: 'right' },
  'criminal alien': { neutral: 'noncitizen offender', bias: 'right' },
  'criminal aliens': { neutral: 'noncitizen offenders', bias: 'right' },
  'criminal illegal': { neutral: 'unauthorized immigrant with criminal record', bias: 'right' },
  'anchor baby': { neutral: 'U.S.-born child of unauthorized immigrants', bias: 'right' },
  'chain migration': { neutral: 'family-based immigration', bias: 'right' },
  'open borders': { neutral: 'less restrictive immigration policy', bias: 'right' },
  'open border': { neutral: 'less restrictive border policy', bias: 'right' },
  'border czar': { neutral: 'border policy coordinator', bias: 'right' },
  'catch and release': { neutral: 'release pending hearing', bias: 'right' },
  'amnesty': { neutral: 'legalization program', bias: 'right' },
  'sanctuary city': { neutral: 'limited cooperation city', bias: 'right' },
  'sanctuary state': { neutral: 'limited cooperation state', bias: 'right' },
  'sanctuary policies': { neutral: 'limited cooperation policies', bias: 'right' },
  'shielding illegals': { neutral: 'limiting immigration enforcement', bias: 'right' },
  'harboring illegals': { neutral: 'housing unauthorized immigrants', bias: 'right' },
  'flood of migrants': { neutral: 'increase in migration', bias: 'right' },
  'migrant flood': { neutral: 'increase in migration', bias: 'right' },
  'invasion': { neutral: 'large-scale migration', bias: 'right' },
  'border invasion': { neutral: 'high border crossings', bias: 'right' },
  'swarm': { neutral: 'large group', bias: 'right' },
  'horde': { neutral: 'large group', bias: 'right' },
  'abolish ice': { neutral: 'restructure immigration enforcement', bias: 'right' },

  // Immigration sensational terms (used by both)
  'border crisis': { neutral: 'border situation', bias: 'sensational' },
  'immigration crisis': { neutral: 'immigration situation', bias: 'sensational' },
  'humanitarian crisis': { neutral: 'humanitarian situation', bias: 'sensational' },
  'surge': { neutral: 'increase', bias: 'sensational' },
  'migrant surge': { neutral: 'migration increase', bias: 'sensational' },
  'border surge': { neutral: 'increase in border crossings', bias: 'sensational' },
  'overwhelmed': { neutral: 'strained', bias: 'sensational' },
  'overrun': { neutral: 'exceeded capacity', bias: 'sensational' },
  'flooded': { neutral: 'received many', bias: 'sensational' },

  // ══════════════════════════════════════════════════════════
  // GENERAL POLITICAL TERMS
  // ══════════════════════════════════════════════════════════

  // Left-leaning general terms
  'pro-choice': { neutral: 'abortion rights supporter', bias: 'left' },
  'climate denier': { neutral: 'climate change skeptic', bias: 'left' },
  'far-right': { neutral: 'conservative', bias: 'left' },
  'far right': { neutral: 'conservative', bias: 'left' },
  'extreme right': { neutral: 'strongly conservative', bias: 'left' },
  'ultra-conservative': { neutral: 'strongly conservative', bias: 'left' },
  'assault weapon': { neutral: 'semi-automatic rifle', bias: 'left' },
  'gun lobby': { neutral: 'gun rights groups', bias: 'left' },
  'dark money': { neutral: 'undisclosed political donations', bias: 'left' },
  'corporate greed': { neutral: 'profit maximization', bias: 'left' },
  'big oil': { neutral: 'oil industry', bias: 'left' },
  'big pharma': { neutral: 'pharmaceutical industry', bias: 'left' },

  // Right-leaning general terms
  'pro-life': { neutral: 'abortion opponent', bias: 'right' },
  'Democrat Party': { neutral: 'Democratic Party', bias: 'right' },
  'radical left': { neutral: 'progressive', bias: 'right' },
  'far left': { neutral: 'progressive', bias: 'right' },
  'far-left': { neutral: 'progressive', bias: 'right' },
  'extreme left': { neutral: 'strongly progressive', bias: 'right' },
  'mainstream media': { neutral: 'major news outlets', bias: 'right' },
  'legacy media': { neutral: 'traditional news outlets', bias: 'right' },
  'woke': { neutral: 'progressive', bias: 'right' },
  'wokeness': { neutral: 'progressive ideology', bias: 'right' },
  'wokeism': { neutral: 'progressive ideology', bias: 'right' },
  'socialist': { neutral: 'progressive', bias: 'right' },
  'socialists': { neutral: 'progressives', bias: 'right' },
  'radical agenda': { neutral: 'policy agenda', bias: 'right' },
  'activist judge': { neutral: 'judge', bias: 'right' },
  'elites': { neutral: 'establishment', bias: 'right' },
  'coastal elites': { neutral: 'urban professionals', bias: 'right' },
  'deep state': { neutral: 'career government officials', bias: 'right' },
  'government overreach': { neutral: 'expanded government role', bias: 'right' },
  'job-killing': { neutral: 'potentially reducing employment', bias: 'right' },
  'tax and spend': { neutral: 'increased taxation and spending', bias: 'right' },

  // ══════════════════════════════════════════════════════════
  // TECH & BUSINESS TERMS
  // ══════════════════════════════════════════════════════════

  // Left-leaning tech/business terms
  'big tech': { neutral: 'major technology companies', bias: 'left' },
  'tech giants': { neutral: 'large technology companies', bias: 'left' },
  'tech oligarchs': { neutral: 'technology executives', bias: 'left' },
  'tech bros': { neutral: 'technology workers', bias: 'left' },
  'silicon valley elites': { neutral: 'technology industry leaders', bias: 'left' },
  'billionaire class': { neutral: 'wealthy individuals', bias: 'left' },
  'robber barons': { neutral: 'wealthy business leaders', bias: 'left' },
  'union busting': { neutral: 'opposing unionization', bias: 'left' },
  'union buster': { neutral: 'anti-union employer', bias: 'left' },
  'wage theft': { neutral: 'unpaid wages dispute', bias: 'left' },
  'price gouging': { neutral: 'significant price increase', bias: 'left' },
  'predatory pricing': { neutral: 'aggressive pricing strategy', bias: 'left' },
  'predatory lending': { neutral: 'high-risk lending', bias: 'left' },
  'corporate welfare': { neutral: 'business subsidies', bias: 'left' },
  'tax dodging': { neutral: 'tax minimization', bias: 'left' },
  'tax avoidance scheme': { neutral: 'tax planning strategy', bias: 'left' },
  'offshore tax haven': { neutral: 'low-tax jurisdiction', bias: 'left' },
  'worker exploitation': { neutral: 'labor practices concerns', bias: 'left' },
  'exploiting workers': { neutral: 'labor practices', bias: 'left' },
  'sweatshop': { neutral: 'low-wage manufacturing', bias: 'left' },
  'gig economy exploitation': { neutral: 'gig work model', bias: 'left' },
  'monopoly power': { neutral: 'market dominance', bias: 'left' },
  'monopolistic': { neutral: 'market-dominant', bias: 'left' },
  'anti-competitive': { neutral: 'limiting competition', bias: 'left' },
  'corporate profiteering': { neutral: 'profit-seeking', bias: 'left' },
  'vulture capitalism': { neutral: 'investment strategy', bias: 'left' },
  'strip and flip': { neutral: 'asset restructuring', bias: 'left' },
  'golden parachute': { neutral: 'executive severance', bias: 'left' },
  'obscene profits': { neutral: 'high profits', bias: 'left' },
  'windfall profits': { neutral: 'high profits', bias: 'left' },
  'data harvesting': { neutral: 'data collection', bias: 'left' },
  'surveillance capitalism': { neutral: 'data-driven business model', bias: 'left' },
  'privacy invasion': { neutral: 'data collection practices', bias: 'left' },
  'layoff massacre': { neutral: 'significant layoffs', bias: 'left' },
  'mass layoffs': { neutral: 'significant workforce reduction', bias: 'left' },
  'slash and burn': { neutral: 'cost reduction', bias: 'left' },

  // Right-leaning tech/business terms
  'job creators': { neutral: 'employers', bias: 'right' },
  'wealth creators': { neutral: 'business owners', bias: 'right' },
  'business friendly': { neutral: 'supportive of business', bias: 'right' },
  'pro-growth': { neutral: 'growth-oriented', bias: 'right' },
  'anti-business': { neutral: 'business regulation', bias: 'right' },
  'anti-business agenda': { neutral: 'regulatory policy', bias: 'right' },
  'burdensome regulations': { neutral: 'regulations', bias: 'right' },
  'regulatory burden': { neutral: 'regulatory requirements', bias: 'right' },
  'red tape': { neutral: 'regulatory requirements', bias: 'right' },
  'nanny state': { neutral: 'government regulation', bias: 'right' },
  'bureaucratic overreach': { neutral: 'regulatory expansion', bias: 'right' },
  'tech censorship': { neutral: 'content moderation', bias: 'right' },
  'big tech censorship': { neutral: 'platform content moderation', bias: 'right' },
  'shadow ban': { neutral: 'reduced visibility', bias: 'right' },
  'shadowban': { neutral: 'reduced visibility', bias: 'right' },
  'deplatformed': { neutral: 'removed from platform', bias: 'right' },
  'cancel culture': { neutral: 'public criticism', bias: 'right' },
  'cancelled': { neutral: 'criticized', bias: 'right' },
  'woke corporations': { neutral: 'companies with progressive policies', bias: 'right' },
  'woke capitalism': { neutral: 'corporate social responsibility', bias: 'right' },
  'esg agenda': { neutral: 'ESG policies', bias: 'right' },
  'dei agenda': { neutral: 'diversity initiatives', bias: 'right' },
  'forced diversity': { neutral: 'diversity requirements', bias: 'right' },
  'virtue signaling': { neutral: 'public statements of values', bias: 'right' },
  'free market': { neutral: 'market economy', bias: 'right' },
  'free enterprise': { neutral: 'private business', bias: 'right' },
  'entrepreneurial spirit': { neutral: 'business initiative', bias: 'right' },
  'punishing success': { neutral: 'taxing high earners', bias: 'right' },
  'class warfare': { neutral: 'economic policy debate', bias: 'right' },
  'wealth redistribution': { neutral: 'progressive taxation', bias: 'right' },
  'socialist takeover': { neutral: 'increased regulation', bias: 'right' },
  'government takeover': { neutral: 'nationalization', bias: 'right' },

  // Tech/business sensational terms
  'plummets': { neutral: 'declines significantly', bias: 'sensational' },
  'plunges': { neutral: 'declines significantly', bias: 'sensational' },
  'crashes': { neutral: 'declines sharply', bias: 'sensational' },
  'crashing': { neutral: 'declining sharply', bias: 'sensational' },
  'nosedive': { neutral: 'significant decline', bias: 'sensational' },
  'freefall': { neutral: 'rapid decline', bias: 'sensational' },
  'collapse': { neutral: 'significant decline', bias: 'sensational' },
  'implodes': { neutral: 'fails', bias: 'sensational' },
  'skyrockets': { neutral: 'increases significantly', bias: 'sensational' },
  'soars': { neutral: 'increases significantly', bias: 'sensational' },
  'explodes': { neutral: 'grows rapidly', bias: 'sensational' },
  'rockets': { neutral: 'increases rapidly', bias: 'sensational' },
  'bloodbath': { neutral: 'significant losses', bias: 'sensational' },
  'carnage': { neutral: 'significant losses', bias: 'sensational' },
  'slaughter': { neutral: 'major defeat', bias: 'sensational' },
  'obliterated': { neutral: 'defeated significantly', bias: 'sensational' },
  'crushed': { neutral: 'defeated', bias: 'sensational' },
  'tanked': { neutral: 'declined', bias: 'sensational' },
  'tanks': { neutral: 'declines', bias: 'sensational' },
  'tumbles': { neutral: 'declines', bias: 'sensational' },
  'disrupts': { neutral: 'changes', bias: 'sensational' },
  'revolutionizes': { neutral: 'significantly changes', bias: 'sensational' },
  'game-changer': { neutral: 'significant development', bias: 'sensational' },
  'gamechanger': { neutral: 'significant development', bias: 'sensational' },
  'killer app': { neutral: 'popular application', bias: 'sensational' },
  'tesla killer': { neutral: 'Tesla competitor', bias: 'sensational' },
  'iphone killer': { neutral: 'iPhone competitor', bias: 'sensational' },

  // ══════════════════════════════════════════════════════════
  // AI-SPECIFIC TERMS
  // ══════════════════════════════════════════════════════════

  // Left/Safety-cautious framing (skeptical of AI progress)
  'ai doomer': { neutral: 'AI safety advocate', bias: 'right' },
  'ai doomers': { neutral: 'AI safety advocates', bias: 'right' },
  'agi doomer': { neutral: 'AI safety researcher', bias: 'right' },
  'agi doomers': { neutral: 'AI safety researchers', bias: 'right' },
  'doomerism': { neutral: 'safety concerns', bias: 'right' },
  'ai doomerism': { neutral: 'AI safety concerns', bias: 'right' },
  'doomers': { neutral: 'safety advocates', bias: 'right' },
  'ai hysteria': { neutral: 'AI safety debate', bias: 'right' },
  'ai fearmongering': { neutral: 'AI risk discussion', bias: 'right' },
  'fear mongering': { neutral: 'risk discussion', bias: 'right' },
  'ai panic': { neutral: 'AI concerns', bias: 'right' },
  'tech luddite': { neutral: 'technology skeptic', bias: 'right' },
  'luddites': { neutral: 'technology skeptics', bias: 'right' },
  'neo-luddite': { neutral: 'technology skeptic', bias: 'right' },
  'anti-progress': { neutral: 'cautious about technology', bias: 'right' },
  'progress blocker': { neutral: 'regulatory advocate', bias: 'right' },
  'stifling innovation': { neutral: 'regulating technology', bias: 'right' },
  'innovation killer': { neutral: 'regulation', bias: 'right' },
  'ai alarmist': { neutral: 'AI safety advocate', bias: 'right' },
  'alarmists': { neutral: 'safety advocates', bias: 'right' },
  'effective accelerationism': { neutral: 'pro-AI development movement', bias: 'right' },
  'e/acc': { neutral: 'accelerationist', bias: 'right' },
  'techno-optimist': { neutral: 'technology advocate', bias: 'right' },
  'techno-optimism': { neutral: 'positive technology outlook', bias: 'right' },
  'accelerationist': { neutral: 'rapid development advocate', bias: 'right' },

  // Right/Safety-focused framing (critical of unchecked AI)
  'ai bro': { neutral: 'AI industry advocate', bias: 'left' },
  'ai bros': { neutral: 'AI industry advocates', bias: 'left' },
  'tech bro': { neutral: 'technology worker', bias: 'left' },
  'move fast and break things': { neutral: 'rapid development approach', bias: 'left' },
  'reckless ai': { neutral: 'unregulated AI', bias: 'left' },
  'reckless development': { neutral: 'rapid development', bias: 'left' },
  'unchecked ai': { neutral: 'unregulated AI', bias: 'left' },
  'unaligned ai': { neutral: 'AI without safety measures', bias: 'left' },
  'misaligned ai': { neutral: 'AI behaving unexpectedly', bias: 'left' },
  'ai overlords': { neutral: 'AI companies', bias: 'left' },
  'silicon valley hubris': { neutral: 'technology industry confidence', bias: 'left' },
  'ai hype': { neutral: 'AI marketing', bias: 'left' },
  'hype cycle': { neutral: 'technology adoption pattern', bias: 'left' },
  'ai bubble': { neutral: 'AI investment trend', bias: 'left' },
  'vaporware': { neutral: 'unreleased product', bias: 'left' },
  'ai washing': { neutral: 'marketing as AI', bias: 'left' },
  'ai snake oil': { neutral: 'overpromised AI product', bias: 'left' },
  'digital colonialism': { neutral: 'global tech expansion', bias: 'left' },
  'algorithmic bias': { neutral: 'AI system disparities', bias: 'left' },
  'biased algorithm': { neutral: 'algorithm with disparate outcomes', bias: 'left' },
  'racist algorithm': { neutral: 'algorithm with racial disparities', bias: 'left' },
  'discriminatory ai': { neutral: 'AI with disparate outcomes', bias: 'left' },
  'job-killing ai': { neutral: 'automation', bias: 'left' },
  'replacing workers': { neutral: 'automation', bias: 'left' },
  'human trafficking ai': { neutral: 'AI misuse concerns', bias: 'left' },
  'deepfake porn': { neutral: 'non-consensual synthetic media', bias: 'left' },

  // AI sensational terms (hype from both sides)
  'agi': { neutral: 'advanced AI', bias: 'sensational' },
  'artificial general intelligence': { neutral: 'human-level AI', bias: 'sensational' },
  'superintelligence': { neutral: 'very advanced AI', bias: 'sensational' },
  'superintelligent': { neutral: 'very advanced', bias: 'sensational' },
  'sentient ai': { neutral: 'advanced AI system', bias: 'sensational' },
  'sentient': { neutral: 'advanced', bias: 'sensational' },
  'conscious ai': { neutral: 'advanced AI', bias: 'sensational' },
  'ai consciousness': { neutral: 'AI capabilities debate', bias: 'sensational' },
  'ai awakening': { neutral: 'AI advancement', bias: 'sensational' },
  'singularity': { neutral: 'theoretical AI milestone', bias: 'sensational' },
  'the singularity': { neutral: 'theoretical AI milestone', bias: 'sensational' },
  'technological singularity': { neutral: 'theoretical rapid AI advancement', bias: 'sensational' },
  'ai takeover': { neutral: 'increased AI adoption', bias: 'sensational' },
  'robot takeover': { neutral: 'increased automation', bias: 'sensational' },
  'ai apocalypse': { neutral: 'AI risk scenario', bias: 'sensational' },
  'ai armageddon': { neutral: 'AI risk scenario', bias: 'sensational' },
  'skynet': { neutral: 'AI risk reference', bias: 'sensational' },
  'terminator': { neutral: 'AI risk reference', bias: 'sensational' },
  'killer robots': { neutral: 'autonomous weapons', bias: 'sensational' },
  'killer robot': { neutral: 'autonomous weapon', bias: 'sensational' },
  'existential risk': { neutral: 'significant risk', bias: 'sensational' },
  'existential threat': { neutral: 'significant threat', bias: 'sensational' },
  'x-risk': { neutral: 'significant risk', bias: 'sensational' },
  'extinction risk': { neutral: 'severe risk scenario', bias: 'sensational' },
  'extinction event': { neutral: 'catastrophic scenario', bias: 'sensational' },
  'human extinction': { neutral: 'catastrophic scenario', bias: 'sensational' },
  'end of humanity': { neutral: 'catastrophic scenario', bias: 'sensational' },
  'humanity\'s last invention': { neutral: 'transformative AI', bias: 'sensational' },
  'ai revolution': { neutral: 'significant AI advancement', bias: 'sensational' },
  'ai breakthrough': { neutral: 'AI advancement', bias: 'sensational' },
  'ai miracle': { neutral: 'AI capability', bias: 'sensational' },
  'magic': { neutral: 'impressive capability', bias: 'sensational' },
  'mind-blowing': { neutral: 'impressive', bias: 'sensational' },
  'jaw-dropping': { neutral: 'impressive', bias: 'sensational' },
  'insane': { neutral: 'notable', bias: 'sensational' },
  'crazy': { neutral: 'notable', bias: 'sensational' },
  'game over': { neutral: 'significant change', bias: 'sensational' },
  'changes everything': { neutral: 'significant development', bias: 'sensational' },
  'nothing will be the same': { neutral: 'significant change', bias: 'sensational' },

  // ══════════════════════════════════════════════════════════
  // CLIMATE & ENERGY TERMS
  // ══════════════════════════════════════════════════════════

  // Left-coded climate terms (pro-action framing)
  'climate denier': { neutral: 'climate change skeptic', bias: 'left' },
  'climate deniers': { neutral: 'climate change skeptics', bias: 'left' },
  'climate denial': { neutral: 'climate change skepticism', bias: 'left' },
  'climate denialism': { neutral: 'climate skepticism', bias: 'left' },
  'denier': { neutral: 'skeptic', bias: 'left' },
  'science denier': { neutral: 'science skeptic', bias: 'left' },
  'fossil fuel industry': { neutral: 'oil and gas industry', bias: 'left' },
  'fossil fuel companies': { neutral: 'oil and gas companies', bias: 'left' },
  'fossil fuel interests': { neutral: 'energy industry interests', bias: 'left' },
  'big oil': { neutral: 'oil industry', bias: 'left' },
  'big coal': { neutral: 'coal industry', bias: 'left' },
  'dirty energy': { neutral: 'fossil fuel energy', bias: 'left' },
  'dirty fuel': { neutral: 'fossil fuel', bias: 'left' },
  'polluters': { neutral: 'emissions sources', bias: 'left' },
  'corporate polluters': { neutral: 'industrial emitters', bias: 'left' },
  'carbon pollution': { neutral: 'carbon emissions', bias: 'left' },
  'climate emergency': { neutral: 'climate change', bias: 'left' },
  'climate crisis': { neutral: 'climate change', bias: 'left' },
  'climate breakdown': { neutral: 'climate change effects', bias: 'left' },
  'climate chaos': { neutral: 'climate variability', bias: 'left' },
  'planet burning': { neutral: 'global warming', bias: 'left' },
  'burning planet': { neutral: 'warming planet', bias: 'left' },
  'climate justice': { neutral: 'climate policy equity', bias: 'left' },
  'environmental justice': { neutral: 'environmental equity', bias: 'left' },
  'environmental racism': { neutral: 'environmental inequity', bias: 'left' },
  'frontline communities': { neutral: 'affected communities', bias: 'left' },
  'sacrifice zones': { neutral: 'heavily impacted areas', bias: 'left' },
  'extractive': { neutral: 'resource-based', bias: 'left' },
  'extraction': { neutral: 'resource development', bias: 'left' },
  'greenwashing': { neutral: 'environmental marketing', bias: 'left' },
  'greenwash': { neutral: 'environmental marketing', bias: 'left' },
  'carbon footprint': { neutral: 'carbon emissions', bias: 'left' },
  'stranded assets': { neutral: 'devalued investments', bias: 'left' },
  'just transition': { neutral: 'energy transition', bias: 'left' },
  'keep it in the ground': { neutral: 'reduce fossil fuel extraction', bias: 'left' },
  'drill baby drill': { neutral: 'increase drilling', bias: 'left' },
  'petrostate': { neutral: 'oil-producing country', bias: 'left' },
  'climate refugees': { neutral: 'climate migrants', bias: 'left' },
  'eco-apartheid': { neutral: 'environmental inequality', bias: 'left' },

  // Right-coded climate terms (skeptical of climate action)
  'climate alarmist': { neutral: 'climate advocate', bias: 'right' },
  'climate alarmists': { neutral: 'climate advocates', bias: 'right' },
  'climate alarmism': { neutral: 'climate concern', bias: 'right' },
  'alarmism': { neutral: 'urgent warnings', bias: 'right' },
  'climate hysteria': { neutral: 'climate concern', bias: 'right' },
  'climate cult': { neutral: 'climate movement', bias: 'right' },
  'climate religion': { neutral: 'climate beliefs', bias: 'right' },
  'green agenda': { neutral: 'environmental policy', bias: 'right' },
  'radical green agenda': { neutral: 'environmental policy', bias: 'right' },
  'green new deal': { neutral: 'climate legislation proposal', bias: 'right' },
  'green extremists': { neutral: 'environmental activists', bias: 'right' },
  'green radicals': { neutral: 'environmental activists', bias: 'right' },
  'eco-terrorist': { neutral: 'environmental activist', bias: 'right' },
  'eco-terrorists': { neutral: 'environmental activists', bias: 'right' },
  'eco-extremist': { neutral: 'environmental activist', bias: 'right' },
  'eco-extremists': { neutral: 'environmental activists', bias: 'right' },
  'tree huggers': { neutral: 'environmentalists', bias: 'right' },
  'climate fanatics': { neutral: 'climate activists', bias: 'right' },
  'war on coal': { neutral: 'coal regulation', bias: 'right' },
  'war on energy': { neutral: 'energy regulation', bias: 'right' },
  'war on fossil fuels': { neutral: 'fossil fuel regulation', bias: 'right' },
  'war on oil': { neutral: 'oil industry regulation', bias: 'right' },
  'job-killing regulations': { neutral: 'environmental regulations', bias: 'right' },
  'job-killing policies': { neutral: 'environmental policies', bias: 'right' },
  'energy independence': { neutral: 'domestic energy production', bias: 'right' },
  'american energy': { neutral: 'domestic energy', bias: 'right' },
  'energy dominance': { neutral: 'energy leadership', bias: 'right' },
  'reliable energy': { neutral: 'consistent energy', bias: 'right' },
  'baseload power': { neutral: 'continuous power generation', bias: 'right' },
  'green energy boondoggle': { neutral: 'renewable energy project', bias: 'right' },
  'green subsidy': { neutral: 'clean energy incentive', bias: 'right' },
  'green subsidies': { neutral: 'clean energy incentives', bias: 'right' },
  'taxpayer-funded': { neutral: 'government-funded', bias: 'right' },
  'energy poverty': { neutral: 'energy affordability challenge', bias: 'right' },
  'blackout': { neutral: 'power outage', bias: 'right' },
  'rolling blackouts': { neutral: 'managed power outages', bias: 'right' },
  'grid instability': { neutral: 'grid variability', bias: 'right' },
  'unreliable renewables': { neutral: 'variable renewable energy', bias: 'right' },
  'intermittent energy': { neutral: 'variable energy', bias: 'right' },
  'failed green policies': { neutral: 'environmental policies', bias: 'right' },
  'carbon tax scam': { neutral: 'carbon pricing', bias: 'right' },
  'climate hoax': { neutral: 'climate skepticism', bias: 'right' },
  'global warming hoax': { neutral: 'climate skepticism', bias: 'right' },
  'junk science': { neutral: 'disputed research', bias: 'right' },
  'so-called experts': { neutral: 'researchers', bias: 'right' },
  'elitist environmentalism': { neutral: 'environmental movement', bias: 'right' },
  'virtue signaling': { neutral: 'public statements of values', bias: 'right' },
  'climate virtue signaling': { neutral: 'climate advocacy', bias: 'right' },

  // Climate/energy sensational terms (both sides)
  'climate apocalypse': { neutral: 'severe climate impacts', bias: 'sensational' },
  'climate armageddon': { neutral: 'severe climate impacts', bias: 'sensational' },
  'climate catastrophe': { neutral: 'significant climate impacts', bias: 'sensational' },
  'climate disaster': { neutral: 'climate-related event', bias: 'sensational' },
  'climate doom': { neutral: 'climate pessimism', bias: 'sensational' },
  'tipping point': { neutral: 'threshold', bias: 'sensational' },
  'tipping points': { neutral: 'thresholds', bias: 'sensational' },
  'point of no return': { neutral: 'critical threshold', bias: 'sensational' },
  'runaway warming': { neutral: 'accelerated warming', bias: 'sensational' },
  'runaway climate change': { neutral: 'accelerated climate change', bias: 'sensational' },
  'hothouse earth': { neutral: 'significantly warmer climate', bias: 'sensational' },
  'boiling planet': { neutral: 'warming planet', bias: 'sensational' },
  'climate bomb': { neutral: 'significant emissions source', bias: 'sensational' },
  'carbon bomb': { neutral: 'large emissions source', bias: 'sensational' },
  'methane bomb': { neutral: 'methane release', bias: 'sensational' },
  'death spiral': { neutral: 'decline', bias: 'sensational' },
  'mass extinction': { neutral: 'significant species loss', bias: 'sensational' },
  'sixth extinction': { neutral: 'biodiversity loss', bias: 'sensational' },
  'climate time bomb': { neutral: 'climate risk', bias: 'sensational' },
  'uninhabitable': { neutral: 'very difficult conditions', bias: 'sensational' },
  'uninhabitable earth': { neutral: 'severe climate impacts', bias: 'sensational' },
  'energy revolution': { neutral: 'energy transition', bias: 'sensational' },
  'green revolution': { neutral: 'clean energy transition', bias: 'sensational' },
  'clean energy boom': { neutral: 'clean energy growth', bias: 'sensational' },
  'renewable energy boom': { neutral: 'renewable energy growth', bias: 'sensational' },
  'solar boom': { neutral: 'solar growth', bias: 'sensational' },
  'ev revolution': { neutral: 'EV adoption', bias: 'sensational' },
  'electrification revolution': { neutral: 'electrification trend', bias: 'sensational' },
  'energy crisis': { neutral: 'energy supply challenge', bias: 'sensational' },
  'fuel crisis': { neutral: 'fuel supply challenge', bias: 'sensational' },
  'gas crisis': { neutral: 'gas supply challenge', bias: 'sensational' },
  'record heat': { neutral: 'high temperatures', bias: 'sensational' },
  'record temperatures': { neutral: 'high temperatures', bias: 'sensational' },
  'unprecedented heat': { neutral: 'extreme heat', bias: 'sensational' },
  'extreme weather': { neutral: 'severe weather', bias: 'sensational' },
  'weather on steroids': { neutral: 'intense weather', bias: 'sensational' },

  // ══════════════════════════════════════════════════════════
  // HEALTHCARE TERMS
  // ══════════════════════════════════════════════════════════

  // Left-coded healthcare terms (pro-universal/reform framing)
  'medicare for all': { neutral: 'single-payer healthcare proposal', bias: 'left' },
  'healthcare as a right': { neutral: 'universal healthcare', bias: 'left' },
  'big pharma': { neutral: 'pharmaceutical industry', bias: 'left' },
  'pharma lobby': { neutral: 'pharmaceutical industry lobbying', bias: 'left' },
  'drug companies': { neutral: 'pharmaceutical companies', bias: 'left' },
  'corporate healthcare': { neutral: 'private healthcare', bias: 'left' },
  'for-profit healthcare': { neutral: 'private healthcare', bias: 'left' },
  'healthcare profiteering': { neutral: 'healthcare pricing', bias: 'left' },
  'price gouging': { neutral: 'high pricing', bias: 'left' },
  'medical bankruptcy': { neutral: 'healthcare-related financial hardship', bias: 'left' },
  'insurance company': { neutral: 'health insurer', bias: 'left' },
  'insurance industry': { neutral: 'health insurance sector', bias: 'left' },
  'denied coverage': { neutral: 'coverage decision', bias: 'left' },
  'pre-existing condition': { neutral: 'prior health condition', bias: 'left' },
  'healthcare access': { neutral: 'healthcare availability', bias: 'left' },
  'healthcare equity': { neutral: 'healthcare distribution', bias: 'left' },
  'healthcare disparity': { neutral: 'healthcare differences', bias: 'left' },
  'reproductive healthcare': { neutral: 'reproductive medicine', bias: 'left' },
  'reproductive rights': { neutral: 'reproductive policy', bias: 'left' },
  'abortion rights': { neutral: 'abortion policy', bias: 'left' },
  'abortion access': { neutral: 'abortion availability', bias: 'left' },
  'forced birth': { neutral: 'abortion restrictions', bias: 'left' },
  'abortion ban': { neutral: 'abortion restriction', bias: 'left' },
  'anti-choice': { neutral: 'abortion opponent', bias: 'left' },
  'anti-abortion extremist': { neutral: 'abortion opponent', bias: 'left' },
  'healthcare desert': { neutral: 'limited healthcare area', bias: 'left' },
  'big insurance': { neutral: 'insurance industry', bias: 'left' },

  // Right-coded healthcare terms (pro-market/skeptical framing)
  'socialized medicine': { neutral: 'government healthcare', bias: 'right' },
  'government takeover': { neutral: 'government-run system', bias: 'right' },
  'government-run healthcare': { neutral: 'public healthcare', bias: 'right' },
  'rationed care': { neutral: 'healthcare allocation', bias: 'right' },
  'death panels': { neutral: 'healthcare review boards', bias: 'right' },
  'obamacare': { neutral: 'Affordable Care Act', bias: 'right' },
  'healthcare freedom': { neutral: 'healthcare choice', bias: 'right' },
  'medical freedom': { neutral: 'healthcare autonomy', bias: 'right' },
  'vaccine mandate': { neutral: 'vaccination requirement', bias: 'right' },
  'forced vaccination': { neutral: 'vaccination requirement', bias: 'right' },
  'jab': { neutral: 'vaccine', bias: 'right' },
  'big government healthcare': { neutral: 'public healthcare', bias: 'right' },
  'nanny state': { neutral: 'public health regulation', bias: 'right' },
  'healthcare choice': { neutral: 'healthcare options', bias: 'right' },
  'free market healthcare': { neutral: 'private healthcare', bias: 'right' },
  'abortion on demand': { neutral: 'unrestricted abortion access', bias: 'right' },
  'late-term abortion': { neutral: 'later abortion', bias: 'right' },
  'partial-birth abortion': { neutral: 'late-term procedure', bias: 'right' },
  'born-alive': { neutral: 'live birth', bias: 'right' },
  'pro-abortion': { neutral: 'abortion rights supporter', bias: 'right' },
  'abortion industry': { neutral: 'abortion providers', bias: 'right' },
  'abortion mill': { neutral: 'abortion clinic', bias: 'right' },
  'baby parts': { neutral: 'fetal tissue', bias: 'right' },
  'infanticide': { neutral: 'late-term abortion debate', bias: 'right' },
  'unborn child': { neutral: 'fetus', bias: 'right' },
  'unborn baby': { neutral: 'fetus', bias: 'right' },
  'preborn': { neutral: 'prenatal', bias: 'right' },
  'covid tyranny': { neutral: 'covid restrictions', bias: 'right' },
  'plandemic': { neutral: 'pandemic response criticism', bias: 'right' },
  'medical tyranny': { neutral: 'health mandates', bias: 'right' },

  // Healthcare sensational terms
  'healthcare crisis': { neutral: 'healthcare challenges', bias: 'sensational' },
  'healthcare collapse': { neutral: 'healthcare strain', bias: 'sensational' },
  'hospital overwhelmed': { neutral: 'hospital at capacity', bias: 'sensational' },
  'healthcare emergency': { neutral: 'healthcare challenge', bias: 'sensational' },
  'deadly drug': { neutral: 'drug with risks', bias: 'sensational' },
  'killer drug': { neutral: 'dangerous drug', bias: 'sensational' },
  'medical nightmare': { neutral: 'medical complication', bias: 'sensational' },
  'skyrocketing premiums': { neutral: 'rising premiums', bias: 'sensational' },
  'exploding costs': { neutral: 'rising costs', bias: 'sensational' },
  'out of control costs': { neutral: 'high costs', bias: 'sensational' },
  'pandemic': { neutral: 'widespread disease', bias: 'sensational' },
  'outbreak': { neutral: 'disease occurrence', bias: 'sensational' },
  'epidemic': { neutral: 'widespread occurrence', bias: 'sensational' },

  // ══════════════════════════════════════════════════════════
  // CRIME & JUSTICE TERMS
  // ══════════════════════════════════════════════════════════

  // Left-coded crime terms (reform-oriented framing)
  'mass incarceration': { neutral: 'high incarceration rate', bias: 'left' },
  'prison industrial complex': { neutral: 'prison system', bias: 'left' },
  'carceral state': { neutral: 'criminal justice system', bias: 'left' },
  'over-policing': { neutral: 'police presence', bias: 'left' },
  'police brutality': { neutral: 'police use of force', bias: 'left' },
  'police violence': { neutral: 'police use of force', bias: 'left' },
  'police killing': { neutral: 'police-involved death', bias: 'left' },
  'police murder': { neutral: 'police-involved death', bias: 'left' },
  'systemic racism': { neutral: 'institutional patterns', bias: 'left' },
  'racial profiling': { neutral: 'demographic-based policing', bias: 'left' },
  'defund the police': { neutral: 'police budget reallocation', bias: 'left' },
  'abolish the police': { neutral: 'police restructuring', bias: 'left' },
  'police accountability': { neutral: 'police oversight', bias: 'left' },
  'criminal justice reform': { neutral: 'justice system changes', bias: 'left' },
  'restorative justice': { neutral: 'alternative sentencing', bias: 'left' },
  'cash bail': { neutral: 'monetary bail', bias: 'left' },
  'money bail': { neutral: 'monetary bail', bias: 'left' },
  'for-profit prisons': { neutral: 'private prisons', bias: 'left' },
  'private prison': { neutral: 'privately-operated prison', bias: 'left' },
  'school-to-prison pipeline': { neutral: 'youth incarceration pathway', bias: 'left' },
  'wrongful conviction': { neutral: 'conviction error', bias: 'left' },
  'prosecutorial misconduct': { neutral: 'prosecutorial error', bias: 'left' },
  'police militarization': { neutral: 'police equipment', bias: 'left' },
  'excessive force': { neutral: 'use of force', bias: 'left' },
  'warrior cop': { neutral: 'aggressive policing', bias: 'left' },
  'police state': { neutral: 'heavy policing', bias: 'left' },
  'incarcerated person': { neutral: 'prisoner', bias: 'left' },
  'justice-involved': { neutral: 'criminal justice contact', bias: 'left' },
  'returning citizen': { neutral: 'released prisoner', bias: 'left' },
  'formerly incarcerated': { neutral: 'ex-prisoner', bias: 'left' },

  // Right-coded crime terms (law-and-order framing)
  'law and order': { neutral: 'public safety', bias: 'right' },
  'tough on crime': { neutral: 'strict sentencing', bias: 'right' },
  'soft on crime': { neutral: 'lenient sentencing', bias: 'right' },
  'pro-criminal': { neutral: 'reform-oriented', bias: 'right' },
  'catch and release': { neutral: 'pretrial release', bias: 'right' },
  'revolving door': { neutral: 'repeat offenders', bias: 'right' },
  'revolving door justice': { neutral: 'lenient sentencing', bias: 'right' },
  'soros prosecutor': { neutral: 'progressive prosecutor', bias: 'right' },
  'soros da': { neutral: 'progressive district attorney', bias: 'right' },
  'soros-backed': { neutral: 'progressive-aligned', bias: 'right' },
  'radical da': { neutral: 'progressive prosecutor', bias: 'right' },
  'woke prosecutor': { neutral: 'progressive prosecutor', bias: 'right' },
  'woke da': { neutral: 'progressive district attorney', bias: 'right' },
  'no-cash bail': { neutral: 'bail reform', bias: 'right' },
  'bail reform disaster': { neutral: 'bail reform effects', bias: 'right' },
  'blue cities': { neutral: 'Democratic-led cities', bias: 'right' },
  'democrat-run cities': { neutral: 'Democratic-led cities', bias: 'right' },
  'failed cities': { neutral: 'struggling cities', bias: 'right' },
  'urban decay': { neutral: 'urban decline', bias: 'right' },
  'inner city': { neutral: 'urban area', bias: 'right' },
  'back the blue': { neutral: 'police support', bias: 'right' },
  'thin blue line': { neutral: 'police solidarity', bias: 'right' },
  'defund disaster': { neutral: 'police budget effects', bias: 'right' },
  'criminal coddling': { neutral: 'lenient policy', bias: 'right' },
  'hardened criminal': { neutral: 'repeat offender', bias: 'right' },
  'career criminal': { neutral: 'repeat offender', bias: 'right' },
  'violent felon': { neutral: 'person with violent conviction', bias: 'right' },
  'thug': { neutral: 'criminal', bias: 'right' },
  'thugs': { neutral: 'criminals', bias: 'right' },
  'predator': { neutral: 'repeat offender', bias: 'right' },
  'animals': { neutral: 'criminals', bias: 'right' },

  // Crime sensational terms
  'crime wave': { neutral: 'crime increase', bias: 'sensational' },
  'crime surge': { neutral: 'crime increase', bias: 'sensational' },
  'crime spike': { neutral: 'crime increase', bias: 'sensational' },
  'crime spree': { neutral: 'series of crimes', bias: 'sensational' },
  'crime epidemic': { neutral: 'high crime rate', bias: 'sensational' },
  'crime crisis': { neutral: 'crime problem', bias: 'sensational' },
  'violent crime surge': { neutral: 'violent crime increase', bias: 'sensational' },
  'murder spike': { neutral: 'homicide increase', bias: 'sensational' },
  'murder surge': { neutral: 'homicide increase', bias: 'sensational' },
  'bloodbath': { neutral: 'violent incident', bias: 'sensational' },
  'war zone': { neutral: 'high-crime area', bias: 'sensational' },
  'lawless': { neutral: 'high crime', bias: 'sensational' },
  'lawlessness': { neutral: 'crime problem', bias: 'sensational' },
  'out of control': { neutral: 'increasing', bias: 'sensational' },
  'rampant crime': { neutral: 'widespread crime', bias: 'sensational' },
  'exploding crime': { neutral: 'rising crime', bias: 'sensational' },
  'reign of terror': { neutral: 'crime period', bias: 'sensational' },
  'streets unsafe': { neutral: 'safety concerns', bias: 'sensational' },
  'brazen': { neutral: 'bold', bias: 'sensational' },
  'horrific': { neutral: 'severe', bias: 'sensational' },
  'savage': { neutral: 'violent', bias: 'sensational' },
  'brutal': { neutral: 'violent', bias: 'sensational' },
  'heinous': { neutral: 'serious', bias: 'sensational' },
  'gruesome': { neutral: 'disturbing', bias: 'sensational' },

  // ══════════════════════════════════════════════════════════
  // SENSATIONAL TERMS (used by both sides)
  // ══════════════════════════════════════════════════════════
  'slammed': { neutral: 'criticized', bias: 'sensational' },
  'blasted': { neutral: 'criticized', bias: 'sensational' },
  'ripped': { neutral: 'criticized', bias: 'sensational' },
  'torched': { neutral: 'criticized', bias: 'sensational' },
  'eviscerated': { neutral: 'strongly criticized', bias: 'sensational' },
  'destroyed': { neutral: 'refuted', bias: 'sensational' },
  'demolished': { neutral: 'refuted', bias: 'sensational' },
  'annihilated': { neutral: 'defeated', bias: 'sensational' },
  'shocking': { neutral: 'notable', bias: 'sensational' },
  'bombshell': { neutral: 'significant', bias: 'sensational' },
  'explosive': { neutral: 'significant', bias: 'sensational' },
  'stunning': { neutral: 'unexpected', bias: 'sensational' },
  'outrage': { neutral: 'criticism', bias: 'sensational' },
  'outraged': { neutral: 'criticized', bias: 'sensational' },
  'fury': { neutral: 'strong disagreement', bias: 'sensational' },
  'chaos': { neutral: 'disorder', bias: 'sensational' },
  'crisis': { neutral: 'problem', bias: 'sensational' },
  'firestorm': { neutral: 'controversy', bias: 'sensational' },
  'backlash': { neutral: 'negative reaction', bias: 'sensational' },
  'meltdown': { neutral: 'strong reaction', bias: 'sensational' },
  'nightmare': { neutral: 'difficult situation', bias: 'sensational' },
  'catastrophe': { neutral: 'serious problem', bias: 'sensational' },
  'disaster': { neutral: 'serious problem', bias: 'sensational' },

  // ══════════════════════════════════════════════════════════
  // DISINFORMATION & PROPAGANDA TERMS
  // ══════════════════════════════════════════════════════════

  // Left-coded disinformation terms (skeptical of right-wing/foreign influence)
  'russian bot': { neutral: 'suspected coordinated account', bias: 'left' },
  'russian bots': { neutral: 'suspected coordinated accounts', bias: 'left' },
  'russian troll': { neutral: 'suspected influence operator', bias: 'left' },
  'troll farm': { neutral: 'coordinated influence operation', bias: 'left' },
  'russian disinformation': { neutral: 'foreign influence operation', bias: 'left' },
  'kremlin talking points': { neutral: 'Russian government position', bias: 'left' },
  'putin puppet': { neutral: 'Russia-aligned', bias: 'left' },
  'putin apologist': { neutral: 'Russia-sympathetic commentator', bias: 'left' },
  'right-wing disinformation': { neutral: 'conservative media claims', bias: 'left' },
  'right-wing conspiracy': { neutral: 'conservative theory', bias: 'left' },
  'maga extremist': { neutral: 'Trump supporter', bias: 'left' },
  'maga cult': { neutral: 'Trump movement', bias: 'left' },
  'qanon': { neutral: 'online conspiracy movement', bias: 'left' },
  'qanon conspiracy': { neutral: 'online conspiracy theory', bias: 'left' },
  'fox news propaganda': { neutral: 'Fox News coverage', bias: 'left' },
  'breitbart propaganda': { neutral: 'Breitbart coverage', bias: 'left' },
  'far-right conspiracy': { neutral: 'conservative theory', bias: 'left' },
  'white nationalist propaganda': { neutral: 'white nationalist content', bias: 'left' },
  'hate speech': { neutral: 'offensive speech', bias: 'left' },
  'dog whistle': { neutral: 'coded language', bias: 'left' },
  'stochastic terrorism': { neutral: 'incitement concerns', bias: 'left' },
  'radicalization': { neutral: 'ideological shift', bias: 'left' },
  'radicalized': { neutral: 'ideologically committed', bias: 'left' },
  'extremist content': { neutral: 'fringe content', bias: 'left' },
  'misinformation superspreader': { neutral: 'high-reach account', bias: 'left' },
  'disinformation campaign': { neutral: 'influence operation', bias: 'left' },
  'weaponized information': { neutral: 'strategic messaging', bias: 'left' },
  'information warfare': { neutral: 'strategic communication', bias: 'left' },
  'useful idiot': { neutral: 'unwitting amplifier', bias: 'left' },
  'useful idiots': { neutral: 'unwitting amplifiers', bias: 'left' },

  // Right-coded disinformation terms (skeptical of establishment/left media)
  'mainstream media': { neutral: 'major news outlets', bias: 'right' },
  'msm': { neutral: 'major news outlets', bias: 'right' },
  'legacy media': { neutral: 'traditional news outlets', bias: 'right' },
  'corporate media': { neutral: 'major news outlets', bias: 'right' },
  'fake news': { neutral: 'disputed reporting', bias: 'right' },
  'liberal media': { neutral: 'left-leaning outlets', bias: 'right' },
  'liberal bias': { neutral: 'editorial perspective', bias: 'right' },
  'media bias': { neutral: 'editorial perspective', bias: 'right' },
  'deep state': { neutral: 'permanent government', bias: 'right' },
  'globalist': { neutral: 'internationalist', bias: 'right' },
  'globalists': { neutral: 'internationalists', bias: 'right' },
  'globalist agenda': { neutral: 'international cooperation', bias: 'right' },
  'new world order': { neutral: 'international institutions', bias: 'right' },
  'establishment media': { neutral: 'major news outlets', bias: 'right' },
  'regime media': { neutral: 'government-aligned media', bias: 'right' },
  'state media': { neutral: 'government-funded media', bias: 'right' },
  'controlled opposition': { neutral: 'aligned critics', bias: 'right' },
  'fact-checkers': { neutral: 'verification services', bias: 'right' },
  'so-called fact-checkers': { neutral: 'verification services', bias: 'right' },
  'big tech censorship': { neutral: 'platform moderation', bias: 'right' },
  'silenced': { neutral: 'moderated', bias: 'right' },
  'deplatformed': { neutral: 'removed from platform', bias: 'right' },
  'canceled': { neutral: 'faced criticism', bias: 'right' },
  'cancel mob': { neutral: 'online critics', bias: 'right' },
  'thought police': { neutral: 'content moderators', bias: 'right' },
  'ministry of truth': { neutral: 'disinformation board', bias: 'right' },
  'narrative': { neutral: 'framing', bias: 'right' },
  'the narrative': { neutral: 'prevailing view', bias: 'right' },
  'official narrative': { neutral: 'official position', bias: 'right' },
  'propaganda': { neutral: 'one-sided messaging', bias: 'right' },
  'state propaganda': { neutral: 'government messaging', bias: 'right' },
  'psyop': { neutral: 'influence operation', bias: 'right' },
  'psy-op': { neutral: 'influence operation', bias: 'right' },
  'psychological operation': { neutral: 'influence operation', bias: 'right' },
  'gaslighting': { neutral: 'contradicting', bias: 'right' },
  'memory-holed': { neutral: 'removed from discussion', bias: 'right' },
  'truth-teller': { neutral: 'commentator', bias: 'right' },
  'truth bomb': { neutral: 'controversial claim', bias: 'right' },
  'red pill': { neutral: 'ideological conversion', bias: 'right' },
  'red-pilled': { neutral: 'ideologically converted', bias: 'right' },
  'wake up': { neutral: 'reconsider', bias: 'right' },
  'sheeple': { neutral: 'general public', bias: 'right' },
  'sheep': { neutral: 'conformists', bias: 'right' },
  'npc': { neutral: 'person with mainstream views', bias: 'right' },
  'npcs': { neutral: 'people with mainstream views', bias: 'right' },
  'brainwashed': { neutral: 'persuaded', bias: 'right' },
  'indoctrinated': { neutral: 'educated in', bias: 'right' },
  'indoctrination': { neutral: 'education', bias: 'right' },

  // Disinformation sensational/neutral-seeming but loaded terms
  'bot network': { neutral: 'coordinated accounts', bias: 'sensational' },
  'botnet': { neutral: 'coordinated accounts', bias: 'sensational' },
  'bot army': { neutral: 'coordinated accounts', bias: 'sensational' },
  'sock puppet': { neutral: 'fake account', bias: 'sensational' },
  'sock puppets': { neutral: 'fake accounts', bias: 'sensational' },
  'astroturfing': { neutral: 'coordinated campaign', bias: 'sensational' },
  'astroturf': { neutral: 'coordinated campaign', bias: 'sensational' },
  'foreign interference': { neutral: 'foreign influence', bias: 'sensational' },
  'election interference': { neutral: 'election influence attempts', bias: 'sensational' },
  'election meddling': { neutral: 'election influence attempts', bias: 'sensational' },
  'hybrid warfare': { neutral: 'multi-domain conflict', bias: 'sensational' },
  'active measures': { neutral: 'influence operations', bias: 'sensational' },
  'influence operation': { neutral: 'strategic communication campaign', bias: 'sensational' },
  'influence campaign': { neutral: 'strategic communication effort', bias: 'sensational' },
  'coordinated inauthentic behavior': { neutral: 'platform policy violation', bias: 'sensational' },
  'inauthentic behavior': { neutral: 'policy violation', bias: 'sensational' },
  'echo chamber': { neutral: 'like-minded community', bias: 'sensational' },
  'filter bubble': { neutral: 'personalized feed', bias: 'sensational' },
  'viral misinformation': { neutral: 'widely-shared disputed claim', bias: 'sensational' },
  'goes viral': { neutral: 'spreads widely', bias: 'sensational' },
  'went viral': { neutral: 'spread widely', bias: 'sensational' },
  'bombshell leak': { neutral: 'significant disclosure', bias: 'sensational' },
  'leaked documents': { neutral: 'disclosed documents', bias: 'sensational' },
  'whistleblower': { neutral: 'insider source', bias: 'sensational' },
  'exposed': { neutral: 'revealed', bias: 'sensational' },
  'unmasked': { neutral: 'identified', bias: 'sensational' },
  'caught red-handed': { neutral: 'documented', bias: 'sensational' },
  'smoking gun': { neutral: 'key evidence', bias: 'sensational' },
  'cover-up': { neutral: 'undisclosed information', bias: 'sensational' },
  'coverup': { neutral: 'undisclosed information', bias: 'sensational' },
  'buried': { neutral: 'not prominently covered', bias: 'sensational' },
  'suppressed': { neutral: 'not widely shared', bias: 'sensational' },
  'banned': { neutral: 'removed', bias: 'sensational' },
  'shadow banned': { neutral: 'reduced visibility', bias: 'sensational' },
  'shadowbanned': { neutral: 'reduced visibility', bias: 'sensational' },
  'censored': { neutral: 'moderated', bias: 'sensational' },
  'purged': { neutral: 'removed', bias: 'sensational' },
};

/**
 * URL patterns that indicate content type
 */
export const CONTENT_TYPE_PATTERNS: Record<ContentType, RegExp[]> = {
  wire: [/apnews\.com/, /reuters\.com/, /afp\.com/],
  reporting: [/investigation/, /exclusive/, /documents-show/],
  analysis: [/analysis/, /explainer/, /what-to-know/, /breakdown/],
  opinion: [/opinion/, /op-ed/, /oped/, /commentary/, /perspective/, /column/],
  editorial: [/editorial/, /editors/, /our-view/, /the-board/],
};
