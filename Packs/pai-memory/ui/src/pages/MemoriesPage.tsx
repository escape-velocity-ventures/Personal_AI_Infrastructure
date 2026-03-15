import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ChunkCard } from '@/components/memories/ChunkCard';
import { engram } from '@/lib/engram-client';

const PAGE_SIZE = 20;

export function MemoriesPage() {
  const queryClient = useQueryClient();
  const [sourceFilter, setSourceFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [tagsInput, setTagsInput] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const tags = tagsInput
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => engram.listSources(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['memories', sourceFilter, typeFilter, tags, page],
    queryFn: () =>
      engram.search('', {
        mode: 'fts',
        source_id: sourceFilter === 'all' ? undefined : sourceFilter,
        memory_type: typeFilter === 'all' ? undefined : typeFilter,
        tags: tags.length > 0 ? tags : undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => engram.deleteChunk(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memories'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const results = data?.results ?? [];
  const hasNext = results.length === PAGE_SIZE;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteSelected() {
    for (const id of selected) {
      await deleteMutation.mutateAsync(id);
    }
    setSelected(new Set());
  }

  async function exportSelected() {
    const chunks = results.filter((r: any) => selected.has(r.id));
    const blob = new Blob([JSON.stringify(chunks, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'memories-export.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Memories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse and manage memory chunks
          </p>
        </div>
        {selected.size > 0 && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportSelected}>
              Export ({selected.size})
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={deleteSelected}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Delete ({selected.size})
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Source</Label>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              {sources?.map((s: any) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Memory Type</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
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
      </div>

      <div className="space-y-3">
        {isLoading && (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
        )}
        {!isLoading && results.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No memories found
          </p>
        )}
        {results.map((chunk: any) => (
          <div key={chunk.id} className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={selected.has(chunk.id)}
              onChange={() => toggleSelect(chunk.id)}
              className="mt-4 h-4 w-4 shrink-0 rounded border-zinc-600"
            />
            <div className="flex-1">
              <ChunkCard chunk={chunk} />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">Page {page + 1}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => p + 1)}
          disabled={!hasNext}
        >
          Next
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
