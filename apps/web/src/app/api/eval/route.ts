import { ApiError, jsonOk, requireUser, withErrorHandler } from '@/lib/api/http';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Latest evaluation run for the Evaluation Dashboard (staff). */
export const GET = withErrorHandler(async () => {
  await requireUser(['ADMIN', 'SUPPORT_AGENT']);
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('eval_runs')
    .select('id, dataset_size, results, report_markdown, created_at')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new ApiError(500, 'DB_ERROR', error.message);

  return jsonOk({ run: data?.[0] ?? null });
});
