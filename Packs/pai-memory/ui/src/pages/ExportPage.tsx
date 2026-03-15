import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, Loader2, FileJson, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { engram } from '@/lib/engram-client';
import { useSources, useTenants } from '@/hooks/useSources';

export function ExportPage() {
  const [tags, setTags] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [memoryType, setMemoryType] = useState('');
  const [scope, setScope] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [includeEmbeddings, setIncludeEmbeddings] = useState(false);
  const [format, setFormat] = useState('json');

  const { data: sources } = useSources();

  const exportMutation = useMutation({
    mutationFn: (filter: any) => engram.exportJson(filter),
  });

  function buildFilter() {
    const filter: Record<string, any> = {};
    if (tags.trim()) filter.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (sourceId) filter.source_ids = [sourceId];
    if (memoryType) filter.memory_types = [memoryType];
    if (scope) filter.scopes = [scope];
    if (dateFrom) filter.date_from = dateFrom;
    if (dateTo) filter.date_to = dateTo;
    if (includeEmbeddings) filter.include_embeddings = true;
    return filter;
  }

  function handleExport() {
    const filter = buildFilter();
    exportMutation.mutate(filter, {
      onSuccess: (data) => {
        const content = format === 'json'
          ? JSON.stringify(data, null, 2)
          : formatAsMarkdown(data);
        const blob = new Blob(
          [content],
          { type: format === 'json' ? 'application/json' : 'text/markdown' },
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `engram-export-${Date.now()}.${format === 'json' ? 'json' : 'md'}`;
        a.click();
        URL.revokeObjectURL(url);
      },
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Export</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Export memories with filters and download as JSON or Markdown
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-zinc-800 md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tags</Label>
                <Input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="curated, docs"
                />
              </div>
              <div className="space-y-2">
                <Label>Source</Label>
                <Select value={sourceId} onValueChange={setSourceId}>
                  <SelectTrigger><SelectValue placeholder="All sources" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All sources</SelectItem>
                    {sources?.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Memory Type</Label>
                <Select value={memoryType} onValueChange={setMemoryType}>
                  <SelectTrigger><SelectValue placeholder="All types" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All types</SelectItem>
                    <SelectItem value="semantic">Semantic</SelectItem>
                    <SelectItem value="episodic">Episodic</SelectItem>
                    <SelectItem value="procedural">Procedural</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Scope</Label>
                <Select value={scope} onValueChange={setScope}>
                  <SelectTrigger><SelectValue placeholder="All scopes" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All scopes</SelectItem>
                    <SelectItem value="personal">Personal</SelectItem>
                    <SelectItem value="org">Organization</SelectItem>
                    <SelectItem value="team">Team</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date From</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Date To</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={includeEmbeddings}
                onCheckedChange={setIncludeEmbeddings}
              />
              <Label>Include embedding vectors</Label>
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-800">
          <CardHeader>
            <CardTitle className="text-sm">Export</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={format} onValueChange={setFormat}>
              <TabsList className="w-full">
                <TabsTrigger value="json" className="flex-1">
                  <FileJson className="mr-1.5 h-3.5 w-3.5" />
                  JSON
                </TabsTrigger>
                <TabsTrigger value="markdown" className="flex-1">
                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                  Markdown
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Separator />

            <Button
              className="w-full"
              onClick={handleExport}
              disabled={exportMutation.isPending}
            >
              {exportMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Download Export
            </Button>

            {exportMutation.isSuccess && (
              <p className="text-xs text-green-400 text-center">
                Exported {Array.isArray(exportMutation.data) ? (exportMutation.data as any[]).length : '?'} chunks
              </p>
            )}

            {exportMutation.isError && (
              <p className="text-xs text-red-400 text-center">
                {(exportMutation.error as Error).message}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function formatAsMarkdown(data: any): string {
  const chunks = Array.isArray(data) ? data : data?.chunks ?? [];
  const lines: string[] = ['# Engram Export', '', `Exported ${chunks.length} chunks on ${new Date().toISOString()}`, ''];

  for (const chunk of chunks) {
    lines.push(`## ${chunk.sourcePath ?? chunk.source_path ?? 'Memory'}`, '');
    if (chunk.tags?.length) {
      lines.push(`**Tags:** ${chunk.tags.join(', ')}`, '');
    }
    lines.push(chunk.content, '');
    lines.push('---', '');
  }

  return lines.join('\n');
}
