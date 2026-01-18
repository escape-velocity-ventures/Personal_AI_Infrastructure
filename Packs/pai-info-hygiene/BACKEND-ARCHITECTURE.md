# Information Hygiene Backend Architecture

## Current State (Prototype)

```
RSS Feeds → articles.json → Analysis → Terminal output
            (4hr TTL)
```

**Limitations:**
- No historical data
- No cross-session learning
- No semantic search
- No trend detection
- No persistent scoring

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     DATA COLLECTION LAYER                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  RSS Feeds ─┐                                                    │
│             │                                                    │
│  Web Search ├──► Article Extractor ──► Entity Extraction ──►    │
│             │         (Fabric)           (NER/LLM)              │
│  Social API ┘                                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      STORAGE LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │   DuckDB/SQLite  │    │  Vector Store    │                   │
│  │                  │    │  (Embeddings)    │                   │
│  │  • Articles      │    │                  │                   │
│  │  • Sources       │    │  • Semantic      │                   │
│  │  • Topics        │    │    similarity    │                   │
│  │  • Entities      │    │  • Cross-time    │                   │
│  │  • Timestamps    │    │    clustering    │                   │
│  │  • Bias scores   │    │  • Claim         │                   │
│  │  • Your reads    │    │    matching      │                   │
│  └──────────────────┘    └──────────────────┘                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ANALYSIS LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │ Pattern Analyzer │    │ Temporal Tracker │                   │
│  │                  │    │                  │                   │
│  │  • Wedge/bridge  │    │  • Coverage      │                   │
│  │  • Actor network │    │    evolution     │                   │
│  │  • Frame detect  │    │  • Narrative     │                   │
│  │  • Source bias   │    │    emergence     │                   │
│  └──────────────────┘    └──────────────────┘                   │
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │  Personal Score  │    │  Opposing View   │                   │
│  │                  │    │  Generator       │                   │
│  │  • Your reading  │    │                  │                   │
│  │    balance       │    │  • Steelman      │                   │
│  │  • Blind spots   │    │  • Best counter  │                   │
│  │  • Trend vs you  │    │    arguments     │                   │
│  └──────────────────┘    └──────────────────┘                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     REPORTING LAYER                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  CLI Reports       Web Dashboard       Email Digest              │
│  (current)         (future)            (future)                  │
│                                                                  │
│  • bun run brief   • Live spectrum     • Weekly hygiene          │
│  • bun run pattern • Topic explorer      score                   │
│  • bun run score   • Reading history   • Stories you missed      │
│                    • Trend charts      • Opposing views          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technology Choices

### Database: DuckDB

**Why DuckDB over SQLite:**
- Columnar storage = fast aggregation queries
- Built-in analytical functions (window functions, rollups)
- Parquet support for archives
- Can query JSON directly
- Still file-based (no server)

```typescript
import { Database } from 'duckdb';

const db = new Database('~/.cache/pai-info-hygiene/hygiene.duckdb');

// Fast aggregation
db.run(`
  SELECT
    date_trunc('day', published_at) as day,
    source_bias,
    COUNT(*) as article_count
  FROM articles
  WHERE topic ILIKE '%musk%'
  GROUP BY 1, 2
  ORDER BY 1
`);
```

### Vector Store: Local Option

**Options (no cloud dependency):**

1. **Chroma** - Python-based, can run via subprocess
2. **LanceDB** - Rust-based, has TypeScript bindings
3. **Built-in SQLite vectors** - Using sqlite-vec extension

**Recommended: LanceDB**
- Native TypeScript support
- File-based (like DuckDB)
- Fast similarity search
- Works with Bun

```typescript
import { connect } from "@lancedb/lancedb";

const db = await connect("~/.cache/pai-info-hygiene/vectors");
const table = await db.createTable("articles", [
  { id: "1", title: "...", embedding: [...], source: "NYT", bias: "lean-left" }
]);

// Find similar articles across time
const similar = await table
  .search(queryEmbedding)
  .filter("bias = 'right'")
  .limit(5);
```

