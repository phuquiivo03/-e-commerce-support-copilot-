'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, ChevronDown, ChevronRight, FileText, Info, ListChecks, TriangleAlert } from 'lucide-react';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import type { Citation } from '@copilot/shared';

type CopilotRunSummary = {
  id: string;
  outcome: string;
  citations: Citation[];
  missing_information: string[];
  suggested_next_actions: string[];
  requires_human_review: boolean;
  provider: string;
  latency_ms: number | null;
  created_at: string;
};

type DraftResult = {
  runId: string;
  response: {
    behavior: string;
    message: string;
    citations: Citation[];
    missingInformation: string[];
    suggestedNextActions: string[];
    requiresHumanReview: boolean;
  };
  provider: string;
  latencyMs: number;
};

export function DraftPanel({ ticketId }: { ticketId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: () => apiFetch<DraftResult>(`/api/tickets/${ticketId}/draft`, { method: 'POST', body: '{}' }),
    onSuccess: (result) => {
      setDraft(result);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Draft generation failed.'),
  });

  const toggle = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <Card tint="muted" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-white">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="font-bold tracking-tight">AI Draft</div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Policy-grounded, citation-validated
            </div>
          </div>
        </div>
        <Button size="sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
          {generate.isPending ? 'Generating…' : draft ? 'Regenerate' : 'Generate draft'}
        </Button>
      </div>

      {error ? (
        <div className="rounded-md bg-destructive-soft p-3 text-sm font-medium text-destructive">{error}</div>
      ) : null}

      {!draft && !error ? (
        <p className="text-sm text-muted-foreground">
          Generates a draft from the customer&apos;s latest message, authorized order data, and retrieved policy
          evidence. Runs fully deterministic in mock mode.
        </p>
      ) : null}

      {draft ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(draft.response.behavior)}>{draft.response.behavior.replace(/_/g, ' ')}</Badge>
            {draft.response.requiresHumanReview ? (
              <Badge tone="destructive">
                <TriangleAlert className="h-3 w-3" /> Human review required
              </Badge>
            ) : null}
            <Badge tone="neutral">{draft.provider}</Badge>
            <Badge tone="neutral">{draft.latencyMs} ms</Badge>
          </div>

          <div className="whitespace-pre-wrap rounded-md bg-background p-4 text-[15px]">{draft.response.message}</div>

          {draft.response.citations.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <FileText className="h-3.5 w-3.5" /> Citations ({draft.response.citations.length})
              </div>
              {draft.response.citations.map((citation, i) => (
                <button
                  key={`${citation.kind}-${i}`}
                  onClick={() => toggle(i)}
                  className="flex w-full items-start gap-2 rounded-md bg-background p-3 text-left transition-colors duration-200 hover:bg-muted-hover"
                >
                  {expanded.has(i) ? (
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  )}
                  <span className="min-w-0">
                    {citation.kind === 'policy_chunk' ? (
                      <>
                        <span className="font-semibold">
                          {citation.documentTitle} (v{citation.documentVersion})
                        </span>
                        {citation.heading ? <span className="text-muted-foreground"> · {citation.heading}</span> : null}
                        {expanded.has(i) ? (
                          <span className="mt-1 block text-sm text-muted-foreground italic">“{citation.quote}”</span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span className="font-semibold">Order record {citation.orderNumber}</span>
                        <span className="text-muted-foreground"> · fields: {citation.fields.join(', ')}</span>
                      </>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md bg-accent-soft p-3 text-sm font-medium text-accent-hover">
              <Info className="h-4 w-4 shrink-0" />
              No citations passed validation — treat the draft as unverified.
            </div>
          )}

          {draft.response.missingInformation.length > 0 ? (
            <div className="rounded-md bg-accent-soft p-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-accent-hover">Missing information</div>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
                {draft.response.missingInformation.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {draft.response.suggestedNextActions.length > 0 ? (
            <div className="rounded-md bg-secondary-soft p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-secondary">
                <ListChecks className="h-3.5 w-3.5" /> Suggested next actions
              </div>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
                {draft.response.suggestedNextActions.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
