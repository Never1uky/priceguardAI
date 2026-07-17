import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getAuthUser,
  getSupabaseAuthClient,
  isUnreliableAuthEmail,
  onAuthStateChange,
  resetPasswordForEmail,
  signInWithEmail,
  signOut,
  signUpWithEmail,
  resendSignupConfirmation,
} from '@/lib/supabase/auth';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { isDeveloperEmail, isDeveloperUser } from '@/lib/developer-access';
import { runPostLoginHooks, type PostLoginResult } from '@/lib/supabase/post-login';
import { toastError, toastSuccess } from '@/popup/lib/toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SectionLabel } from '@/components/ui/section-label';
import { Surface } from '@/components/ui/surface';
import {
  ChevronDown,
  ChevronUp,
  Cloud,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  Shield,
} from 'lucide-react';
import type { User } from '@supabase/supabase-js';

interface AuthTabProps {
  onAuthed?: () => void;
}

function formatMigrationHint(result: PostLoginResult): string | null {
  const parts: string[] = [];
  if (result.premiumRestored) {
    parts.push('Premium восстановлен с аккаунта');
  }
  if (result.telegramRestored) {
    parts.push('Telegram-настройки восстановлены');
  }
  if (result.claimed > 0 || result.merged > 0) {
    parts.push(
      `Перенесено из облака: ${result.claimed} товаров` +
        (result.merged > 0 ? `, объединено дубликатов: ${result.merged}` : ''),
    );
  } else if (result.synced && result.localCount > 0) {
    parts.push(`Синхронизировано ${result.localCount} локальных товаров с облаком`);
  } else if (result.synced) {
    parts.push('Список синхронизирован с облаком');
  }
  return parts.length > 0 ? parts.join('. ') : null;
}

function formatAuthError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const lower = raw.toLowerCase();
  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return 'Неверный email или пароль';
  }
  if (lower.includes('email not confirmed')) {
    return 'Аккаунт ожидает подтверждения email. Если Confirm email выключен в Supabase — войдите снова; иначе проверьте письмо / Спам.';
  }
  if (lower.includes('user already registered')) {
    return 'Этот email уже зарегистрирован — войдите или сбросьте пароль';
  }
  if (lower.includes('password') && lower.includes('at least')) {
    return 'Пароль слишком короткий';
  }
  if (lower.includes('rate limit') || lower.includes('too many')) {
    return 'Слишком много попыток — подождите минуту';
  }
  return raw.trim() || 'Ошибка авторизации';
}

