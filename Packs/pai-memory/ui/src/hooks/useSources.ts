import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { engram } from '../lib/engram-client';

export function useSources() {
  return useQuery({
    queryKey: ['sources'],
    queryFn: () => engram.listSources(),
  });
}

export function useSourceFiles(sourceId: string) {
  return useQuery({
    queryKey: ['source-files', sourceId],
    queryFn: () => engram.getSourceFiles(sourceId),
    enabled: !!sourceId,
  });
}

export function useCredentials() {
  return useQuery({
    queryKey: ['credentials'],
    queryFn: () => engram.listCredentials(),
  });
}

export function useTenants() {
  return useQuery({
    queryKey: ['tenants'],
    queryFn: () => engram.listTenants(),
  });
}

export function useCreateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => engram.createSource(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });
}

export function useUpdateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => engram.updateSource(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });
}

export function useDeleteSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => engram.deleteSource(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });
}

export function useSyncSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      engram.syncSource(id, force),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });
}

export function useCreateCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => engram.createCredential(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credentials'] }),
  });
}

export function useDeleteCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => engram.deleteCredential(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credentials'] }),
  });
}

export function useTestCredential() {
  return useMutation({
    mutationFn: (id: string) => engram.testCredential(id),
  });
}
