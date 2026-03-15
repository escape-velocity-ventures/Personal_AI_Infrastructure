import { useState, useRef, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Upload, FileText, Code2, Brain, Loader2, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { engram } from '@/lib/engram-client';

function MarkdownImportTab() {
  const [files, setFiles] = useState<File[]>([]);
  const [tags, setTags] = useState('');
  const [chunkStrategy, setChunkStrategy] = useState('heading');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const importMutation = useMutation({
    mutationFn: (files: File[]) => engram.importMarkdown(files),
  });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter(
      (f) => f.name.endsWith('.md') || f.name.endsWith('.txt'),
    );
    setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  }, []);

  function handleImport() {
    importMutation.mutate(files, {
      onSuccess: () => setFiles([]),
    });
  }

  return (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-zinc-700 hover:border-zinc-600'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          Drop .md or .txt files here, or click to browse
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".md,.txt,.markdown"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          <Label>{files.length} file{files.length > 1 ? 's' : ''} selected</Label>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {files.map((f, i) => (
              <div key={i} className="flex items-center justify-between text-sm px-2 py-1 bg-muted/50 rounded">
                <span className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5" />
                  {f.name}
                </span>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Tags</Label>
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="import, docs"
          />
        </div>
        <div className="space-y-2">
          <Label>Chunk Strategy</Label>
          <Select value={chunkStrategy} onValueChange={setChunkStrategy}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="heading">By Heading</SelectItem>
              <SelectItem value="paragraph">By Paragraph</SelectItem>
              <SelectItem value="fixed_size">Fixed Size</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button
        onClick={handleImport}
        disabled={!files.length || importMutation.isPending}
      >
        {importMutation.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Upload className="mr-2 h-4 w-4" />
        )}
        Import {files.length} File{files.length !== 1 ? 's' : ''}
      </Button>

      {importMutation.isSuccess && (
        <div className="flex items-center gap-2 text-sm text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          <span>
            Imported {(importMutation.data as any)?.chunks_created ?? 0} chunks
            from {(importMutation.data as any)?.files_processed ?? 0} files
          </span>
        </div>
      )}

      {importMutation.isError && (
        <div className="flex items-center gap-2 text-sm text-red-400">
          <AlertCircle className="h-4 w-4" />
          <span>{(importMutation.error as Error).message}</span>
        </div>
      )}
    </div>
  );
}

function JsonImportTab() {
  const [jsonText, setJsonText] = useState('');

  const importMutation = useMutation({
    mutationFn: (data: any) => engram.importJson(data),
  });

  function handleImport() {
    try {
      const parsed = JSON.parse(jsonText);
      importMutation.mutate(parsed);
    } catch {
      // JSON parse error handled by the UI
    }
  }

  const isValidJson = (() => {
    if (!jsonText.trim()) return true;
    try { JSON.parse(jsonText); return true; } catch { return false; }
  })();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Paste JSON data</Label>
        <Textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          placeholder='[{"content": "memory chunk...", "tags": ["tag1"]}]'
          className="min-h-[200px] font-mono text-xs"
        />
        {!isValidJson && (
          <p className="text-xs text-red-400">Invalid JSON</p>
        )}
      </div>

      <Button
        onClick={handleImport}
        disabled={!jsonText.trim() || !isValidJson || importMutation.isPending}
      >
        {importMutation.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Code2 className="mr-2 h-4 w-4" />
        )}
        Import JSON
      </Button>

      {importMutation.isSuccess && (
        <div className="flex items-center gap-2 text-sm text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          <span>
            Imported {(importMutation.data as any)?.chunks_created ?? 0} chunks
          </span>
        </div>
      )}

      {importMutation.isError && (
        <div className="flex items-center gap-2 text-sm text-red-400">
          <AlertCircle className="h-4 w-4" />
          <span>{(importMutation.error as Error).message}</span>
        </div>
      )}
    </div>
  );
}

function ClaudeMemoryTab() {
  const [memoryPath, setMemoryPath] = useState('~/.claude/projects/-Users-benjamin/memory/');
  const [tags, setTags] = useState('claude-memory');

  const importMutation = useMutation({
    mutationFn: (data: any) => engram.createSource(data),
  });

  function handleImport() {
    importMutation.mutate({
      name: `claude-memory-${Date.now()}`,
      source_type: 'claude_memory',
      base_path: memoryPath,
      default_tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      chunk_strategy: 'heading',
      sync_schedule: 'manual',
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Claude Memory Path</Label>
        <Input
          value={memoryPath}
          onChange={(e) => setMemoryPath(e.target.value)}
          placeholder="~/.claude/projects/..."
        />
      </div>

      <div className="space-y-2">
        <Label>Tags</Label>
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="claude-memory, context"
        />
      </div>

      <Button
        onClick={handleImport}
        disabled={!memoryPath.trim() || importMutation.isPending}
      >
        {importMutation.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Brain className="mr-2 h-4 w-4" />
        )}
        Import Claude Memory
      </Button>

      {importMutation.isSuccess && (
        <div className="flex items-center gap-2 text-sm text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          <span>Source created. Trigger a sync to import the files.</span>
        </div>
      )}

      {importMutation.isError && (
        <div className="flex items-center gap-2 text-sm text-red-400">
          <AlertCircle className="h-4 w-4" />
          <span>{(importMutation.error as Error).message}</span>
        </div>
      )}
    </div>
  );
}

export function ImportPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Import</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Import content into Engram from files, JSON, or Claude memory
        </p>
      </div>

      <Card className="border-zinc-800">
        <CardContent className="pt-6">
          <Tabs defaultValue="markdown">
            <TabsList>
              <TabsTrigger value="markdown">
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                Markdown Files
              </TabsTrigger>
              <TabsTrigger value="json">
                <Code2 className="mr-1.5 h-3.5 w-3.5" />
                JSON
              </TabsTrigger>
              <TabsTrigger value="claude">
                <Brain className="mr-1.5 h-3.5 w-3.5" />
                Claude Memory
              </TabsTrigger>
            </TabsList>
            <TabsContent value="markdown" className="mt-4">
              <MarkdownImportTab />
            </TabsContent>
            <TabsContent value="json" className="mt-4">
              <JsonImportTab />
            </TabsContent>
            <TabsContent value="claude" className="mt-4">
              <ClaudeMemoryTab />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