### Embeddings: Local Generation

**Options:**
1. **Ollama** - Local LLM with embedding models
2. **Fabric** - Can wrap embedding calls
3. **Transformers.js** - Run in Bun directly

```bash
# Ollama embedding
ollama pull nomic-embed-text
curl http://localhost:11434/api/embeddings -d '{
  "model": "nomic-embed-text",
  "prompt": "Article title and content here"
}'
```

---

## Data Schema

### Articles Table

```sql
CREATE TABLE articles (
  id UUID PRIMARY KEY,
  url TEXT UNIQUE,
  title TEXT,
  content TEXT,
  snippet TEXT,
  source_id TEXT REFERENCES sources(id),
  bias TEXT, -- left, lean-left, center, lean-right, right
  published_at TIMESTAMP,
  fetched_at TIMESTAMP,

  -- Extracted metadata
  entities TEXT[], -- Named entities
  topics TEXT[],
  framing_keywords TEXT[],
  sentiment FLOAT, -- -1 to 1

  -- Analysis
  claim_ids TEXT[], -- Links to claims table
  embedding_id TEXT -- Links to vector store
);
```

### Claims Table

```sql
CREATE TABLE claims (
  id UUID PRIMARY KEY,
  text TEXT,
  article_id UUID REFERENCES articles(id),
  source_bias TEXT,
  first_seen TIMESTAMP,

  -- Tracking
  supporting_articles TEXT[],
  contradicting_articles TEXT[],
  fact_check_status TEXT, -- unchecked, true, false, mixed
  fact_check_source TEXT
);
```

### Reading History (Personal Hygiene)

```sql
CREATE TABLE reading_history (
  id UUID PRIMARY KEY,
  article_id UUID REFERENCES articles(id),
  read_at TIMESTAMP,
  time_spent_seconds INT,
  source_bias TEXT,
  topic TEXT
);

-- Daily hygiene score calculation
CREATE VIEW daily_hygiene AS
SELECT
  date_trunc('day', read_at) as day,
  COUNT(*) as articles_read,
  COUNT(CASE WHEN source_bias IN ('left', 'lean-left') THEN 1 END) as left_count,
  COUNT(CASE WHEN source_bias = 'center' THEN 1 END) as center_count,
  COUNT(CASE WHEN source_bias IN ('right', 'lean-right') THEN 1 END) as right_count,
  -- Balance score: 0 = all one side, 1 = perfect balance
  1.0 - ABS(left_count - right_count)::FLOAT / NULLIF(left_count + right_count, 0) as balance_score
FROM reading_history
GROUP BY 1;
```

---

## Data Collection Pipeline

### Scheduled Collection

```typescript
// collector.ts - runs every 4 hours via cron

async function collectArticles() {
  // 1. Fetch RSS
  const rssArticles = await fetchAllRSS();

  // 2. Deduplicate against DB
  const newArticles = await filterNew(rssArticles);

  // 3. Extract full content (if needed)
  for (const article of newArticles) {
    article.content = await extractWithFabric(article.url);
    article.entities = await extractEntities(article.content);
    article.embedding = await generateEmbedding(article.title + article.snippet);
  }

  // 4. Store
  await db.insert('articles', newArticles);
  await vectorStore.add(newArticles.map(a => ({
    id: a.id,
    embedding: a.embedding,
    metadata: { source: a.source, bias: a.bias, date: a.published_at }
  })));

  // 5. Update claims tracking
  await updateClaimNetwork(newArticles);
}
```

### Cron Setup

```bash
# Add to crontab
0 */4 * * * cd ~/EscapeVelocity/PersonalAI/PAI/Packs/pai-info-hygiene && bun run collect

# Or use launchd on macOS
# ~/Library/LaunchAgents/com.pai.info-hygiene.plist
```

