import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { engram } from '../lib/engram-client';

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export interface SearchOptions {
  mode?: 'vector' | 'fts' | 'hybrid';
  scope?: string;
  memory_type?: string;
  tags?: string[];
  limit?: number;
}

export function useSearch(query: string, options: SearchOptions = {}) {
  const debouncedQuery = useDebounce(query, 300);

  return useQuery({
    queryKey: ['search', debouncedQuery, options],
    queryFn: () => engram.search(debouncedQuery, options),
    enabled: debouncedQuery.length > 0,
  });
}
