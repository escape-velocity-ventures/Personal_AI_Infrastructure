import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { SearchResults } from '@/components/search/SearchResults';
import { useSearch } from '@/hooks/useSearch';

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [mode, setMode] = useState<'vector' | 'fts' | 'hybrid'>('hybrid');
  const [scope, setScope] = useState('all');
  const [memoryType, setMemoryType] = useState('all');
  const [tagsInput, setTagsInput] = useState('');
  const [limit, setLimit] = useState(20);

  useEffect(() => {
    const q = searchParams.get('q');
    if (q && q !== query) setQuery(q);
  }, [searchParams]);

  const tags = tagsInput
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const { data, isLoading } = useSearch(query, {
    mode,
    scope: scope === 'all' ? undefined : scope,
    memory_type: memoryType === 'all' ? undefined : memoryType,
    tags: tags.length > 0 ? tags : undefined,
    limit,
  });

  function handleQueryChange(value: string) {
    setQuery(value);
    if (value) {
      setSearchParams({ q: value });
    } else {
      setSearchParams({});
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Search</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search across your memory store
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search memories..."
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          className="pl-10 text-base"
        />
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Mode</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as any)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hybrid">Hybrid</SelectItem>
              <SelectItem value="vector">Vector</SelectItem>
              <SelectItem value="fts">Full Text</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Scope</Label>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="personal">Personal</SelectItem>
              <SelectItem value="org">Org</SelectItem>
              <SelectItem value="team">Team</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Memory Type</Label>
          <Select value={memoryType} onValueChange={setMemoryType}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="semantic">Semantic</SelectItem>
              <SelectItem value="episodic">Episodic</SelectItem>
              <SelectItem value="procedural">Procedural</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Tags</Label>
          <Input
            placeholder="tag1, tag2..."
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            className="w-48"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Limit ({limit})</Label>
          <input
            type="range"
            min={10}
            max={100}
            step={10}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="w-32"
          />
        </div>
      </div>

      <div>
        {isLoading && query && (
          <p className="py-8 text-center text-sm text-muted-foreground">Searching...</p>
        )}
        {data?.results && <SearchResults results={data.results} />}
        {!isLoading && query && data?.results?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No results for "{query}"
          </p>
        )}
        {!query && (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Type a query to search your memories
          </p>
        )}
      </div>
    </div>
  );
}
