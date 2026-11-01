import { jsonOk, requireUser, withErrorHandler } from '@/lib/api/http';

export const GET = withErrorHandler(async () => {
  const user = await requireUser();
  return jsonOk({ user });
});
