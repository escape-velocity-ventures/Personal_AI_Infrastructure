import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  User, Shield, Key, Eye, EyeOff, Copy, Check, Trash2,
  Loader2, AlertCircle, CheckCircle2, Plus,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/hooks/useAuth';
import {
  useCredentials, useCreateCredential, useDeleteCredential, useTestCredential,
  useTenants,
} from '@/hooks/useSources';

function ProfileSection() {
  const { user } = useAuth();
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);

  const token = localStorage.getItem('engram_token') ?? '';
  const maskedToken = token ? `${token.slice(0, 10)}...${token.slice(-6)}` : '';

  function copyToken() {
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="border-zinc-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4" />
          Profile
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {user && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{user.handle ?? user.email ?? 'User'}</span>
              {user.email && (
                <span className="text-xs text-muted-foreground">{user.email}</span>
              )}
            </div>
          </div>
        )}

        <Separator />

        <div className="space-y-2">
          <Label>API Token</Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono">
              {showToken ? token : maskedToken}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setShowToken(!showToken)}
            >
              {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={copyToken}>
              {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TenantsSection() {
  const { data: tenants, isLoading } = useTenants();

  return (
    <Card className="border-zinc-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Shield className="h-4 w-4" />
          Tenants
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : !tenants?.length ? (
          <p className="text-sm text-muted-foreground">No tenants</p>
        ) : (
          <div className="space-y-2">
            {tenants.map((t: any) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-md border border-zinc-800 px-3 py-2"
              >
                <div>
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{t.slug}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{t.type}</Badge>
                  {t.role && <Badge variant="outline" className="text-xs">{t.role}</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddCredentialDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [authType, setAuthType] = useState('pat');
  const [provider, setProvider] = useState('github');
  const [value, setValue] = useState('');

  const createMutation = useCreateCredential();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate(
      { name, auth_type: authType, provider, value },
      {
        onSuccess: () => {
          setOpen(false);
          setName('');
          setValue('');
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add Credential
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Credential</DialogTitle>
          <DialogDescription>Store an encrypted credential for source authentication.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="my-github-pat" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={authType} onValueChange={setAuthType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pat">Personal Access Token</SelectItem>
                  <SelectItem value="ssh_key">SSH Key</SelectItem>
                  <SelectItem value="deploy_key">Deploy Key</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="github">GitHub</SelectItem>
                  <SelectItem value="gitea">Gitea</SelectItem>
                  <SelectItem value="gitlab">GitLab</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Value</Label>
            <Input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              placeholder={authType === 'pat' ? 'ghp_...' : '-----BEGIN OPENSSH PRIVATE KEY-----'}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Save Credential
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CredentialsSection() {
  const { data: credentials, isLoading } = useCredentials();
  const deleteMutation = useDeleteCredential();
  const testMutation = useTestCredential();

  return (
    <Card className="border-zinc-800">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Key className="h-4 w-4" />
          Credentials
        </CardTitle>
        <AddCredentialDialog />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : !credentials?.length ? (
          <p className="text-sm text-muted-foreground">
            No credentials stored. Add one to authenticate with git sources.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {credentials.map((cred: any) => (
                <TableRow key={cred.id}>
                  <TableCell className="font-medium text-sm">{cred.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{cred.auth_type}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {cred.provider ?? '-'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {cred.expires_at ? new Date(cred.expires_at).toLocaleDateString() : '-'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {cred.last_used_at ? new Date(cred.last_used_at).toLocaleDateString() : 'Never'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={testMutation.isPending}
                        onClick={() => testMutation.mutate(cred.id)}
                      >
                        {testMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          'Test'
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-400 hover:text-red-300"
                        onClick={() => deleteMutation.mutate(cred.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {testMutation.isSuccess && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            {(testMutation.data as any)?.success ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-400" />
                <span className="text-green-400">{(testMutation.data as any)?.message}</span>
              </>
            ) : (
              <>
                <AlertCircle className="h-4 w-4 text-red-400" />
                <span className="text-red-400">{(testMutation.data as any)?.message}</span>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your profile, tenants, and credentials
        </p>
      </div>

      <ProfileSection />
      <TenantsSection />
      <CredentialsSection />
    </div>
  );
}
