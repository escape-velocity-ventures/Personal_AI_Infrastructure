/**
 * Content Type Classifier
 *
 * Classifies articles by content type (wire/reporting/analysis/opinion/editorial)
 * and detects narrative elements like loaded terms and emotional language.
 */

import type { ContentType } from '../db/schema';
import { LOADED_TERMS, CONTENT_TYPE_PATTERNS, type LoadedTerm } from './types';

// Wire service domains - these produce minimal-narrative content
const WIRE_SERVICE_DOMAINS = [
  'apnews.com',
  'reuters.com',
  'afp.com',
];

// Sources known for specific content types
const SOURCE_CONTENT_TYPES: Record<string, ContentType> = {
  'AP News': 'wire',
  'Reuters': 'wire',
  'PBS NewsHour': 'reporting',
  'AllSides': 'analysis', // AllSides curates and provides context
};

interface ClassificationResult {
  contentType: ContentType;
  confidence: number;
  signals: string[];
}

interface NarrativeSignals {
  emotionalLanguageScore: number;
  loadedTerms: LoadedTerm[];
  signals: string[];
}

/**
 * Classify content type based on URL, source, and content signals
 */
export function classifyContentType(
  url: string,
  sourceName: string,
  title: string,
  content?: string | null
): ClassificationResult {
  const signals: string[] = [];
  let contentType: ContentType = 'unknown';
  let confidence = 0;

  // Check if source is known wire service
  if (SOURCE_CONTENT_TYPES[sourceName]) {
    contentType = SOURCE_CONTENT_TYPES[sourceName];
    signals.push(`Known source type: ${sourceName} → ${contentType}`);
    confidence = 0.9;
    return { contentType, confidence, signals };
  }

  // Check URL domain for wire services
  const urlLower = url.toLowerCase();
  for (const domain of WIRE_SERVICE_DOMAINS) {
    if (urlLower.includes(domain)) {
      contentType = 'wire';
      signals.push(`Wire service domain: ${domain}`);
      confidence = 0.85;
      return { contentType, confidence, signals };
    }
  }

  // Check URL patterns
  for (const [type, patterns] of Object.entries(CONTENT_TYPE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(url)) {
        contentType = type as ContentType;
        signals.push(`URL pattern match: ${pattern.source} → ${type}`);
        confidence = 0.75;
        return { contentType, confidence, signals };
      }
    }
  }

  // Check title for content type indicators
  const titleLower = title.toLowerCase();
  const titlePatterns: Record<ContentType, RegExp[]> = {
    wire: [],
    reporting: [/exclusive:/i, /investigation:/i, /documents show/i, /records reveal/i],
    analysis: [/analysis:/i, /explainer:/i, /what to know/i, /explained:/i, /why\s/i, /how\s/i],
    opinion: [/opinion:/i, /op-ed:/i, /commentary:/i, /column:/i, /my view:/i],
    editorial: [/editorial:/i, /our view:/i, /the board:/i],
  };

  for (const [type, patterns] of Object.entries(titlePatterns)) {
    for (const pattern of patterns) {
      if (pattern.test(title)) {
        contentType = type as ContentType;
        signals.push(`Title pattern: ${pattern.source} → ${type}`);
        confidence = 0.7;
        return { contentType, confidence, signals };
      }
    }
  }

  // Analyze content if available
  if (content && content.length > 100) {
    const contentSignals = analyzeContentForType(content);
    if (contentSignals.suggestedType) {
      contentType = contentSignals.suggestedType;
      signals.push(...contentSignals.signals);
      confidence = contentSignals.confidence;
      return { contentType, confidence, signals };
    }
  }

  // Default to reporting with low confidence
  if (contentType === 'unknown') {
    contentType = 'reporting';
    signals.push('Default classification: reporting');
    confidence = 0.3;
  }

  return { contentType, confidence, signals };
}

/**
 * Analyze content text for type indicators
 */
function analyzeContentForType(content: string): {
  suggestedType: ContentType | null;
  confidence: number;
  signals: string[];
} {
  const signals: string[] = [];
  const contentLower = content.toLowerCase();

  // Opinion indicators - first person language
  const firstPersonCount = (content.match(/\bI\s+(think|believe|argue|feel|contend)/gi) || []).length;
  if (firstPersonCount >= 2) {
    signals.push(`First-person opinion language (${firstPersonCount} instances)`);
    return { suggestedType: 'opinion', confidence: 0.7, signals };
  }

  // Analysis indicators - explanatory language
  const analysisPatterns = /this (means|suggests|indicates|shows)|here's (why|what|how)|the (takeaway|bottom line)/gi;
  const analysisCount = (content.match(analysisPatterns) || []).length;
  if (analysisCount >= 2) {
    signals.push(`Explanatory/analysis language (${analysisCount} instances)`);
    return { suggestedType: 'analysis', confidence: 0.65, signals };
  }

  // Reporting indicators - attribution language
  const attributionPatterns = /according to|said in (a|an) (statement|interview)|officials (said|confirmed)|documents (show|reveal)/gi;
  const attributionCount = (content.match(attributionPatterns) || []).length;
  if (attributionCount >= 3) {
    signals.push(`Strong attribution (${attributionCount} instances)`);
    return { suggestedType: 'reporting', confidence: 0.6, signals };
  }

  return { suggestedType: null, confidence: 0, signals };
}

