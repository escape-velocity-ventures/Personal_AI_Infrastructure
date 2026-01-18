/**
 * News sources organized by AllSides bias rating
 * Ratings: Left (-6 to -3), Lean Left (-2.99 to -1), Center (-0.99 to +0.99),
 *          Lean Right (+1 to +2.99), Right (+3 to +6)
 */

export type BiasRating = 'left' | 'lean-left' | 'center' | 'lean-right' | 'right';

export interface NewsSource {
  name: string;
  bias: BiasRating;
  rssUrl: string;
  website: string;
}

export const NEWS_SOURCES: NewsSource[] = [
  // LEFT
  {
    name: 'The Guardian',
    bias: 'left',
    rssUrl: 'https://www.theguardian.com/us-news/rss',
    website: 'theguardian.com'
  },
  {
    name: 'Vox',
    bias: 'left',
    rssUrl: 'https://www.vox.com/rss/index.xml',
    website: 'vox.com'
  },
  {
    name: 'HuffPost',
    bias: 'left',
    rssUrl: 'https://www.huffpost.com/section/politics/feed',
    website: 'huffpost.com'
  },

  // LEAN LEFT
  {
    name: 'NPR',
    bias: 'lean-left',
    rssUrl: 'https://feeds.npr.org/1001/rss.xml',
    website: 'npr.org'
  },
  {
    name: 'New York Times',
    bias: 'lean-left',
    rssUrl: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    website: 'nytimes.com'
  },
  {
    name: 'CNN',
    bias: 'lean-left',
    rssUrl: 'http://rss.cnn.com/rss/cnn_topstories.rss',
    website: 'cnn.com'
  },
  {
    name: 'Politico',
    bias: 'lean-left',
    rssUrl: 'https://www.politico.com/rss/politicopicks.xml',
    website: 'politico.com'
  },

  // CENTER
  {
    name: 'BBC',
    bias: 'center',
    rssUrl: 'http://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml',
    website: 'bbc.com'
  },
  {
    name: 'The Hill',
    bias: 'center',
    rssUrl: 'https://thehill.com/feed/',
    website: 'thehill.com'
  },
  {
    name: 'USA Today',
    bias: 'center',
    rssUrl: 'http://rssfeeds.usatoday.com/usatoday-NewsTopStories',
    website: 'usatoday.com'
  },
  {
    name: 'ABC News',
    bias: 'center',
    rssUrl: 'https://abcnews.go.com/abcnews/topstories',
    website: 'abcnews.go.com'
  },

  // LEAN RIGHT
  {
    name: 'The Dispatch',
    bias: 'lean-right',
    rssUrl: 'https://thedispatch.com/feed/',
    website: 'thedispatch.com'
  },
  {
    name: 'Reason',
    bias: 'lean-right',
    rssUrl: 'https://reason.com/feed/',
    website: 'reason.com'
  },
  {
    name: 'Washington Examiner',
    bias: 'lean-right',
    rssUrl: 'https://www.washingtonexaminer.com/feed',
    website: 'washingtonexaminer.com'
  },

  // RIGHT
  {
    name: 'Fox News',
    bias: 'right',
    rssUrl: 'https://moxie.foxnews.com/google-publisher/latest.xml',
    website: 'foxnews.com'
  },
  {
    name: 'Daily Wire',
    bias: 'right',
    rssUrl: 'https://www.dailywire.com/feeds/rss.xml',
    website: 'dailywire.com'
  },
  {
    name: 'New York Post',
    bias: 'right',
    rssUrl: 'https://nypost.com/feed/',
    website: 'nypost.com'
  },
  {
    name: 'Breitbart',
    bias: 'right',
    rssUrl: 'https://feeds.feedburner.com/breitbart',
    website: 'breitbart.com'
  }
];

export function getSourcesByBias(bias: BiasRating): NewsSource[] {
  return NEWS_SOURCES.filter(s => s.bias === bias);
}

export function getBiasColor(bias: BiasRating): string {
  const colors: Record<BiasRating, string> = {
    'left': '\x1b[34m',       // Blue
    'lean-left': '\x1b[36m',  // Cyan
    'center': '\x1b[37m',     // White
    'lean-right': '\x1b[35m', // Magenta
    'right': '\x1b[31m'       // Red
  };
  return colors[bias];
}

export function getBiasLabel(bias: BiasRating): string {
  const labels: Record<BiasRating, string> = {
    'left': '◀◀ LEFT',
    'lean-left': '◀ LEAN LEFT',
    'center': '● CENTER',
    'lean-right': 'LEAN RIGHT ▶',
    'right': 'RIGHT ▶▶'
  };
  return labels[bias];
}
