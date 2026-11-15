#!/usr/bin/env node
// Generate the static Stremio addon into dist/ from watchlist.json.
// Stremio fetches <base>/manifest.json and <base>/catalog/<type>/<id>.json; GitHub Pages serves
// both over HTTPS with `Access-Control-Allow-Origin: *`, which is all a catalog-only addon needs.
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, WATCHLIST_PATH, TYPES, loadWatchlist } from './lib.mjs';

export const CATALOG_ID = 'watchlist';
const posterFor = (id) => `https://images.metahub.space/poster/medium/${id}/img`;

export function buildManifest(version) {
  return {
    id: 'community.kaic47.watchlist',
    version,
    name: "Kai's Watchlist",
    description: 'Films and shows to watch, from recommendation threads. Source: github.com/kaic47/stremio-watchlist',
    resources: ['catalog'],
    types: TYPES,
    catalogs: TYPES.map((type) => ({ type, id: CATALOG_ID, name: 'Watchlist' })),
    idPrefixes: ['tt'],
    behaviorHints: { configurable: false, configurationRequired: false },
  };
}

// Newest additions first; watched entries are left out. Stremio pulls full details
// (cast, runtime, streams) from Cinemeta and other addons by IMDb id.
export function buildCatalog(items, type) {
  return {
    metas: items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => it.type === type && !it.watched)
      .sort((a, b) => (b.it.added ?? '').localeCompare(a.it.added ?? '') || b.i - a.i)
      .map(({ it }) => ({
        id: it.id,
        type: it.type,
        name: it.title,
        poster: it.poster ?? posterFor(it.id),
        ...(it.year ? { releaseInfo: String(it.year) } : {}),
        ...(it.note || it.source
          ? { description: [it.note, it.source && `Recommended by: ${it.source}`].filter(Boolean).join('\n\n') }
          : {}),
      })),
  };
}

const INDEX_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kai's Watchlist</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#111;background:#fff}
a.btn{display:inline-block;padding:.6rem 1rem;background:#7b5bf5;color:#fff;border-radius:.4rem;text-decoration:none}
code{background:#f2f2f2;padding:.1rem .3rem;border-radius:.2rem;word-break:break-all}
@media (prefers-color-scheme:dark){body{color:#eee;background:#111}code{background:#222}}</style></head>
<body><h1>Kai's Watchlist</h1><p>__COUNT__ titles. Stremio catalog addon.</p>
<p><a class="btn" id="install" href="#">Install in Stremio</a></p>
<p>Or paste this into Stremio &rarr; Addons &rarr; search box:<br><code id="url"></code></p>
<script>var u=new URL('manifest.json',location.href).href;document.getElementById('url').textContent=u;
document.getElementById('install').href=u.replace(/^https?:/,'stremio:');</script></body></html>
`;

export async function build({ src = WATCHLIST_PATH, out = path.join(ROOT, 'dist') } = {}) {
  const { items } = await loadWatchlist(src);
  const { version } = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  await rm(out, { recursive: true, force: true });
  await mkdir(path.join(out, 'catalog'), { recursive: true });
  const write = (rel, obj) => writeFile(path.join(out, rel), typeof obj === 'string' ? obj : JSON.stringify(obj));

  await write('manifest.json', buildManifest(version));
  const counts = {};
  for (const type of TYPES) {
    await mkdir(path.join(out, 'catalog', type), { recursive: true });
    const catalog = buildCatalog(items, type);
    counts[type] = catalog.metas.length;
    await write(`catalog/${type}/${CATALOG_ID}.json`, catalog);
  }
  const total = counts.movie + counts.series;
  await write('index.html', INDEX_HTML.replace('__COUNT__', String(total)));
  await write('.nojekyll', '');
  return counts;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  build()
    .then((c) => console.log(`built dist/: ${c.movie} movies, ${c.series} series`))
    .catch((e) => {
      console.error(`error: ${e.message}`);
      process.exit(1);
    });
}
