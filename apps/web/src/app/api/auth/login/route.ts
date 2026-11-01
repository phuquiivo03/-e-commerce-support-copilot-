import { z } from 'zod';
import { jsonOk, parseBody, withErrorHandler } from '@/lib/api/http';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const POST = withErrorHandler(async (request: Request) => {
  const body = await parseBody(request, LoginSchema);
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  });

  if (error || !data.user) {
    return jsonOk({ authenticated: false, error: 'Invalid email or password.' }, 401);
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, role')
    .eq('id', data.user.id)
    .single();

  return jsonOk({ authenticated: true, user: profile ?? null });
});
