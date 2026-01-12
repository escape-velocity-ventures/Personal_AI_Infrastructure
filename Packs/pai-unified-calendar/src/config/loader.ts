import { readFileSync, existsSync } from 'fs';
import YAML from 'yaml';
import type { CalendarConfig, CalendarSource } from '../types';

const CONFIG_PATHS = [
  `${process.env.HOME}/.claude/calendar-sources.yaml`,
  `${process.env.HOME}/.claude/calendar-sources.yml`,
  `${process.env.HOME}/.config/pai/calendar-sources.yaml`,
];

const DEFAULT_CONFIG: CalendarConfig = {
  sources: [],
  defaults: {
    days: 7,
    refreshInterval: '1h',
  },
};

export function getConfigPath(): string | null {
  for (const path of CONFIG_PATHS) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

export function loadConfig(): CalendarConfig {
  const configPath = getConfigPath();

  if (!configPath) {
    console.warn('No calendar-sources.yaml found. Using empty config.');
    return DEFAULT_CONFIG;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = YAML.parse(content) as CalendarConfig;

    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      defaults: {
        ...DEFAULT_CONFIG.defaults,
        ...parsed.defaults,
      },
    };
  } catch (error) {
    console.error(`Failed to load config from ${configPath}:`, error);
    return DEFAULT_CONFIG;
  }
}

export function getEnabledSources(config: CalendarConfig): CalendarSource[] {
  return config.sources.filter((source) => source.enabled !== false);
}

export function getSourcesByType<T extends CalendarSource>(
  config: CalendarConfig,
  type: T['type']
): T[] {
  return config.sources.filter((s) => s.type === type && s.enabled !== false) as T[];
}
