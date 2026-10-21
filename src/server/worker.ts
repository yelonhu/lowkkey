import { AuthorizationError, CimdFetchError, OAuthProvider, OAuthError } from '@cloudflare/workers-oauth-provider';
import type { OAuthHelpers, OAuthResourceContext } from '@cloudflare/workers-oauth-provider';
import type { ExecutionContext, KVNamespace } from '@cloudflare/workers-types';
import pageCSS from '../app/style.css?raw';
import { requireConsent } from './privacy.ts';
import { createApi } from './api.ts';
import type { Bindings } from './api.ts';
import { ownerForRequest, customerAuth } from './customer-auth.ts';
import { mcpResponse } from './mcp.ts';
import { oauthClient, registerOAuthClient, revokeClient } from './store.ts';

type OAuthEnv = Bindings & { OAUTH_KV: KVNamespace; OAUTH_PROVIDER: OAuthHelpers };
import { cleanupDeletions, event } from './lifecycle.ts';
const api = createApi();
const escape = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const scopes = ['read', 'write', 'notes:write'];

async function authorize(request: Request, env: OAuthEnv): Promise<Response> {
  let ownerId: string;
  try {
    ownerId = await ownerForRequest(request, env);
  } catch {
    if (env.AUTH_MODE === 'customer' && request.method === 'GET')
      return Response.redirect(
        `${new URL(request.url).origin}/?returnTo=${encodeURIComponent(new URL(request.url).pathname + new URL(request.url).search)}#Login`,
        302,
      );
    return new Response('Sign-in required', { status: 401 });
  }
  if (env.AUTH_MODE === 'customer')
    try {
      await requireConsent(env.DB, ownerId);
    } catch {
      if (request.method === 'GET')
        return Response.redirect(
          `${new URL(request.url).origin}/?returnTo=${encodeURIComponent(new URL(request.url).pathname + new URL(request.url).search)}#consent`,
          302,
        );
      return new Response('请回到 lowkkey 确认隐私政策后重新连接。', { status: 403 });
    }
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === 'GET') {
      const auth = await oauth.parseAuthRequest(request);
      const client = await oauth.lookupClient(auth.clientId);
      if (!client) return new Response('Unknown client', { status: 400 });
      const grant = await oauth.beginConsent(auth);
      const redirectHost = new URL(auth.redirectUri).hostname;
      const source = auth.clientId.startsWith('https://') ? new URL(auth.clientId).hostname : 'self-registered client';
      const permissionLabels: Record<string, string> = {
        read: '读取我的记录、计划与随手记',
        write: '直接写入、修改和删除记录、计划与策展',
        'notes:write': '按我的明确要求写入、改写或清空随手记',
      };
      const checks = auth.scope
        .filter(scope => scopes.includes(scope))
        .map(
          scope =>
            `<label><input type="checkbox" name="scope" value="${escape(scope)}" ${scope === 'read' ? 'required' : ''} ${scope === 'notes:write' ? '' : 'checked'}> ${escape(permissionLabels[scope])}</label>`,
        )
        .join('<br>');
      const identity = await env.DB.prepare('SELECT email FROM users WHERE id=?')
        .bind(ownerId)
        .first<{ email: string }>();
      const html = `<!doctype html><html lang="zh" data-theme="ink"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>连接 lowkkey</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Noto+Serif+SC:wght@400;500;600&display=swap"><style>${pageCSS}</style><main class="journey"><header class="journey-header"><span class="brand">lowkkey</span></header><section class="journey-body"><p class="meta">让对话接上你的档案</p><h1>连接 ${escape(client.clientName ?? client.clientId)}</h1><p class="journey-copy">AI 可以读取你的训练与随手记，也可以帮你把聊好的内容留下来。写随手记需单独勾选授权；AI 仍须等你在对话中明确要求。</p><p class="identity-line">${escape(identity?.email ?? '')}</p><form method="post"><input type="hidden" name="owner" value="${escape(ownerId)}"><input type="hidden" name="handle" value="${escape(grant.handle)}"><div class="permission-list">${checks}</div><p class="journey-hint">只勾选读取，AI 就只能查看。你可以随时在设置中撤销连接。</p><details class="journey-help"><summary>连接来自哪里</summary><p>客户端来源：${escape(source)}<br>授权返回地址：${escape(redirectHost)}</p>${/^(localhost|127\.\d+\.\d+\.\d+)$/.test(redirectHost) ? '<p>此地址位于你的电脑。请确认是你刚刚发起的连接。</p>' : ''}</details><button class="journey-primary" name="decision" value="approve">允许连接</button><div class="journey-actions"><button class="journey-quiet" formnovalidate name="decision" value="deny">取消</button>${env.AUTH_MODE === 'customer' ? '<button class="journey-quiet" formnovalidate name="decision" value="switch">换一个账户</button>' : ''}</div></form></section></main></html>`;
      grant.headers.set('Content-Type', 'text/html; charset=utf-8');
      grant.headers.set('Cache-Control', 'no-store');
      return new Response(html, { headers: grant.headers });
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (env.AUTH_MODE === 'customer' && request.headers.get('Origin') !== env.APP_ORIGIN)
      return new Response('Origin required', { status: 403 });
    const form = await request.formData(),
      handle = String(form.get('handle') ?? '');
    if (env.AUTH_MODE === 'customer' && form.get('owner') !== ownerId)
      return new Response('Account changed; restart authorization', { status: 409 });
    if (form.get('decision') === 'switch' && env.AUTH_MODE === 'customer') {
      await oauth.denyConsent(request, handle);
      const signedOut = await customerAuth(env).handler(
        new Request(new URL(request.url).origin + '/api/auth/sign-out', {
          method: 'POST',
          headers: {
            Cookie: request.headers.get('Cookie') ?? '',
            Origin: env.APP_ORIGIN!,
            'Content-Type': 'application/json',
          },
          body: '{}',
        }),
      );
      if (!signedOut.ok) return signedOut;
      const headers = new Headers({ Location: request.url, 'Cache-Control': 'no-store' });
      for (const cookie of signedOut.headers.getSetCookie()) headers.append('Set-Cookie', cookie);
      return new Response(null, { status: 302, headers });
    }
    if (form.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const selected = form
      .getAll('scope')
      .map(String)
      .filter(scope => scopes.includes(scope));
    if (selected.some(s => s === 'write' || s === 'notes:write') && !selected.includes('read'))
      return new Response('保存档案也需要读取权限。请返回并同时允许读取。', { status: 400 });
    if (!selected.length) {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(request, handle, { scope: selected });
    const client = await oauth.lookupClient(approved.request.clientId);
    if (!client) throw new Error('Unknown client');
    const id = crypto.randomUUID(),
      name = client.clientName ?? client.clientId;
    await registerOAuthClient(env.DB, ownerId, approved.request.clientId, name, selected, id);
    let redirectTo: string;
    try {
      ({ redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: ownerId,
        metadata: { clientName: name },
        scope: selected,
        props: { ownerId, clientRecordId: id },
      }));
    } catch (error) {
      await revokeClient(env.DB, ownerId, id);
      throw error;
    }
    await event(env.DB, ownerId, 'authorized');
    approved.headers.set('Location', redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectUri) {
      const url = new URL(error.redirectUri);
      url.searchParams.set('error', error.code);
      url.searchParams.set('error_description', error.description);
      if (error.state) url.searchParams.set('state', error.state);
      if (error.issuer) url.searchParams.set('iss', error.issuer);
      return Response.redirect(url.href, 302);
    }
    if (error instanceof AuthorizationError || error instanceof CimdFetchError)
      return new Response(error instanceof AuthorizationError ? error.description : 'Client metadata unavailable', {
        status: 400,
      });
    throw error;
  }
}

