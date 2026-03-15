import { useQuery } from '@tanstack/react-query';
import { engram } from '../lib/engram-client';

export interface MemoryFilters {
  source_id?: string;
  memory_type?: string;
  tags?: string[];
  offset?: number;
  limit?: number;
}

export function useMemories(filters: MemoryFilters = {}) {
  return useQuery({
    queryKey: ['memories', filters],
    queryFn: () =>
      engram.search('', {
        ...filters,
        mode: 'fts',
      }),
  });
}

export function useChunk(id: string) {
  return useQuery({
    queryKey: ['chunk', id],
    queryFn: () => engram.getChunk(id),
    enabled: !!id,
  });
}
