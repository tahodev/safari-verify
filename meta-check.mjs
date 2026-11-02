// Metadata regression: served title/description/OG/favicon per app + live-data consistency.
const APPS = [
  ['golden-gate-picnic', null],
  ['sweet-factory-escape-3d', null],
  ['coworking-world', null],
  ['seongsu-dogam', 'dogam'],
  ['kurashi-otaru', 'dogam'],
  ['sajumadang', null],
];
let fail = 0;
for (const [app, kind] of APPS) {
  const base = `https://${app}.onrender.com`;
  const h = await (await fetch(base + '/')).text();
  const has = (re) => re.test(h);
  const title = (h.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const checks = {
    'title non-empty': title.trim().length > 0,
    'meta description': /<meta[^>]+name=["']description["']/i.test(h),
    'og:title': has(/property=["']og:title["']/i), 'og:description': has(/property=["']og:description["']/i),
    'og:image': has(/property=["']og:image["']/i), 'og:url': has(/property=["']og:url["']/i),
    'favicon link': /<link[^>]+rel=["'](?:icon|apple-touch-icon)["']/i.test(h),
    'twitter:card': has(/name=["']twitter:card["']/i),
  };
  const img = (h.match(/property=["']og:image["'][^>]+content=["']([^"']*)["']/i) || [])[1];
  if (img) { const r = await fetch(img, { method: 'HEAD' }).catch(() => null); checks['og:image resolves'] = !!(r && r.ok); }
  if (kind === 'dogam') {
    const dj = await (await fetch(base + '/data.js')).text();
    const nodes = (dj.match(/"id":\s*\d+/g) || []).length;
    const descCount = (h.match(/(\d+)곳|(\d+)か所|(\d+)\s*个/) || []).slice(1).find(Boolean);
    checks['scene count in meta matches data.js'] = descCount ? +descCount === nodes : 'no count in meta';
  }
  for (const [k, v] of Object.entries(checks)) { const ok = v === true || v === 'no count in meta'; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} [${app}] ${k}${v === 'no count in meta' ? '' : ''}`); }
}
console.log(fail ? `META: ${fail} failures` : 'META: all apps green');
process.exit(fail ? 1 : 0);