export function AuthTab({ onAuthed }: AuthTabProps) {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [migrationHint, setMigrationHint] = useState<string | null>(null);
  const [isDev, setIsDev] = useState(false);
  const [pendingConfirmEmail, setPendingConfirmEmail] = useState<string | null>(null);
  const onAuthedRef = useRef(onAuthed);
  onAuthedRef.current = onAuthed;

  const configured = getSupabaseConfig().configured;

  const refreshUser = useCallback(async () => {
    setLoading(true);
    try {
      setUser(await getAuthUser());
      setIsDev(await isDeveloperUser());
    } finally {
      setLoading(false);
    }
  }, []);

  const runSync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await runPostLoginHooks();
      const hint = formatMigrationHint(result);
      if (hint) setMigrationHint(hint);
      onAuthedRef.current?.();
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
    // Только SIGNED_IN — иначе TOKEN_REFRESHED / INITIAL_SESSION дают постоянный sync и мигание
    const unsub = onAuthStateChange((session, event) => {
      setUser(session?.user ?? null);
      setIsDev(isDeveloperEmail(session?.user?.email));
      if (!session?.user) {
        setMigrationHint(null);
        return;
      }
      if (event === 'SIGNED_IN') {
        void runSync();
      }
    });
    return () => unsub?.();
  }, [refreshUser, runSync]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === 'reset') {
        const addr = email.trim().toLowerCase();
        await resetPasswordForEmail(addr);
        toastSuccess(
          isUnreliableAuthEmail(addr)
            ? 'Ссылка отправлена. На Яндекс/Mail.ru письмо часто не доходит — проверьте Спам; если нет — @priceguard_supportbot'
            : 'Ссылка для сброса отправлена. Если письма нет через 5–10 мин — проверьте Спам',
        );
        setMode('signin');
        return;
      }

      if (mode === 'signin') {
        await signInWithEmail(email.trim().toLowerCase(), password);
        setPendingConfirmEmail(null);
        toastSuccess('Вход выполнен');
      } else {
        const data = await signUpWithEmail(email.trim(), password);
        if (data.session) {
          setPendingConfirmEmail(null);
          toastSuccess('Регистрация успешна');
        } else if (data.user) {
          // Редкий fallback: Confirm email ещё включён на сервере
          setPendingConfirmEmail(email.trim().toLowerCase());
          toastSuccess(
            'Аккаунт создан. Если вход не открылся — Confirm email ещё включён в Supabase; проверьте почту или войдите позже.',
          );
        } else {
          toastError('Не удалось зарегистрироваться');
        }
      }
      void refreshUser();
      onAuthedRef.current?.();
    } catch (err) {
      toastError(formatAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setSubmitting(true);
    await signOut();
    setUser(null);
    setMigrationHint(null);
    setSubmitting(false);
  };

  if (!configured) {
    return (
      <Surface variant="subtle" className="space-y-2 p-4 text-sm">
        <p className="pg-body font-medium">Supabase не настроен</p>
        <p className="pg-hint">
            Добавьте <code className="text-[10px]">VITE_SUPABASE_URL</code> и{' '}
            <code className="text-[10px]">VITE_SUPABASE_ANON_KEY</code> в <code>.env</code> и
            пересоберите расширение.
        </p>
      </Surface>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (user) {
    return (
      <div className="space-y-4">
        <section className="space-y-2">
          <SectionLabel>Аккаунт</SectionLabel>
          <Surface variant="raised" className="space-y-3 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {user.email?.slice(0, 2).toUpperCase() ?? 'PG'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="pg-body font-medium">Вы вошли</p>
                <p className="truncate pg-hint">{user.email}</p>
              </div>
              <Badge variant={syncing ? 'warning' : 'success'} className="shrink-0 text-[10px]">
                {syncing ? 'Синхронизация…' : 'Онлайн'}
              </Badge>
            </div>
            <div className="flex items-start gap-2 rounded-sm bg-muted/50 px-3 py-2.5">
              <Cloud className="mt-0.5 h-4 w-4 shrink-0 text-info" strokeWidth={1.75} />
              <p className="pg-caption leading-relaxed text-muted-foreground">
                Отслеживаемые товары синхронизируются между браузерами.
              </p>
            </div>
            {isDev && (
              <div className="flex items-center gap-2 pg-caption text-muted-foreground">
                <Shield className="h-3.5 w-3.5 text-purple" strokeWidth={1.75} />
                Доступ разработчика активен
              </div>
            )}
            {migrationHint && (
              <p className="rounded-sm bg-success/10 px-2.5 py-2 pg-caption text-success">
                {migrationHint}
              </p>
            )}
          </Surface>
        </section>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void runSync()}
            disabled={syncing || submitting}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} strokeWidth={1.75} />
            Синхронизировать
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => void handleSignOut()}
            disabled={submitting}
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
            Выйти
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <SectionLabel>Аккаунт</SectionLabel>
        <Surface variant="raised" className="space-y-4 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-sm bg-primary/10 text-primary">
              <Cloud className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </div>
            <div>
              <p className="pg-title">PriceGuard AI</p>
              <p className="pg-hint">Синхронизация списка товаров с облаком</p>
            </div>
          </div>

          <form onSubmit={(e) => void handleEmailSubmit(e)} className="space-y-2">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-sm border-0 bg-muted/60 px-3 py-2.5 pg-body outline-none ring-primary focus:ring-1"
              required
              autoComplete="email"
            />
            {mode === 'signup' && isUnreliableAuthEmail(email) && (
              <p className="rounded-sm bg-amber-500/10 px-2.5 py-2 pg-caption leading-relaxed text-amber-900 dark:text-amber-200">
                Для восстановления пароля надёжнее Gmail или рабочая почта: на Яндекс/Mail.ru
                письма сброса часто не доходят (пока нет своего SMTP).
              </p>
            )}
            {mode !== 'reset' && (
              <input
                type="password"
                placeholder="Пароль (мин. 6 символов)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-sm border-0 bg-muted/60 px-3 py-2.5 pg-body outline-none ring-primary focus:ring-1"
                required
                minLength={6}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            )}
            <Button type="submit" size="sm" className="w-full gap-1.5" disabled={submitting}>
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
              ) : (
                <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              {mode === 'signin' && 'Войти'}
              {mode === 'signup' && 'Зарегистрироваться'}
              {mode === 'reset' && 'Отправить ссылку для сброса'}
            </Button>
          </form>

          {pendingConfirmEmail && mode === 'signup' && (
            <Surface variant="subtle" className="space-y-2 p-3">
              <p className="pg-caption leading-relaxed text-muted-foreground">
                Confirm email, похоже, ещё включён на сервере. Письмо на{' '}
                <span className="font-medium text-foreground">{pendingConfirmEmail}</span> может не
                дойти (особенно Яндекс/Mail.ru) — проверьте «Спам» или напишите в
                @priceguard_supportbot.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 w-full text-[10px]"
                disabled={submitting}
                onClick={() => {
                  void (async () => {
                    setSubmitting(true);
                    try {
                      await resendSignupConfirmation(pendingConfirmEmail);
                      toastSuccess('Письмо отправлено повторно (если дойдёт)');
                    } catch (err) {
                      toastError(err instanceof Error ? err.message : 'Не удалось отправить');
                    } finally {
                      setSubmitting(false);
                    }
                  })();
                }}
              >
                Отправить письмо снова
              </Button>
            </Surface>
          )}

          {mode === 'reset' && (
            <div className="space-y-1.5">
              <p className="pg-caption leading-relaxed text-muted-foreground">
                Письмо идёт с сервера Supabase. На Яндекс и Mail.ru доставка часто нестабильна —
                загляните в «Спам» и «Промоакции».
              </p>
              {isUnreliableAuthEmail(email) && (
                <p className="rounded-sm bg-amber-500/10 px-2.5 py-2 pg-caption leading-relaxed text-amber-900 dark:text-amber-200">
                  Сброс на этот адрес может не прийти. Если письма нет — напишите в
                  @priceguard_supportbot.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 pg-caption">
            <button
              type="button"
              className="text-primary pg-transition hover:opacity-75"
              onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
            >
              {mode === 'signin' ? 'Нет аккаунта? Регистрация' : 'Уже есть аккаунт? Войти'}
            </button>
            {mode !== 'reset' && (
              <button
                type="button"
                className="text-muted-foreground pg-transition hover:text-foreground"
                onClick={() => setMode('reset')}
              >
                Забыли пароль?
              </button>
            )}
            {mode === 'reset' && (
              <button
                type="button"
                className="text-muted-foreground pg-transition hover:text-foreground"
                onClick={() => setMode('signin')}
              >
                Назад ко входу
              </button>
            )}
          </div>
        </Surface>
      </section>

      {isDev && (
        <section className="space-y-2">
          <SectionLabel>Dev</SectionLabel>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md bg-muted/50 px-3 py-2.5 pg-caption text-muted-foreground pg-transition hover:bg-muted"
            onClick={() => setShowSetup((v) => !v)}
          >
            <span>Настройка Supabase (для разработчика)</span>
            {showSetup ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
          {showSetup && (
            <Surface variant="subtle" className="space-y-2 p-3 pg-caption text-muted-foreground">
                <p>
                  Добавьте в <code>.env</code> и пересоберите:
                </p>
                <p className="break-all rounded-sm bg-background/70 p-2 font-mono">VITE_SUPABASE_URL=...</p>
                <p className="break-all rounded-sm bg-background/70 p-2 font-mono">
                  VITE_SUPABASE_ANON_KEY=...
                </p>
                <p>Клиент: {getSupabaseAuthClient() ? 'OK' : 'не инициализирован'}</p>
            </Surface>
          )}
        </section>
      )}
    </div>
  );
}
