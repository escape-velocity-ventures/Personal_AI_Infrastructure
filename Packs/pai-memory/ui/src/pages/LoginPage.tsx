import { useState, FormEvent } from 'react';
import { Brain } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export function LoginPage() {
  const { login } = useAuth();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;

    setError('');
    setConnecting(true);
    login(token.trim());
  }

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <Card className="w-full max-w-sm border-zinc-800 bg-zinc-900">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/10">
            <Brain className="h-6 w-6 text-violet-400" />
          </div>
          <CardTitle className="text-zinc-100">Engram</CardTitle>
          <CardDescription>Connect to your memory service</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token" className="text-zinc-300">
                API Token
              </Label>
              <Input
                id="token"
                type="password"
                placeholder="eyJhbG..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="border-zinc-700 bg-zinc-800 font-mono text-sm text-zinc-100 placeholder:text-zinc-500"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={connecting || !token.trim()}
            >
              {connecting ? 'Connecting...' : 'Connect'}
            </Button>

            <p className="text-center text-xs text-zinc-500">
              Generate a token:{' '}
              <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-400">
                bun run src/jwt-utils.ts
              </code>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
