import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requireAuthUser } from '../_shared/auth.ts';
import { bindLicenseToUser } from '../_shared/license-bind.ts';
import { handleCors, jsonResponse, normalizeKey } from '../_shared/utils.ts';

interface ValidateBody {
  key: string;
  deviceId: string;
  extensionVersion?: string;
}

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

    const authUser = await requireAuthUser(req, false);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: license, error: fetchError } = await supabase
      .from('license_keys')
      .select('id, key_code, plan, expires_at, max_activations, activations_count, is_active, is_demo')
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

    // Anti-hijack: если ключ уже у другого аккаунта — отказ при попытке bind
    if (authUser) {
      const bind = await bindLicenseToUser(supabase, authUser.id, {
        id: license.id,
        plan: license.plan,
        expires_at: license.expires_at,
      });
      if (!bind.ok && bind.code === 'LICENSE_OWNED_BY_OTHER') {
        return jsonResponse({ ok: false, error: bind.error, code: bind.code }, 403);
      }
    }

    const { data: existingActivation } = await supabase
      .from('license_activations')
      .select('id')
      .eq('license_key_id', license.id)
      .eq('device_id', deviceId)
      .maybeSingle();

    if (!existingActivation) {
      if (license.activations_count >= license.max_activations) {
        return jsonResponse({
          ok: false,
          error: `Лимит устройств (${license.max_activations}). Деактивируйте на другом устройстве.`,
        }, 403);
      }

      const { error: insertError } = await supabase.from('license_activations').insert({
        license_key_id: license.id,
        device_id: deviceId,
        extension_version: body.extensionVersion ?? null,
        user_id: authUser?.id ?? null,
      });

      if (insertError) {
        console.error('activation insert:', insertError);
        return jsonResponse({ ok: false, error: 'Не удалось активировать' }, 500);
      }

      await supabase
        .from('license_keys')
        .update({ activations_count: license.activations_count + 1 })
        .eq('id', license.id);
    } else {
      const activationUpdate: Record<string, unknown> = {
        last_seen_at: new Date().toISOString(),
      };
      if (authUser) {
        activationUpdate.user_id = authUser.id;
      }
      await supabase
        .from('license_activations')
        .update(activationUpdate)
        .eq('license_key_id', license.id)
        .eq('device_id', deviceId);
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
      accountBound: Boolean(authUser),
    });
  } catch (error) {
    console.error('validate-license:', error);
    return jsonResponse({ ok: false, error: 'Внутренняя ошибка' }, 500);
  }
});
