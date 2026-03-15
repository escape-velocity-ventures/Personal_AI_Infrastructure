import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Brain, Network, GitBranch, Clock, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { engram } from '@/lib/engram-client';
import { SearchResults } from '@/components/search/SearchResults';
import { cn } from '@/lib/utils';

const statusColors: Record<string, string> = {
  synced: 'bg-green-500/10 text-green-400 border-green-500/20',
  syncing: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  error: 'bg-red-500/10 text-red-400 border-red-500/20',
  pending: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
};

export function DashboardPage() {
  const navigate = useNavigate();
  const [quickSearch, setQuickSearch] = useState('');

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => engram.stats(),
  });

  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => engram.listSources(),
  });

  const { data: recentResults } = useQuery({
    queryKey: ['recent-memories'],
    queryFn: () => engram.search('', { limit: 10, mode: 'fts' }),
  });

  const { data: searchResults } = useQuery({
    queryKey: ['quick-search', quickSearch],
    queryFn: () => engram.search(quickSearch, { limit: 5 }),
    enabled: quickSearch.length > 2,
  });

  const lastSync = sources
    ?.filter((s: any) => s.last_synced_at)
    .sort((a: any, b: any) => new Date(b.last_synced_at).getTime() - new Date(a.last_synced_at).getTime())[0];

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (quickSearch.trim()) {
      navigate(`/search?q=${encodeURIComponent(quickSearch.trim())}`);
    }
  }

  const statCards = [
    { label: 'Total Memories', value: stats?.chunk_count ?? '-', icon: Brain },
    { label: 'Entities', value: stats?.entity_count ?? '-', icon: Network },
    { label: 'Sources', value: sources?.length ?? '-', icon: GitBranch },
    {
      label: 'Last Sync',
      value: lastSync?.last_synced_at
        ? new Date(lastSync.last_synced_at).toLocaleString()
        : 'Never',
      icon: Clock,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of your memory service
        </p>
      </div>

      <form onSubmit={handleSearchSubmit} className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Quick search memories..."
          value={quickSearch}
          onChange={(e) => setQuickSearch(e.target.value)}
          className="pl-10"
        />
      </form>

      {searchResults?.results?.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Search Results</h2>
          <SearchResults results={searchResults.results} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {statCards.map(({ label, value, icon: Icon }) => (
          <Card key={label} className="border-zinc-800">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {label}
              </CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {sources && sources.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Source Status</h2>
          <div className="grid grid-cols-2 gap-3">
            {sources.map((source: any) => (
              <Card key={source.id} className="border-zinc-800">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium">{source.name}</p>
                    <p className="text-xs text-muted-foreground">{source.source_type}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn('text-xs', statusColors[source.sync_status ?? 'pending'])}
                  >
                    {source.sync_status ?? 'pending'}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {recentResults?.results?.length > 0 && !quickSearch && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Recent Memories</h2>
          <SearchResults results={recentResults.results} showSimilarity={false} />
        </div>
      )}
    </div>
  );
}
