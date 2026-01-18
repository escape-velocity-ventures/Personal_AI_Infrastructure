/**
 * Energy & Utility Sources for Information Hygiene
 *
 * Industry and policy sources covering:
 * - Utility industry news and regulation
 * - Oil & gas markets and industry
 * - Data center power/infrastructure
 * - Clean energy transition
 * - Energy policy and markets
 *
 * Balanced coverage across traditional and renewable energy sectors.
 */

import type { BiasRating } from './sources';

export interface EnergySource {
  name: string;
  rssUrl: string;
  website: string;
  bias: BiasRating;
  focus: 'utility' | 'datacenter' | 'cleantech' | 'policy' | 'data' | 'oilgas';
  description: string;
  factualRating: 'high' | 'mostly-factual' | 'very-high';
}

export const ENERGY_SOURCES: EnergySource[] = [
  // CENTER / LEAST BIASED
  {
    name: 'Utility Dive',
    rssUrl: 'https://www.utilitydive.com/feeds/news/',
    website: 'utilitydive.com',
    bias: 'center',
    focus: 'utility',
    description: 'Industry Dive publication. Utility industry news, regulation, grid modernization.',
    factualRating: 'high'
  },
  {
    name: 'Data Center Knowledge',
    rssUrl: 'https://www.datacenterknowledge.com/rss.xml',
    website: 'datacenterknowledge.com',
    bias: 'center',
    focus: 'datacenter',
    description: 'Data center industry news. Power, cooling, infrastructure, AI compute.',
    factualRating: 'high'
  },
  {
    name: 'EIA Today in Energy',
    rssUrl: 'https://www.eia.gov/rss/todayinenergy.xml',
    website: 'eia.gov',
    bias: 'center',
    focus: 'data',
    description: 'US Energy Information Administration. Official government energy data and analysis.',
    factualRating: 'very-high'
  },
  {
    name: 'OilPrice.com',
    rssUrl: 'https://oilprice.com/rss/main',
    website: 'oilprice.com',
    bias: 'center',
    focus: 'oilgas',
    description: 'Global energy news and analysis. Oil, gas, commodities. MBFC: Least Biased, High factual.',
    factualRating: 'high'
  },
  {
    name: 'Rigzone',
    rssUrl: 'https://www.rigzone.com/news/rss/rigzone_latest.aspx',
    website: 'rigzone.com',
    bias: 'center',
    focus: 'oilgas',
    description: 'Oil and gas industry news, jobs, data. Professional trade publication.',
    factualRating: 'high'
  },

  // LEAN-LEFT / LEFT-CENTER
  {
    name: 'Canary Media',
    rssUrl: 'https://www.canarymedia.com/rss.rss',
    website: 'canarymedia.com',
    bias: 'lean-left',
    focus: 'cleantech',
    description: 'Clean energy transition coverage. Successor to GreenTech Media team.',
    factualRating: 'high'
  },
  {
    name: 'CleanTechnica',
    rssUrl: 'https://cleantechnica.com/feed/',
    website: 'cleantechnica.com',
    bias: 'lean-left',
    focus: 'cleantech',
    description: '#1 cleantech news site since 2008. Solar, EVs, batteries, clean energy.',
    factualRating: 'mostly-factual'
  }
];

export function getEnergySourcesByFocus(focus: EnergySource['focus']): EnergySource[] {
  return ENERGY_SOURCES.filter(s => s.focus === focus);
}

export function getEnergySourcesByBias(bias: BiasRating): EnergySource[] {
  return ENERGY_SOURCES.filter(s => s.bias === bias);
}