export default {
  async scheduled(_controller: unknown, env: OAuthEnv) {
    await cleanupDeletions(env.DB);
  },
  fetch(request: Request, env: OAuthEnv, ctx: ExecutionContext) {
    const origin = env.APP_ORIGIN ?? new URL(request.url).origin;
    if (env.APP_ENV === 'production' && (!env.APP_ORIGIN || new URL(request.url).origin !== origin))
      return new Response('Origin not configured', { status: 503 });
    const provider = new OAuthProvider<OAuthEnv>({
      apiRoute: '/mcp',
      apiHandler: {
        async fetch(
          req: Request,
          bindings: OAuthEnv,
          context: OAuthResourceContext<{ ownerId?: string; clientRecordId?: string }>,
        ) {
          const unauthorized = () =>
            new Response('Authorization expired or revoked', {
              status: 401,
              headers: {
                'Cache-Control': 'no-store',
                'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="Reconnect lowkkey to authorize this account"`,
              },
            });
          const props = context.props as { ownerId?: string; clientRecordId?: string };
          if (!props.ownerId || !props.clientRecordId) return unauthorized();
          const client = await oauthClient(bindings.DB, props.ownerId, props.clientRecordId);
          if (!client || client.status !== 'active') return unauthorized();
          await bindings.DB.prepare(
            "UPDATE oauth_clients SET last_used_at=? WHERE id=? AND owner_id=? AND status='active'",
          )
            .bind(new Date().toISOString(), client.id, props.ownerId)
            .run();
          if (bindings.AUTH_MODE === 'customer')
            try {
              await requireConsent(bindings.DB, props.ownerId);
            } catch {
              return Response.json(
                {
                  error: 'privacy_required',
                  message: '请回到 lowkkey 确认隐私政策后继续。',
                  view_url: origin + '/#consent',
                },
                { status: 403, headers: { 'Cache-Control': 'no-store' } },
              );
            }
          const granted = JSON.parse(client.scopes_json) as string[];
          const effective = context.auth.scope.filter((scope: string) => granted.includes(scope));
          return mcpResponse(req, bindings.DB, { ownerId: props.ownerId, clientId: client.id, scopes: effective });
        },
      },
      defaultHandler: {
        fetch(req: Request, bindings: OAuthEnv, execution: ExecutionContext) {
          if (new URL(req.url).pathname === '/authorize') return authorize(req, bindings);
          return api.fetch(req, bindings, execution);
        },
      },
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: scopes,
      clientIdMetadataDocumentEnabled: true,
      accessTokenTTL: 3600,
      refreshTokenTTL: 60 * 60 * 24 * 30,
      async tokenExchangeCallback(options) {
        const props = options.props as { ownerId?: string; clientRecordId?: string };
        if (!props.ownerId || !props.clientRecordId || props.ownerId !== options.userId)
          throw new OAuthError('invalid_grant', { description: 'Authorization revoked or unavailable' });
        const client = await oauthClient(env.DB, props.ownerId, props.clientRecordId);
        if (!client || client.status !== 'active')
          throw new OAuthError('invalid_grant', { description: 'Authorization revoked or unavailable' });
        await env.DB.prepare('UPDATE oauth_clients SET grant_id=? WHERE id=? AND owner_id=? AND status=?')
          .bind(options.grantId, props.clientRecordId, props.ownerId, 'active')
          .run();
        return {
          accessTokenScope: (JSON.parse(client.scopes_json) as string[]).filter(scope =>
            options.requestedScope.includes(scope),
          ),
        };
      },
      resourceMetadata: {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: scopes,
        resource_name: 'lowkkey',
      },
    });
    return provider.fetch(request, env, ctx);
  },
};
