import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requireAuthUser } from '../_shared/auth.ts';
import { bindLicenseToUser } from '../_shared/license-bind.ts';
import { handleCors, jsonResponse, normalizeKey } from '../_shared/utils.ts';

interface ValidateBody {
  key: string;
  deviceId: string;
  extensionVersion?: string;
}

type ActivateRpcResult = {
  ok?: boolean;
  code?: string;
  message?: string;
  max_activations?: number;
};

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const body = (await req.json()) as ValidateBody;
    const keyCode = normalizeKey(body.key ?? '');
    const deviceId = (body.deviceId ?? '').trim();

    if (!keyCode || !deviceId) {
      return jsonResponse({ ok: false, error: 'key и deviceId обязательны' }, 400);
    }

    if (!keyCode.startsWith('PGAI-') && !keyCode.startsWith('PRICEGUARD-')) {
      return jsonResponse({ ok: false, error: 'Неверный формат ключа' }, 400);
    }

    const authUser = await requireAuthUser(req, true);
    if (!authUser) {
      return jsonResponse(
        { ok: false, error: 'Войдите во вкладку «Аккаунт», чтобы активировать ключ', code: 'auth_required' },
        401,
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: license, error: fetchError } = await supabase
      .from('license_keys')
      .select('id, key_code, plan, expires_at, max_activations, is_active, is_demo')
      .eq('key_code', keyCode)
      .maybeSingle();

    if (fetchError) {
      console.error('license fetch:', fetchError);
      return jsonResponse({ ok: false, error: 'Ошибка сервера' }, 500);
    }

    if (!license || !license.is_active) {
      return jsonResponse({ ok: false, error: 'Ключ не найден или деактивирован' }, 404);
    }

    if (license.expires_at && new Date(license.expires_at) < new Date()) {
      return jsonResponse({ ok: false, error: 'Срок действия ключа истёк' }, 410);
    }

    // Anti-hijack: ключ уже у другого аккаунта — отказ
    const bind = await bindLicenseToUser(supabase, authUser.id, {
      id: license.id,
      plan: license.plan,
      expires_at: license.expires_at,
    });
    if (bind.ok === false && bind.code === 'LICENSE_OWNED_BY_OTHER') {
      return jsonResponse({ ok: false, error: bind.error, code: bind.code }, 403);
    }

    const { data: rpcRaw, error: rpcError } = await supabase.rpc('activate_license_device', {
      p_license_key_id: license.id,
      p_device_id: deviceId,
      p_user_id: authUser.id,
      p_extension_version: body.extensionVersion ?? null,
    });

    if (rpcError) {
      console.error('activate_license_device:', rpcError);
      return jsonResponse({ ok: false, error: 'Не удалось активировать' }, 500);
    }

    const rpc = (rpcRaw ?? {}) as ActivateRpcResult;
    if (!rpc.ok) {
      if (rpc.code === 'limit_reached') {
        const max = rpc.max_activations ?? license.max_activations;
        return jsonResponse({
          ok: false,
          error:
            rpc.message ??
            `Лимит устройств (${max}). Деактивируйте на другом устройстве.`,
          code: 'limit_reached',
        }, 403);
      }
      const status =
        rpc.code === 'not_found' || rpc.code === 'inactive'
          ? 404
          : rpc.code === 'bad_request'
            ? 400
            : 500;
      return jsonResponse({
        ok: false,
        error: rpc.message ?? 'Не удалось активировать',
        code: rpc.code,
      }, status);
    }

    const expiresAtMs = license.expires_at
      ? new Date(license.expires_at).getTime()
      : undefined;

    return jsonResponse({
      ok: true,
      plan: license.plan,
      expiresAt: expiresAtMs,
      isDemo: license.is_demo,
      isLifetime: license.plan === 'lifetime' && !license.expires_at,
      accountBound: true,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'error';
    if (msg === 'auth_required' || msg === 'invalid_token') {
      return jsonResponse(
        { ok: false, error: 'Войдите во вкладку «Аккаунт», чтобы активировать ключ', code: 'auth_required' },
        401,
      );
    }
    console.error('validate-license:', error);
    return jsonResponse({ ok: false, error: 'Внутренняя ошибка' }, 500);
  }
});
