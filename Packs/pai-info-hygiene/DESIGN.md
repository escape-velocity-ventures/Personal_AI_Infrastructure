# PAI Information Hygiene Dashboard

## Vision

Agent-curated information hygiene that surfaces **competing narratives** automatically, reducing the friction of manual curation while avoiding filter bubbles.

**Core Principle:** "If you deeply believe something and are completely unaware of the competing narrative, you are half blind."

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Information Hygiene Dashboard                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  RSS Agent   │  │  Bot Check   │  │   Opposing   │          │
│  │  Curator     │  │   Agent      │  │   View Agent │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                  │
│         ▼                  ▼                  ▼                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Hygiene Score Engine                  │   │
│  │  • Source diversity    • Bot exposure     • Blindspots  │   │
│  │  • Claim verification  • Echo chamber %   • Balance     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Daily Briefing                        │   │
│  │  "Today's topic where you might be half-blind: ____"    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. RSS Agent Curator

**Purpose:** Maintain balanced RSS feeds with automatic source diversity

**Sources by Bias (using AllSides ratings):**

| Category | Example Sources | RSS Feeds |
|----------|-----------------|-----------|
| Left | The Guardian, MSNBC, Vox | theguardian.com/rss, msnbc.com/feeds |
| Lean Left | NPR, NYT, WaPo | npr.org/rss, nytimes.com/rss |
| Center | Reuters, AP, BBC | reuters.com/rssfeed, apnews.com/rss |
| Lean Right | WSJ, The Dispatch | wsj.com/rss, thedispatch.com/rss |
| Right | Fox News, Daily Wire | foxnews.com/rss, dailywire.com/rss |

**Agent Workflow:**
```typescript
// Daily at 6 AM
async function curateBalancedFeed() {
  const stories = await fetchFromAllBiasCategories();
  const clustered = clusterBySameStory(stories); // Group same story across outlets

  for (const cluster of clustered) {
    const analysis = await fabric('analyze_claims', cluster.combined);
    const hasCompetingNarratives = cluster.sources.length >= 3;

    if (hasCompetingNarratives) {
      await saveToDailyBriefing({
        topic: cluster.headline,
        leftTake: cluster.left,
        centerTake: cluster.center,
        rightTake: cluster.right,
        claimAnalysis: analysis
      });
    }
  }
}
```

### 2. Bot Check Agent

**Purpose:** Automatically check accounts you're interacting with for authenticity

