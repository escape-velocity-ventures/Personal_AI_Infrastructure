import { useQuery } from '@tanstack/react-query';
import { engram } from '../lib/engram-client';

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: () => engram.stats(),
  });
}
