import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useEntities, useEntityChunks } from '@/hooks/useEntities';
import { ChunkCard } from '@/components/memories/ChunkCard';

export function EntitiesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);

  const { data: entities, isLoading } = useEntities();

  const { data: entityChunks, isLoading: chunksLoading } = useEntityChunks(
    selectedEntity ?? ''
  );

  const filtered = (entities ?? []).filter((e: any) =>
    searchQuery ? e.name?.toLowerCase().includes(searchQuery.toLowerCase()) : true
  );

  return (
    <div className="flex gap-6">
      <div className={selectedEntity ? 'flex-1' : 'w-full'}>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Entities</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Named entities extracted from your memories
            </p>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search entities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {isLoading && (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
          )}

          {!isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entity Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Mentions</TableHead>
                  <TableHead>First Seen</TableHead>
                  <TableHead>Last Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No entities found
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((entity: any) => (
                  <TableRow
                    key={entity.name}
                    className="cursor-pointer"
                    onClick={() => setSelectedEntity(entity.name)}
                  >
                    <TableCell className="font-medium text-violet-400">
                      {entity.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {entity.type ?? '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      {entity.mention_count ?? entity.mentions ?? '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {entity.first_seen
                        ? new Date(entity.first_seen).toLocaleDateString()
                        : '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {entity.last_seen
                        ? new Date(entity.last_seen).toLocaleDateString()
                        : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {selectedEntity && (
        <Card className="w-96 shrink-0 border-zinc-800">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{selectedEntity}</CardTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSelectedEntity(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="max-h-[calc(100vh-12rem)] space-y-3 overflow-auto">
            {chunksLoading && (
              <p className="text-sm text-muted-foreground">Loading chunks...</p>
            )}
            {entityChunks?.map?.((chunk: any) => (
              <ChunkCard key={chunk.id} chunk={chunk} />
            ))}
            {!chunksLoading && (!entityChunks || entityChunks.length === 0) && (
              <p className="text-sm text-muted-foreground">No linked chunks</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
