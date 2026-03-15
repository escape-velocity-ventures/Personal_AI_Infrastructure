import { useQuery } from '@tanstack/react-query';
import { engram } from '../lib/engram-client';

export function useEntities() {
  return useQuery({
    queryKey: ['entities'],
    queryFn: () => engram.stats().then((s: any) => s.entities ?? []),
  });
}

export function useEntity(name: string) {
  return useQuery({
    queryKey: ['entity', name],
    queryFn: () => engram.getEntity(name),
    enabled: !!name,
  });
}

export function useEntityChunks(name: string) {
  return useQuery({
    queryKey: ['entity-chunks', name],
    queryFn: () => engram.getEntityChunks(name),
    enabled: !!name,
  });
}
