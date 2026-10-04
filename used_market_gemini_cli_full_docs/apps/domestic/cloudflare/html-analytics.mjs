export const GA_MEASUREMENT_ID = 'G-2L2ETG06B1';

const tagOrigin = 'https://www.googletagmanager.com';
const collectionOrigins = ['https://www.google-analytics.com', 'https://region1.google-analytics.com'];

// Extend each policy independently; retain every unrelated directive and source.
export function analyticsCsp(policy) {
  if (!policy) return policy;
  return policy.split(',').map((part) => {
    const directives = part.trim().split(';').map((entry) => entry.trim().split(/\s+/u)).filter(([name]) => name);
    const extend = (name, sources, fallback = 'default-src') => {
      let directive = directives.find(([key]) => key === name);
      if (!directive) {
        const inherited = directives.find(([key]) => key === fallback);
        if (!inherited) return; // No restriction to relax.
        directive = [name, ...inherited.slice(1)];
        directives.push(directive);
      }
      for (const source of sources) if (!directive.includes(source)) directive.push(source);
      if (directive.length > 2) directive.splice(1, directive.length - 1, ...directive.slice(1).filter((v) => v !== "'none'"));
    };
    extend('script-src', [tagOrigin]);
    if (directives.some(([name]) => name === 'script-src-elem')) extend('script-src-elem', [tagOrigin, "'self'"]);
    extend('connect-src', [tagOrigin, ...collectionOrigins]);
    extend('img-src', [tagOrigin, ...collectionOrigins]);
    return directives.map((entry) => entry.join(' ')).join('; ');
  }).join(', ');
}

export async function withHtmlAnalytics(response, request) {
  if (new URL(request.url).pathname.startsWith('/api/')
    || request.method !== 'GET' || !response.ok || response.status === 206
    || !/^text\/html(?:\s*;|$)/iu.test(response.headers.get('content-type') || '')
    || response.headers.has('content-disposition')) return response;

  const html = await response.clone().text();
  // Search Console verification files have an .html suffix/MIME but their
  // exact plaintext payload is not a page and must remain byte-for-byte intact.
  if (!/<(?:html|head)\b/iu.test(html)) return response;
  const scripts = [...html.replace(/<!--[\s\S]*?-->/gu, '').matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu)].map(([script]) => script);
  const hasLoader = scripts.some((script) => /src\s*=\s*["'][^"']*googletagmanager\.com\/gtag\/js\?/iu.test(script));
  const hasConfig = scripts.some((script) => /src\s*=\s*["']\/analytics\.js(?:\?[^"']*)?["']/iu.test(script)
    || /gtag\s*\(\s*['"]config['"]\s*,\s*['"]G-2L2ETG06B1['"]/u.test(script));
  const tags = `${hasLoader ? '' : `<script async src="${tagOrigin}/gtag/js?id=${GA_MEASUREMENT_ID}"></script>`}${hasConfig ? '' : '<script src="/analytics.js"></script>'}`;
  const body = !tags ? html : /<\/head\s*>/iu.test(html)
    ? html.replace(/<\/head\s*>/iu, `${tags}</head>`)
    : `${tags}${html}`;
  const headers = new Headers(response.headers);
  for (const name of ['content-length', 'content-encoding', 'etag', 'last-modified', 'content-md5', 'digest', 'accept-ranges']) headers.delete(name);
  for (const name of ['content-security-policy', 'content-security-policy-report-only']) {
    if (headers.has(name)) headers.set(name, analyticsCsp(headers.get(name)));
  }
  // The asset binding may HIT an old cached shell. Transform after that cache,
  // and require HTML browser revalidation without purging unrelated assets/API.
  const cacheControl = headers.get('cache-control') || '';
  if (!/\bno-store\b/iu.test(cacheControl)) {
    headers.set('cache-control', `${/\bprivate\b/iu.test(cacheControl) ? 'private, ' : ''}no-cache, max-age=0, must-revalidate`);
  }
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
