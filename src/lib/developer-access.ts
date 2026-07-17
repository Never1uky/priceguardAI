import { getAuthUser } from '@/lib/supabase/auth';

/** Email разработчика — доступ к метрикам, AI-ключам и настройкам Supabase */
export const DEVELOPER_EMAIL = 'gorum55@gmail.com';

export function isDeveloperEmail(email: string | undefined | null): boolean {
  return email?.trim().toLowerCase() === DEVELOPER_EMAIL;
}

export async function isDeveloperUser(): Promise<boolean> {
  const user = await getAuthUser();
  return isDeveloperEmail(user?.email);
}
