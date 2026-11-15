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

export const listCatalogId = (listId) => `list-${listId}`;

// Main Watchlist row per type (always present), then one row per themed list and type that has
// unwatched entries. Empty themed rows are left out so the Board stays clean.
export function buildCatalogDefs({ lists = [], items }) {
  const defs = TYPES.map((type) => ({ type, id: CATALOG_ID, name: 'Watchlist' }));
  for (const l of lists) {
    for (const type of TYPES) {
      if (items.some((it) => it.type === type && !it.watched && it.lists?.includes(l.id))) {
        defs.push({ type, id: listCatalogId(l.id), name: l.name, list: l.id });
      }
    }
  }
  return defs;
}

// Stremio caches the manifest; a fresh patch number on every build lets it notice new rows.
export const buildVersion = (base, now = Date.now()) => `${base.split('.').slice(0, 2).join('.')}.${Math.floor(now / 60000)}`;

export function buildManifest(version, defs) {
  return {
    id: 'community.kaic47.watchlist',
    version,
    name: "Kai's Watchlist",
    description: 'Films and shows to watch, from recommendation threads, plus themed lists. Source: github.com/kaic47/stremio-watchlist',
    resources: ['catalog'],
    types: TYPES,
    catalogs: defs.map(({ type, id, name }) => ({ type, id, name })),
    idPrefixes: ['tt'],
    behaviorHints: { configurable: false, configurationRequired: false },
  };
}

// Newest additions first; watched entries are left out. Stremio pulls full details
// (cast, runtime, streams) from Cinemeta and other addons by IMDb id.
export function buildCatalog(items, type, listId) {
  return {
    metas: items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => it.type === type && !it.watched && (!listId || it.lists?.includes(listId)))
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

export async function build({ src = WATCHLIST_PATH, out = path.join(ROOT, 'dist'), now = Date.now() } = {}) {
  const data = await loadWatchlist(src);
  const { version } = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  await rm(out, { recursive: true, force: true });
  const write = async (rel, obj) => {
    await mkdir(path.dirname(path.join(out, rel)), { recursive: true });
    await writeFile(path.join(out, rel), typeof obj === 'string' ? obj : JSON.stringify(obj));
  };

  const defs = buildCatalogDefs(data);
  await write('manifest.json', buildManifest(buildVersion(version, now), defs));
  const counts = {};
  for (const d of defs) {
    const catalog = buildCatalog(data.items, d.type, d.list);
    counts[`${d.id}/${d.type}`] = catalog.metas.length;
    await write(`catalog/${d.type}/${d.id}.json`, catalog);
  }
  const total = data.items.filter((it) => !it.watched).length;
  await write('index.html', INDEX_HTML.replace('__COUNT__', String(total)));
  await write('.nojekyll', '');
  return counts;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  build()
    .then((c) => console.log(`built dist/:\n${Object.entries(c).map(([k, n]) => `  ${k}: ${n}`).join('\n')}`))
    .catch((e) => {
      console.error(`error: ${e.message}`);
      process.exit(1);
    });
}
