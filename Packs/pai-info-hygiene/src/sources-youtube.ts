/**
 * YouTube Channels for Information Hygiene
 *
 * Balanced selection across political spectrum.
 * Uses YouTube RSS feeds for collection.
 *
 * RSS Format: https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID
 */

import type { BiasRating } from './sources';

export interface YouTubeChannel {
  name: string;
  channelId: string;
  handle: string;
  bias: BiasRating;
  category: 'news' | 'commentary' | 'analysis' | 'investigation';
  description: string;
}

export const YOUTUBE_CHANNELS: YouTubeChannel[] = [
  // CROSS-PARTISAN / CENTER
  {
    name: 'Breaking Points',
    channelId: 'UCDRIjKy6eZOvKtOELtTdeUA',
    handle: '@breakingpoints',
    bias: 'center',
    category: 'news',
    description: 'Krystal Ball (left) + Saagar Enjeti (right) co-host. Cross-partisan populist news.'
  },
  {
    name: 'Caspian Report',
    channelId: 'UCwnKziETDbHJtx78nIkfYug',
    handle: '@CaspianReport',
    bias: 'center',
    category: 'analysis',
    description: 'Geopolitical analysis with objective, fact-based approach.'
  },
  // NOTE: Ryan McBeth channel ID needs verification - handle is @RyanMcBethProgramming
  // {
  //   name: 'Ryan McBeth',
  //   channelId: 'NEEDS_VERIFICATION',
  //   handle: '@RyanMcBethProgramming',
  //   bias: 'center',
  //   category: 'investigation',
  //   description: 'Intelligence analyst. Disinformation detection and information warfare analysis.'
  // },

  // LEFT
  {
    name: 'The Young Turks',
    channelId: 'UC1yBKRuGpC1tSM73A0ZjYjQ',
    handle: '@TheYoungTurks',
    bias: 'left',
    category: 'news',
    description: 'Progressive news and commentary. Founded by Cenk Uygur.'
  },
  {
    name: 'Secular Talk',
    channelId: 'UCldfgbzNILYZA4dmDt4Cd6A',
    handle: '@SecularTalk',
    bias: 'left',
    category: 'commentary',
    description: 'Kyle Kulinski. Populist left perspective. 2.1M subscribers.'
  },

  // LEAN-LEFT
  {
    name: 'The Majority Report',
    channelId: 'UC-3jIAlnQmbbVMV6gR7K8aQ',
    handle: '@TheMajorityReport',
    bias: 'lean-left',
    category: 'news',
    description: 'Sam Seder. Daily political commentary and news analysis.'
  },
  {
    name: 'Brian Tyler Cohen',
    channelId: 'UCaXkIU1QidjPwiAYu6GcHjg',
    handle: '@BrianTylerCohen',
    bias: 'lean-left',
    category: 'commentary',
    description: 'Progressive political commentary. Clear, accessible analysis.'
  },
  {
    name: 'Pod Save America',
    channelId: 'UCKRoXz3hHAu2XL_k3Ef4vJQ',
    handle: '@PodSaveAmerica',
    bias: 'lean-left',
    category: 'commentary',
    description: 'Former Obama staffers discuss politics. Crooked Media.'
  },

  // LEAN-RIGHT
  {
    name: 'The Rubin Report',
    channelId: 'UCJdKr0Bgd_5saZYqLCa9mng',
    handle: '@RubinReport',
    bias: 'lean-right',
    category: 'commentary',
    description: 'Dave Rubin. Classical liberal / libertarian-leaning commentary.'
  },
  {
    name: 'Reason TV',
    channelId: 'UC0uVZd8N7FfIZnPu0y7o95A',
    handle: '@ReasonTV',
    bias: 'lean-right',
    category: 'news',
    description: 'Libertarian perspective on news and politics.'
  },

  // RIGHT
  {
    name: 'Daily Wire',
    channelId: 'UCaeO5vkdj5xOQHp4UmIN6dw',
    handle: '@DailyWire',
    bias: 'right',
    category: 'news',
    description: 'Conservative news and commentary. Ben Shapiro, Matt Walsh, etc.'
  },
  {
    name: 'Allie Beth Stuckey',
    channelId: 'UCx_2Vso6Qz76n-w5KV8DZcA',
    handle: '@AllieBethStuckey',
    bias: 'right',
    category: 'commentary',
    description: 'Christian conservative perspective. Host of "Relatable" podcast.'
  },
  {
    name: 'The Comments Section',
    channelId: 'UC7bYyWCCCLHDU0ZuNzGNTtg',
    handle: '@TheCommentsSection',
    bias: 'right',
    category: 'commentary',
    description: 'Daily Wire. Gen-Z conservative commentary. Now hosted by Reagan Conrad.'
  }
];

export function getYouTubeRssUrl(channel: YouTubeChannel): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`;
}

export function getYouTubeChannelsByBias(bias: BiasRating): YouTubeChannel[] {
  return YOUTUBE_CHANNELS.filter(c => c.bias === bias);
}