---

## Query Patterns

### "What am I missing?"

```sql
-- Topics covered by opposing side that you haven't read
SELECT DISTINCT t.topic, t.source_bias, COUNT(*) as article_count
FROM articles a
JOIN article_topics t ON a.id = t.article_id
WHERE t.source_bias IN ('right', 'lean-right')
  AND t.topic NOT IN (
    SELECT topic FROM reading_history rh
    JOIN article_topics at ON rh.article_id = at.article_id
    WHERE rh.read_at > NOW() - INTERVAL '7 days'
  )
GROUP BY 1, 2
ORDER BY article_count DESC
LIMIT 10;
```

### "How did this narrative evolve?"

```sql
-- Track narrative emergence over time
SELECT
  date_trunc('day', published_at) as day,
  source_bias,
  COUNT(*) as articles,
  array_agg(DISTINCT framing_keywords) as frames
FROM articles
WHERE title ILIKE '%tesla%' OR content ILIKE '%tesla%'
GROUP BY 1, 2
ORDER BY 1;
```

### "Find best opposing argument"

```typescript
// Semantic search for opposing viewpoints
const myArticle = await getArticle(articleId);
const myBias = myArticle.source_bias;
const opposingBias = myBias.includes('left') ? ['right', 'lean-right'] : ['left', 'lean-left'];

const opposing = await vectorStore.search(myArticle.embedding)
  .filter(`bias IN (${opposingBias.map(b => `'${b}'`).join(',')})`)
  .limit(5);
```

---

## Integration Points

### Browser Extension (Future)

Track what you actually read:
```javascript
// content-script.js
if (isNewsArticle(window.location.href)) {
  const startTime = Date.now();
  window.addEventListener('beforeunload', () => {
    fetch('http://localhost:3847/reading', {
      method: 'POST',
      body: JSON.stringify({
        url: window.location.href,
        timeSpent: Date.now() - startTime
      })
    });
  });
}
```

### PAI Integration

```typescript
// In other PAI packs
import { InfoHygiene } from 'pai-info-hygiene';

const hygiene = new InfoHygiene();

// Before presenting news to user
const article = await fetchArticle(url);
const context = await hygiene.getContext(article);
// Returns: opposing views, related claims, your reading history on topic
```

### Daily Briefing Email

```typescript
// morning-briefing.ts
const hygiene = await getDailyHygieneScore();
const missed = await getTopStoriesYouMissed();
const opposing = await getTopOpposingViews();

await sendEmail({
  to: 'benjamin@...',
  subject: `Info Hygiene: ${hygiene.score}% balanced`,
  body: renderBriefing({ hygiene, missed, opposing })
});
```

---

## Implementation Phases

### Phase 1: Persistent Storage (Next)
- [ ] Add DuckDB for article storage
- [ ] Migrate from JSON cache
- [ ] Add historical queries
- [ ] Retention policy (keep 90 days?)

### Phase 2: Semantic Search
- [ ] Add LanceDB for embeddings
- [ ] Implement similarity search
- [ ] Cross-time narrative clustering
- [ ] "Find opposing view" improvements

### Phase 3: Personal Tracking
- [ ] Reading history capture
- [ ] Daily hygiene score
- [ ] Balance recommendations
- [ ] Browser extension (optional)

### Phase 4: Reporting
- [ ] Web dashboard
- [ ] Email digests
- [ ] Trend visualization
- [ ] Export/sharing

---

## Estimated Storage

Per day (18 sources × ~10 articles):
- ~180 articles
- ~100KB raw text
- ~50KB metadata
- ~1MB embeddings (180 × 1536 dims × 4 bytes)

Per month:
- ~5,400 articles
- ~30MB text + metadata
- ~30MB embeddings

**Very manageable for local storage.**

---

*Part of PAI Information Hygiene Research Project*
*January 18, 2026*
