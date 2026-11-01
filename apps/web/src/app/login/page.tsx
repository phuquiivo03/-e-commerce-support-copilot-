'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { Bot, CircleAlert, Wrench, User, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { apiFetch, ApiClientError } from '@/lib/api-client';

const LoginSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

const DEMO_ACCOUNTS = [
  { label: 'Agent', email: 'agent@demo.local', icon: Wrench, tone: 'bg-primary text-white' },
  { label: 'Admin', email: 'admin@demo.local', icon: ShieldCheck, tone: 'bg-secondary text-white' },
  { label: 'Customer', email: 'maria@example.com', icon: User, tone: 'bg-accent text-ink' },
];

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/inbox';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [authError, setAuthError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    const parsed = LoginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errors: typeof fieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as 'email' | 'password';
        errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setPending(true);

    try {
      const result = await apiFetch<{ authenticated: boolean; error?: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      if (!result.authenticated) {
        setAuthError(result.error ?? 'Invalid email or password.');
        return;
      }
      router.push(next);
      router.refresh();
    } catch (error) {
      setAuthError(error instanceof ApiClientError ? error.message : 'Sign-in failed. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="w-full max-w-md">
      <h1 className="text-3xl font-extrabold tracking-tight">Sign in</h1>
      <p className="mt-2 text-muted-foreground">Support workspace for the demo store.</p>

      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
          />
          {fieldErrors.email ? <p className="text-sm font-medium text-destructive">{fieldErrors.email}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(fieldErrors.password)}
          />
          {fieldErrors.password ? <p className="text-sm font-medium text-destructive">{fieldErrors.password}</p> : null}
        </div>

        {authError ? (
          <div className="flex items-start gap-2 rounded-md bg-destructive-soft p-3.5 text-sm font-medium text-destructive">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {authError}
          </div>
        ) : null}

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <div className="mt-8 rounded-lg bg-muted p-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Demo accounts</div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => {
                setEmail(account.email);
                setPassword('demo1234');
                setFieldErrors({});
              }}
              className="group flex flex-col items-center gap-2 rounded-md bg-background p-3 transition-all duration-200 hover:scale-[1.03]"
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-md ${account.tone}`}>
                <account.icon className="h-5 w-5" />
              </span>
              <span className="text-xs font-semibold">{account.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Every demo account uses the password <span className="font-mono font-semibold">demo1234</span> (development only).
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Poster-style brand panel: bold blue block with flat geometry */}
      <div className="relative hidden overflow-hidden bg-primary lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rotate-12 rounded-lg bg-white/10" />
        <div className="pointer-events-none absolute right-1/4 top-1/3 h-40 w-40 rounded-full bg-white/5" />

        <div className="relative flex items-center gap-3 text-white">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-white text-primary">
            <Bot className="h-7 w-7" />
          </div>
          <div className="text-xl font-bold tracking-tight">Support Copilot</div>
        </div>

        <div className="relative text-white">
          <h2 className="max-w-md text-4xl font-extrabold leading-tight tracking-tight">
            Policy-grounded answers. Zero invented facts.
          </h2>
          <p className="mt-4 max-w-sm text-white/80">
            RAG retrieval over versioned policies, deterministic business rules, and citations you can verify —
            built on Supabase.
          </p>
        </div>

        <div className="relative flex gap-3">
          <span className="rounded-md bg-white/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-white">
            pgvector
          </span>
          <span className="rounded-md bg-white/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-white">
            Hybrid RRF
          </span>
          <span className="rounded-md bg-white/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-white">
            Deterministic
          </span>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