/**
 * Detect loaded terms and calculate emotional language score
 */
export function analyzeNarrative(title: string, content?: string | null): NarrativeSignals {
  const text = `${title} ${content || ''}`.toLowerCase();
  const signals: string[] = [];
  const detectedTerms: LoadedTerm[] = [];
  let emotionalScore = 0;

  // Detect loaded terms
  for (const [term, data] of Object.entries(LOADED_TERMS)) {
    const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi');
    const matches = text.match(regex);
    if (matches) {
      detectedTerms.push({
        term,
        neutralAlternative: data.neutral,
        bias: data.bias,
      });
      signals.push(`Loaded term: "${term}" (${data.bias}) → "${data.neutral}"`);
      // Weight: sensational terms add more to emotional score
      emotionalScore += data.bias === 'sensational' ? 0.15 : 0.08;
    }
  }

  // Check for additional emotional language patterns
  const emotionalPatterns = [
    { pattern: /\b(shocking|stunning|alarming|terrifying|horrifying)\b/gi, weight: 0.1 },
    { pattern: /\b(outrag|furious|enraged|livid)/gi, weight: 0.08 },
    { pattern: /\b(destroy|demolish|eviscerate|annihilate)/gi, weight: 0.08 },
    { pattern: /\b(hero|villain|monster|angel)/gi, weight: 0.06 },
    { pattern: /!{2,}/g, weight: 0.05 }, // Multiple exclamation marks
    { pattern: /\?{2,}/g, weight: 0.03 }, // Multiple question marks
  ];

  for (const { pattern, weight } of emotionalPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      emotionalScore += weight * matches.length;
      signals.push(`Emotional pattern: ${matches.slice(0, 3).join(', ')}${matches.length > 3 ? '...' : ''}`);
    }
  }

  // Cap at 1.0
  emotionalScore = Math.min(1, emotionalScore);

  return {
    emotionalLanguageScore: emotionalScore,
    loadedTerms: detectedTerms,
    signals,
  };
}

/**
 * Count named vs anonymous sources in content
 */
export function countSources(content: string): {
  namedCount: number;
  anonymousCount: number;
  signals: string[];
} {
  const signals: string[] = [];

  // Named source patterns - person said/stated
  const namedPatterns = [
    /([A-Z][a-z]+ [A-Z][a-z]+),?\s+(said|stated|told|confirmed|argued|noted)/g,
    /according to ([A-Z][a-z]+ [A-Z][a-z]+)/g,
  ];

  // Anonymous source patterns
  const anonymousPatterns = [
    /(a|an|one|two|three|several|multiple) (source|official|insider|person|people) (who|familiar|close)/gi,
    /sources (say|said|told|confirmed)/gi,
    /according to (a|an|one|two|three|several) (source|official|person)/gi,
    /(spoke|speaking) on (the )?condition of anonymity/gi,
  ];

  let namedCount = 0;
  let anonymousCount = 0;

  for (const pattern of namedPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      namedCount += matches.length;
    }
  }

  for (const pattern of anonymousPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      anonymousCount += matches.length;
    }
  }

  if (namedCount > 0) signals.push(`Named sources: ${namedCount}`);
  if (anonymousCount > 0) signals.push(`Anonymous sources: ${anonymousCount}`);

  return { namedCount, anonymousCount, signals };
}

/**
 * Check if article appears to be primary source reporting
 */
export function isPrimarySource(content: string, url: string): {
  isPrimary: boolean;
  signals: string[];
} {
  const signals: string[] = [];
  let score = 0;

  // Check for exclusive/investigation indicators
  if (/exclusive|investigation|documents (obtained|reviewed|show)/i.test(content)) {
    score += 2;
    signals.push('Exclusive/investigation language');
  }

  // Check for original interviews
  if (/(interviewed|spoke (with|to)|in an interview)/i.test(content)) {
    score += 1;
    signals.push('Original interview content');
  }

  // Check for document citations
  if (/(according to (documents|records|data)|documents show|records reveal)/i.test(content)) {
    score += 1;
    signals.push('Document citations');
  }

  // Check for wire service citations (not primary)
  if (/(AP|Reuters|AFP|Associated Press) (reports?|contributed)/i.test(content)) {
    score -= 1;
    signals.push('Wire service attribution (secondary)');
  }

  return {
    isPrimary: score >= 2,
    signals,
  };
}

/**
 * Full article analysis combining all signals
 */
export function analyzeArticle(
  url: string,
  sourceName: string,
  title: string,
  content?: string | null
) {
  const classification = classifyContentType(url, sourceName, title, content);
  const narrative = analyzeNarrative(title, content);

  let sourceStats = { namedCount: 0, anonymousCount: 0, signals: [] as string[] };
  let primarySource = { isPrimary: false, signals: [] as string[] };

  if (content) {
    sourceStats = countSources(content);
    primarySource = isPrimarySource(content, url);
  }

  return {
    contentType: classification.contentType,
    contentTypeConfidence: classification.confidence,
    emotionalLanguageScore: narrative.emotionalLanguageScore,
    loadedTerms: narrative.loadedTerms,
    namedSourceCount: sourceStats.namedCount,
    anonymousSourceCount: sourceStats.anonymousCount,
    isPrimarySource: primarySource.isPrimary,
    allSignals: [
      ...classification.signals,
      ...narrative.signals,
      ...sourceStats.signals,
      ...primarySource.signals,
    ],
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
