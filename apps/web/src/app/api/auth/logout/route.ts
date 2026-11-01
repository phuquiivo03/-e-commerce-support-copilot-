import { jsonOk, withErrorHandler } from '@/lib/api/http';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const POST = withErrorHandler(async () => {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return jsonOk({ signedOut: true });
});
