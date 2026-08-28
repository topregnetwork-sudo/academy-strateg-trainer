const STATIC_EXTENSIONS = /\.(?:css|js|png|jpe?g|gif|svg|webp|ico|mp4|webm|woff2?|txt|map)$/i;

function targetOrigin(pathname, env) {
  if (pathname.startsWith("/api/")) {
    return env.PANEL_ORIGIN;
  }
  return env.PUBLIC_ORIGIN;
}

function upstreamUrl(requestUrl, origin) {
  const source = new URL(requestUrl);
  const target = new URL(origin);
  const basePath = target.pathname.replace(/\/$/, "");
  target.pathname = `${basePath}${source.pathname === "/" ? "/index.html" : source.pathname}`;
  target.search = source.search;
  return target;
}

function responseHeaders(response, pathname) {
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  headers.set("X-Academy-Route", pathname.startsWith("/api/") ? "panel-api-fallback" : "fallback");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (pathname.startsWith("/api/") || pathname.startsWith("/operator")) {
    headers.set("Cache-Control", "no-store");
  } else if (STATIC_EXTENSIONS.test(pathname)) {
    headers.set("Cache-Control", "public, max-age=300");
  }
  return headers;
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.pathname === "/_health") {
      return Response.json({ ok: true, route: "academy-strateg-fallback" }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (!incoming.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    const origin = targetOrigin(incoming.pathname, env);
    const target = upstreamUrl(request.url, origin);
    const headers = new Headers(request.headers);
    headers.set("Host", target.host);
    headers.set("X-Forwarded-Host", incoming.host);

    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual",
      });
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders(upstream, incoming.pathname),
      });
    } catch (error) {
      return Response.json({
        error: "Резервный маршрут временно недоступен",
        detail: String(error?.message || error),
      }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil((async () => {
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await fetch(env.TIMED_AUTOMATION_ENDPOINT, {
            headers: { Authorization: `Bearer ${env.TIMED_TRIGGER_SECRET}` },
          });
          if (!response.ok) throw new Error(`Timed automation returned ${response.status}: ${await response.text()}`);
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
        }
      }
      throw lastError;
    })());
  },
};