**APIs:**
- [Botometer API](https://pmc.ncbi.nlm.nih.gov/articles/PMC9391657/) - Indiana University, nominal fee for heavy use
- [Bot Sentinel API](https://developer.botsentinel.com/) - 95% accuracy classification

**Agent Workflow:**
```typescript
// When user shares/quotes a tweet
async function checkAccountAuthenticity(handle: string) {
  const [botometer, botSentinel] = await Promise.all([
    botometerAPI.check(handle),
    botSentinelAPI.check(handle)
  ]);

  const score = {
    botProbability: botometer.scores.universal,
    classification: botSentinel.category, // trustworthy, problematic, bot
    warning: botometer.scores.universal > 0.7 || botSentinel.category !== 'trustworthy'
  };

  if (score.warning) {
    notify(`⚠️ ${handle} has ${Math.round(score.botProbability * 100)}% bot probability`);
  }

  return score;
}
```

### 3. Opposing View Agent

**Purpose:** For any topic you're researching, automatically surface the strongest opposing argument

**Uses Fabric Patterns:**
- `analyze_claims` - Balanced claim analysis with evidence both ways
- `extract_extraordinary_claims` - Identify claims needing verification

**Agent Workflow:**
```typescript
// When user deep-dives on a topic
async function findOpposingView(topic: string, userApparentPosition: 'left' | 'right' | 'unknown') {
  // Search for strongest opposing arguments
  const opposingSources = userApparentPosition === 'left'
    ? ['Wall Street Journal', 'National Review', 'Reason']
    : ['The Atlantic', 'Vox', 'The New Yorker'];

  const opposingArticles = await searchNews(topic, { sources: opposingSources });
  const bestOpposing = await rankByArgumentStrength(opposingArticles);

  const analysis = await fabric('analyze_claims', bestOpposing[0]);

  return {
    headline: "The strongest opposing argument you should consider:",
    article: bestOpposing[0],
    claimAnalysis: analysis,
    steelMan: await fabric('create_steelman', bestOpposing[0])
  };
}
```

---

## Data Schema

### Daily Hygiene Score

```typescript
interface DailyHygieneScore {
  date: string;

  // Source diversity (0-100)
  sourceDiversity: {
    score: number;
    breakdown: {
      left: number;      // % of consumption
      leanLeft: number;
      center: number;
      leanRight: number;
      right: number;
    };
    recommendation: string;
  };

  // Bot exposure (0-100, lower is better)
  botExposure: {
    score: number;
    accountsChecked: number;
    flaggedAccounts: string[];
    highRiskInteractions: number;
  };

  // Blindspots detected
  blindspots: Array<{
    topic: string;
    yourSidesCoverage: number;    // articles from your usual sources
    otherSideCoverage: number;    // articles from opposing sources
    suggestedReading: string;
  }>;

  // Overall hygiene grade
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  insight: string;
}
```

### Competing Narratives Entry

```typescript
interface CompetingNarratives {
  id: string;
  topic: string;
  date: string;

  narratives: {
    left: {
      headline: string;
      source: string;
      url: string;
      keyPoints: string[];
    };
    center: {
      headline: string;
      source: string;
      url: string;
      keyPoints: string[];
    };
    right: {
      headline: string;
      source: string;
      url: string;
      keyPoints: string[];
    };
  };

  claimAnalysis: {
    sharedFacts: string[];           // What all sides agree on
    contestedClaims: string[];       // Where they disagree
    missingContext: string[];        // What none of them mention
  };

  userAction: 'read_all' | 'read_some' | 'skipped' | null;
}
```

---

## Integration Points

### Existing PAI Infrastructure

| Component | Integration |
|-----------|-------------|
| Fabric | `analyze_claims`, `extract_wisdom` patterns |
| TELOS Metrics | Track hygiene score as daily KPI |
| Voice Server | "Today's blindspot topic is..." |
| Memory | Store consumption patterns in ~/.claude/MEMORY |

### External APIs

| Service | Purpose | Cost |
|---------|---------|------|
| [Botometer](https://botometer.osome.iu.edu/) | Bot detection | Free tier + nominal for heavy use |
| [Bot Sentinel](https://developer.botsentinel.com/) | Account classification | Free API |
| [AllSides Data](https://github.com/favstats/AllSideR) | Bias ratings | Free (GitHub dataset) |
| NewsAPI / GNews | Article search | Free tier available |

---

## MVP Scope

### Phase 1: RSS Curator + Daily Briefing
- [ ] Set up RSS feeds from 5 bias categories
- [ ] Agent clusters same-story coverage
- [ ] Daily "competing narratives" briefing via voice

### Phase 2: Bot Check Integration
- [ ] Botometer API integration
- [ ] Warning system for high-risk accounts
- [ ] Weekly bot exposure report

### Phase 3: Opposing View Agent
- [ ] Topic detection from user queries
- [ ] Automatic steelman generation
- [ ] "Half-blind" alerts

### Phase 4: Dashboard UI
- [ ] Hygiene score visualization
- [ ] Source diversity breakdown
- [ ] Historical trends

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Source diversity score | > 70 (balanced across spectrum) |
| Bot exposure score | < 20% flagged interactions |
| Blindspot alerts acknowledged | > 50% read rate |
| Competing narratives consumed | 3+ per week |

---

## References

- [Ryan McBeth - Information Warfare Analysis](https://www.youtube.com/@ryanmcbethprogramming)
- [Cyabra](https://cyabra.com/) - Enterprise disinformation detection
- [AllSides](https://www.allsides.com/) - Media bias ratings
- [Botometer Research Paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC9391657/)
- [Fabric analyze_claims pattern](~/.config/fabric/patterns/analyze_claims/)
