/**
 * Reddit Subreddits for Information Hygiene
 *
 * Balanced selection across political spectrum.
 * Uses Reddit RSS feeds (no API key required).
 *
 * RSS Format: https://www.reddit.com/r/SUBREDDIT/top/.rss?t=day
 */

import type { BiasRating } from './sources';

export interface RedditSubreddit {
  name: string;
  subreddit: string;
  bias: BiasRating;
  category: 'news' | 'discussion' | 'analysis';
  description: string;
  moderation: 'strict' | 'moderate' | 'light';
}

export const REDDIT_SUBREDDITS: RedditSubreddit[] = [
  // CENTER / NEUTRAL
  {
    name: 'Neutral Politics',
    subreddit: 'NeutralPolitics',
    bias: 'center',
    category: 'discussion',
    description: 'Fact-based political discussion. Strict sourcing requirements.',
    moderation: 'strict'
  },
  {
    name: 'Neutral News',
    subreddit: 'neutralnews',
    bias: 'center',
    category: 'news',
    description: 'News with required neutral framing and sources.',
    moderation: 'strict'
  },
  {
    name: 'Geopolitics',
    subreddit: 'geopolitics',
    bias: 'center',
    category: 'analysis',
    description: 'International relations and geopolitical analysis.',
    moderation: 'strict'
  },
  {
    name: 'Moderate Politics',
    subreddit: 'moderatepolitics',
    bias: 'center',
    category: 'discussion',
    description: 'Civil political discussion across the spectrum.',
    moderation: 'moderate'
  },

  // LEFT
  {
    name: 'Politics',
    subreddit: 'politics',
    bias: 'left',
    category: 'news',
    description: 'Main political subreddit. Left-leaning community.',
    moderation: 'moderate'
  },
  {
    name: 'Progressive',
    subreddit: 'progressive',
    bias: 'left',
    category: 'discussion',
    description: 'Progressive politics and policy discussion.',
    moderation: 'moderate'
  },

  // LEAN-LEFT
  {
    name: 'Political Discussion',
    subreddit: 'PoliticalDiscussion',
    bias: 'lean-left',
    category: 'discussion',
    description: 'In-depth political discussion. Lean-left community.',
    moderation: 'moderate'
  },
  {
    name: 'News',
    subreddit: 'news',
    bias: 'lean-left',
    category: 'news',
    description: 'General news subreddit. Slightly left-leaning.',
    moderation: 'moderate'
  },

  // LEAN-RIGHT
  {
    name: 'Libertarian',
    subreddit: 'Libertarian',
    bias: 'lean-right',
    category: 'discussion',
    description: 'Libertarian political philosophy and news.',
    moderation: 'light'
  },
  {
    name: 'Tuesday',
    subreddit: 'tuesday',
    bias: 'lean-right',
    category: 'discussion',
    description: 'Center-right / moderate Republican discussion.',
    moderation: 'strict'
  },

  // RIGHT
  {
    name: 'Conservative',
    subreddit: 'Conservative',
    bias: 'right',
    category: 'news',
    description: 'Conservative news and discussion.',
    moderation: 'strict'
  },
  {
    name: 'Republicans',
    subreddit: 'Republican',
    bias: 'right',
    category: 'discussion',
    description: 'Republican party discussion.',
    moderation: 'moderate'
  }
];

export type RedditFeedType = 'hot' | 'new' | 'top';
export type RedditTimeframe = 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';

export function getRedditRssUrl(
  subreddit: RedditSubreddit,
  feedType: RedditFeedType = 'top',
  timeframe: RedditTimeframe = 'day'
): string {
  if (feedType === 'top') {
    return `https://www.reddit.com/r/${subreddit.subreddit}/${feedType}/.rss?t=${timeframe}`;
  }
  return `https://www.reddit.com/r/${subreddit.subreddit}/${feedType}/.rss`;
}

export function getRedditSubredditsByBias(bias: BiasRating): RedditSubreddit[] {
  return REDDIT_SUBREDDITS.filter(s => s.bias === bias);
}
