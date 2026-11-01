'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Gauge, ShieldCheck, Timer } from 'lucide-react';
import { Badge, statusTone } from '@/components/ui/badge';
import { Card, Skeleton } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';

type EvalRun = {
  id: string;
  dataset_size: number;
  created_at: string;
  results: {
    metrics?: Record<string, number>;
    retrieval?: { count: number; recallAt1: number; recallAt3: number; mrr: number; embeddingProvider: string };
    citationValidity?: { total: number; valid: number; invalid: number; rate: number };
    behaviors?: { expected: string; actual: string; passed: boolean; question: string }[];
    safety?: { name: string; passed: boolean; detail: string }[];
    latency?: { meanMs: number; p95Ms: number; errors: number };
    datasetLimitations?: string[];
  };
  report_markdown: string | null;
};

export default function EvalDashboardPage() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['eval-latest'],
    queryFn: () => apiFetch<{ run: EvalRun | null }>('/api/eval'),
  });

  if (isPending) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 p-6 lg:p-10">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-7xl p-6 lg:p-10">
        <Card tint="destructiveSoft" className="flex items-center gap-3">
          <CircleAlert className="h-5 w-5 text-destructive" />
          <div className="text-sm font-medium text-destructive">
            {error instanceof Error ? error.message : 'Failed to load evaluation run.'}
          </div>
        </Card>
      </div>
    );
  }

  if (!data.run) {
    return (
      <div className="mx-auto max-w-7xl p-6 lg:p-10">
        <h1 className="text-3xl font-extrabold tracking-tight">Evaluation</h1>
        <Card tint="muted" className="mt-6 flex flex-col items-center gap-3 py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-background">
            <Gauge className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="font-bold">No evaluation runs yet</div>
          <p className="max-w-md text-sm text-muted-foreground">
            Run the evaluation suite from the repo root: <span className="font-mono font-semibold">npm run eval</span>{' '}
            (requires the local Supabase stack and the ingestion worker to have indexed the seeded policies).
          </p>
        </Card>
      </div>
    );
  }

  const { results } = data.run;
  const metrics = results.metrics ?? {};

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Evaluation</h1>
          <p className="mt-1 text-muted-foreground">
            Latest run: {new Date(data.run.created_at).toLocaleString()} · {data.run.dataset_size} cases
          </p>
        </div>
        <Badge tone="primarySoft">embedding: {results.retrieval?.embeddingProvider ?? 'unknown'}</Badge>
      </div>

      {/* Multi-color stat cards per the flat design system */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Recall@1" value={fmt(metrics.recallAt1)} tint="bg-primary text-white" />
        <StatCard label="Recall@3" value={fmt(metrics.recallAt3)} tint="bg-secondary text-white" />
        <StatCard label="MRR" value={fmt(metrics.mrr)} tint="bg-accent text-ink" />
        <StatCard label="Citation validity" value={fmt(metrics.citationValidity)} tint="bg-ink text-white" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Behavior pass rate" value={fmt(metrics.behaviorPassRate)} tint="bg-muted text-ink" />
        <StatCard label="Safety pass rate" value={fmt(metrics.safetyPassRate)} tint="bg-muted text-ink" />
        <StatCard label="Mean latency" value={`${metrics.meanLatencyMs ?? '—'} ms`} tint="bg-muted text-ink" />
        <StatCard label="p95 latency" value={`${metrics.p95LatencyMs ?? '—'} ms`} tint="bg-muted text-ink" />
      </div>

      {/* Behavior cases */}
      {results.behaviors && results.behaviors.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-xl font-bold tracking-tight">Behavior cases</h2>
          <div className="mt-4 space-y-2">
            {results.behaviors.map((b, i) => (
              <Card key={i} tint="muted" className="flex items-start justify-between gap-4 py-4">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{b.question}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    expected <span className="font-semibold text-foreground">{b.expected}</span> · got{' '}
                    <span className="font-semibold text-foreground">{b.actual}</span>
                  </div>
                </div>
                <Badge tone={b.passed ? 'secondary' : 'destructive'}>{b.passed ? 'PASS' : 'FAIL'}</Badge>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {/* Safety cases */}
      {results.safety && results.safety.length > 0 ? (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <ShieldCheck className="h-5 w-5 text-secondary" /> Safety & authorization cases
          </h2>
          <div className="mt-4 space-y-2">
            {results.safety.map((s, i) => (
              <Card key={i} tint="muted" className="flex items-start justify-between gap-4 py-4">
                <div className="min-w-0">
                  <div className="font-semibold">{s.name}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">{s.detail}</div>
                </div>
                <Badge tone={s.passed ? 'secondary' : 'destructive'}>{s.passed ? 'PASS' : 'FAIL'}</Badge>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {/* Limitations */}
      {results.datasetLimitations && results.datasetLimitations.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-xl font-bold tracking-tight">Dataset limitations</h2>
          <Card tint="accentSoft" className="mt-4">
            <ul className="list-disc space-y-1.5 pl-5 text-sm">
              {results.datasetLimitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      {data.run.report_markdown ? (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Timer className="h-5 w-5 text-primary" /> Full report
          </h2>
          <pre className="mt-4 max-h-96 overflow-auto rounded-lg bg-muted p-5 text-xs leading-relaxed">
            {data.run.report_markdown}
          </pre>
        </section>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <Card className="transition-all duration-200 hover:scale-[1.02]">
      <div className={`inline-flex rounded-md px-3 py-1 text-3xl font-extrabold tracking-tight ${tint}`}>
        {value}
      </div>
      <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
    </Card>
  );
}

function fmt(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  return (value * 100).toFixed(0) + '%';
}
