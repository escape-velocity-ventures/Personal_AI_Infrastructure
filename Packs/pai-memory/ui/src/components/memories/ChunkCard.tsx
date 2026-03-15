import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface ChunkCardProps {
  chunk: {
    id: string;
    content: string;
    tags?: string[];
    source_name?: string;
    memory_type?: string;
    scope?: string;
    created_at?: string;
    entities?: string[];
    similarity?: number;
  };
  showSimilarity?: boolean;
}

const typeColors: Record<string, string> = {
  semantic: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  episodic: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  procedural: 'bg-green-500/10 text-green-400 border-green-500/20',
};

function SimilarityBar({ score }: { score: number }) {
  const color = score > 0.8 ? 'bg-green-500' : score > 0.6 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-zinc-800">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${score * 100}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{(score * 100).toFixed(0)}%</span>
    </div>
  );
}

export function ChunkCard({ chunk, showSimilarity = false }: ChunkCardProps) {
  const [expanded, setExpanded] = useState(false);
  const preview = chunk.content.slice(0, 200);
  const hasMore = chunk.content.length > 200;

  return (
    <Card
      className="cursor-pointer border-zinc-800 transition-colors hover:border-zinc-700"
      onClick={() => setExpanded(!expanded)}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {showSimilarity && chunk.similarity != null && (
              <SimilarityBar score={chunk.similarity} />
            )}
            <p className={cn('mt-1 text-sm', !expanded && 'line-clamp-3')}>
              {expanded ? chunk.content : preview}
              {!expanded && hasMore && '...'}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {chunk.memory_type && (
                <Badge variant="outline" className={cn('text-xs', typeColors[chunk.memory_type])}>
                  {chunk.memory_type}
                </Badge>
              )}
              {chunk.scope && (
                <Badge variant="outline" className="text-xs">
                  {chunk.scope}
                </Badge>
              )}
              {chunk.source_name && (
                <Badge variant="secondary" className="text-xs">
                  {chunk.source_name}
                </Badge>
              )}
              {chunk.tags?.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
            {expanded && chunk.entities && chunk.entities.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="text-xs text-muted-foreground">Entities:</span>
                {chunk.entities.map((e) => (
                  <span key={e} className="text-xs text-violet-400">
                    {e}
                  </span>
                ))}
              </div>
            )}
          </div>
          {chunk.created_at && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {new Date(chunk.created_at).toLocaleDateString()}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
