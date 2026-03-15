import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  GitBranch, Folder, Upload, Brain, RefreshCw, Plus,
  MoreHorizontal, Trash2, Pencil, Loader2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  useSources, useCreateSource, useDeleteSource, useSyncSource, useCredentials,
} from '@/hooks/useSources';

const typeIcons: Record<string, typeof GitBranch> = {
  git_repo: GitBranch,
  local_path: Folder,
  upload: Upload,
  claude_memory: Brain,
};

const typeLabels: Record<string, string> = {
  git_repo: 'Git Repository',
  local_path: 'Local Path',
  upload: 'Upload',
  claude_memory: 'Claude Memory',
};

const statusColors: Record<string, string> = {
  synced: 'bg-green-500/10 text-green-400 border-green-500/20',
  syncing: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  error: 'bg-red-500/10 text-red-400 border-red-500/20',
  pending: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
};

function relativeTime(dateStr: string | undefined): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function SourceCard({ source }: { source: any }) {
  const Icon = typeIcons[source.source_type] ?? Folder;
  const syncMutation = useSyncSource();
  const deleteMutation = useDeleteSource();

  return (
    <Card className="border-zinc-800">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">{source.name}</span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => syncMutation.mutate({ id: source.id, force: true })}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Force Sync
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-400"
                onClick={() => deleteMutation.mutate(source.id)}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant="outline"
            className={cn('text-xs', statusColors[source.sync_status ?? 'pending'])}
          >
            {source.sync_status === 'syncing' && (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            )}
            {source.sync_status ?? 'pending'}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {source.sync_schedule}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {typeLabels[source.source_type] ?? source.source_type}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Last sync: {relativeTime(source.last_sync_at)}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={syncMutation.isPending || source.sync_status === 'syncing'}
            onClick={() => syncMutation.mutate({ id: source.id })}
          >
            {syncMutation.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" />
            )}
            Sync
          </Button>
        </div>

        {source.sync_error && (
          <p className="text-xs text-red-400 truncate" title={source.sync_error}>
            {source.sync_error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AddSourceDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState('git_repo');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [basePath, setBasePath] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [includeGlobs, setIncludeGlobs] = useState('**/*.md');
  const [excludeGlobs, setExcludeGlobs] = useState('**/node_modules/**,**/.git/**');
  const [syncSchedule, setSyncSchedule] = useState('manual');
  const [chunkStrategy, setChunkStrategy] = useState('heading');
  const [defaultTags, setDefaultTags] = useState('');

  const createMutation = useCreateSource();
  const { data: credentials } = useCredentials();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate(
      {
        name,
        source_type: sourceType,
        repo_url: sourceType === 'git_repo' ? repoUrl : undefined,
        branch,
        base_path: basePath || undefined,
        credential_id: credentialId || undefined,
        include_globs: includeGlobs.split(',').map((g) => g.trim()).filter(Boolean),
        exclude_globs: excludeGlobs.split(',').map((g) => g.trim()).filter(Boolean),
        sync_schedule: syncSchedule,
        chunk_strategy: chunkStrategy,
        default_tags: defaultTags.split(',').map((t) => t.trim()).filter(Boolean),
      },
      {
        onSuccess: () => {
          setOpen(false);
          setName('');
          setRepoUrl('');
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Add Source
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Memory Source</DialogTitle>
          <DialogDescription>Connect a source to sync content into Engram.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label>Source Type</Label>
            <Select value={sourceType} onValueChange={setSourceType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="git_repo">Git Repository</SelectItem>
                <SelectItem value="local_path">Local Path</SelectItem>
                <SelectItem value="claude_memory">Claude Memory</SelectItem>
                <SelectItem value="upload">Upload</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {sourceType === 'git_repo' && (
            <>
              <div className="space-y-2">
                <Label>Repository URL</Label>
                <Input
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/org/repo.git"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Branch</Label>
                  <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Base Path</Label>
                  <Input
                    value={basePath}
                    onChange={(e) => setBasePath(e.target.value)}
                    placeholder="docs/"
                  />
                </div>
              </div>
              {credentials && credentials.length > 0 && (
                <div className="space-y-2">
                  <Label>Credential</Label>
                  <Select value={credentialId} onValueChange={setCredentialId}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      {credentials.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} ({c.auth_type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}

          {(sourceType === 'local_path' || sourceType === 'claude_memory') && (
            <div className="space-y-2">
              <Label>Path</Label>
              <Input
                value={basePath}
                onChange={(e) => setBasePath(e.target.value)}
                placeholder={
                  sourceType === 'claude_memory'
                    ? '~/.claude/projects/-Users-benjamin/memory/'
                    : '/path/to/content'
                }
                required
              />
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            <Label>Include Globs</Label>
            <Input
              value={includeGlobs}
              onChange={(e) => setIncludeGlobs(e.target.value)}
              placeholder="**/*.md"
            />
          </div>

          <div className="space-y-2">
            <Label>Exclude Globs</Label>
            <Input
              value={excludeGlobs}
              onChange={(e) => setExcludeGlobs(e.target.value)}
              placeholder="**/node_modules/**"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>Sync Schedule</Label>
              <Select value={syncSchedule} onValueChange={setSyncSchedule}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
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

          <div className="space-y-2">
            <Label>Default Tags</Label>
            <Input
              value={defaultTags}
              onChange={(e) => setDefaultTags(e.target.value)}
              placeholder="docs, architecture"
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              Create Source
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SourcesPage() {
  const { data: sources, isLoading } = useSources();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sources</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage memory sources and sync schedules
          </p>
        </div>
        <AddSourceDialog />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !sources?.length ? (
        <Card className="border-zinc-800 border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <GitBranch className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              No sources configured. Add a source to start syncing content.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sources.map((source: any) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </div>
      )}
    </div>
  );
}
