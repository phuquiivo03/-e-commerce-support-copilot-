'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CircleAlert, FilePlus2, RefreshCw, Send, Upload } from 'lucide-react';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';
import type { KbDocumentCategory, KbDocumentStatus } from '@copilot/shared';

type KbDocument = {
  id: string;
  title: string;
  category: KbDocumentCategory;
  version: number;
  status: KbDocumentStatus;
  effective_from: string;
  effective_to: string | null;
  region: string;
  product_category: string | null;
};

type IngestionJob = {
  id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  error: string | null;
  created_at: string;
  kb_documents: { id: string; title: string; version: number; status: string } | null;
};

type ChunkRow = {
  id: string;
  chunk_index: number;
  heading: string | null;
  content: string;
  embedding_model: string | null;
};

const CATEGORIES = ['SHIPPING', 'CANCELLATION', 'RETURNS', 'REFUNDS', 'WARRANTY'];

export default function KbAdminPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [inspectDoc, setInspectDoc] = useState<string | null>(null);

  const documents = useQuery({
    queryKey: ['kb-documents'],
    queryFn: () => apiFetch<{ documents: KbDocument[] }>('/api/kb/documents?pageSize=100'),
  });

  const jobs = useQuery({
    queryKey: ['kb-jobs'],
    queryFn: () => apiFetch<{ jobs: IngestionJob[] }>('/api/kb/jobs?pageSize=20'),
    refetchInterval: 5000,
  });

  const publish = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/kb/documents/${id}/publish`, { method: 'POST', body: '{}' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kb-documents'] });
      queryClient.invalidateQueries({ queryKey: ['kb-jobs'] });
    },
  });

  const requeue = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/kb/documents/${id}/ingest`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kb-jobs'] }),
  });

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Knowledge Base</h1>
          <p className="mt-1 text-muted-foreground">
            Versioned policy documents. Publishing supersedes the previous version and re-indexes chunks.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <FilePlus2 className="h-4 w-4" /> New document
        </Button>
      </div>

      {publish.isError ? (
        <Card tint="destructiveSoft" className="mt-4 flex items-center gap-2 text-sm font-medium text-destructive">
          <CircleAlert className="h-4 w-4" />
          {publish.error instanceof Error ? publish.error.message : 'Publish failed.'}
        </Card>
      ) : null}

      {/* Documents */}
      <div className="mt-6 space-y-3">
        {documents.isPending
          ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)
          : null}
        {documents.data?.documents.map((doc) => (
          <Card key={doc.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" />
                <span className="font-bold tracking-tight">{doc.title}</span>
                <Badge tone="neutral">v{doc.version}</Badge>
                <Badge tone={statusTone(doc.status)}>{doc.status}</Badge>
                <Badge tone="primarySoft">{doc.category}</Badge>
                <Badge tone="neutral">{doc.region}</Badge>
                {doc.product_category ? <Badge tone="accentSoft">{doc.product_category}</Badge> : null}
              </div>
              <div className="mt-1.5 text-sm text-muted-foreground">
                Effective {doc.effective_from}
                {doc.effective_to ? ` → ${doc.effective_to}` : ' → present'}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setInspectDoc(doc.id)}>
                <Upload className="h-4 w-4" /> Chunks
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => requeue.mutate(doc.id)}
                disabled={requeue.isPending}
                title="Queue ingestion"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              {doc.status !== 'PUBLISHED' && doc.status !== 'SUPERSEDED' ? (
                <Button size="sm" onClick={() => publish.mutate(doc.id)} disabled={publish.isPending}>
                  <Send className="h-4 w-4" /> Publish
                </Button>
              ) : null}
            </div>
          </Card>
        ))}
      </div>

      {/* Ingestion jobs */}
      <h2 className="mt-10 text-xl font-bold tracking-tight">Ingestion jobs</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Background worker processes the queue with bounded retries; failed jobs never mark a document as indexed.
      </p>
      <div className="mt-4 space-y-2">
        {jobs.data?.jobs.length === 0 ? (
          <Card tint="muted" className="text-sm text-muted-foreground">
            No ingestion jobs yet — publish a document to queue one.
          </Card>
        ) : null}
        {jobs.data?.jobs.map((job) => (
          <Card key={job.id} tint="muted" className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0">
              <div className="font-semibold">
                {job.kb_documents?.title ?? 'Unknown document'}{' '}
                <span className="text-muted-foreground">v{job.kb_documents?.version ?? '?'}</span>
              </div>
              {job.error ? (
                <div className="mt-0.5 max-w-xl truncate font-mono text-xs text-destructive" title={job.error}>
                  {job.error}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                attempt {job.attempts}/{job.max_attempts}
              </span>
              <Badge tone={statusTone(job.status)}>{job.status}</Badge>
            </div>
          </Card>
        ))}
      </div>

      <CreateDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <InspectDialog docId={inspectDoc} onClose={() => setInspectDoc(null)} />
    </div>
  );
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<KbDocumentCategory>('RETURNS');
  const [region, setRegion] = useState('US');
  const [productCategory, setProductCategory] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiFetch('/api/kb/documents', {
        method: 'POST',
        body: JSON.stringify({
          title,
          category,
          region,
          productCategory: productCategory || null,
          content,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kb-documents'] });
      setTitle('');
      setContent('');
      setProductCategory('');
      setError(null);
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Create failed.'),
  });

  return (
    <Dialog open={open} onClose={onClose} title="New policy document" wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="doc-title">Title</Label>
            <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Returns & Exchanges Policy" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-category">Category</Label>
            <Select id="doc-category" value={category} onChange={(e) => setCategory(e.target.value as KbDocumentCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="doc-region">Region</Label>
            <Input id="doc-region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="US" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-product">Product category (optional)</Label>
            <Input
              id="doc-product"
              value={productCategory}
              onChange={(e) => setProductCategory(e.target.value)}
              placeholder="e.g. Electronics"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="doc-content">Content (markdown, headings become chunk boundaries)</Label>
          <Textarea
            id="doc-content"
            rows={10}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={'## Return Window\nMost items can be returned within 30 days…'}
            className="font-mono text-sm"
          />
        </div>
        {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || title.length < 3 || content.length < 10}
          >
            {create.isPending ? 'Creating…' : 'Create draft'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function InspectDialog({ docId, onClose }: { docId: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['kb-doc', docId],
    queryFn: () => apiFetch<{ document: KbDocument & { content: string }; chunks: ChunkRow[]; jobs: IngestionJob[] }>(`/api/kb/documents/${docId}`),
    enabled: docId !== null,
  });

  return (
    <Dialog open={docId !== null} onClose={onClose} title="Indexed chunks" wide>
      {detail.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : detail.data && detail.data.chunks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No chunks indexed yet. Run the ingestion worker (<span className="font-mono">npm run worker</span>) or requeue
          the job.
        </p>
      ) : null}
      <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
        {detail.data?.chunks.map((chunk) => (
          <div key={chunk.id} className="rounded-md bg-muted p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Chunk #{chunk.chunk_index}
                {chunk.heading ? ` · ${chunk.heading}` : ''}
              </div>
              <Badge tone="neutral">{chunk.embedding_model}</Badge>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm">{chunk.content}</p>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
