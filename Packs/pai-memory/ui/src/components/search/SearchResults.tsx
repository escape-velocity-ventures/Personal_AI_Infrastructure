import { ChunkCard } from '@/components/memories/ChunkCard';

interface SearchResultsProps {
  results: any[];
  showSimilarity?: boolean;
}

export function SearchResults({ results, showSimilarity = true }: SearchResultsProps) {
  if (results.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No results found
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {results.map((chunk: any) => (
        <ChunkCard key={chunk.id} chunk={chunk} showSimilarity={showSimilarity} />
      ))}
    </div>
  );
}
