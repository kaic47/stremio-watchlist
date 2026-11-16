// Shared helpers: watchlist file I/O, validation, title lookup.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WATCHLIST_PATH = path.join(ROOT, 'watchlist.json');
export const TYPES = ['movie', 'series'];
const IMDB_ID = /^tt\d{7,10}$/;
export const LIST_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export async function loadWatchlist(file = WATCHLIST_PATH) {
  const data = JSON.parse(await readFile(file, 'utf8'));
  const errors = validate(data);
  if (errors.length) throw new Error(`${file} is invalid:\n  ${errors.join('\n  ')}`);
  return data;
}

export async function saveWatchlist(data, file = WATCHLIST_PATH) {
  const errors = validate(data);
  if (errors.length) throw new Error(`refusing to save invalid watchlist:\n  ${errors.join('\n  ')}`);
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
}

export function validate(data) {
  const errors = [];
  if (!data || !Array.isArray(data.items)) return ['top level must be {"lists": [...], "items": [...]}'];
  const listIds = new Set();
  if (data.lists != null && !Array.isArray(data.lists)) errors.push('lists must be an array');
  (data.lists ?? []).forEach((l, i) => {
    const at = `lists[${i}]`;
    if (!LIST_ID.test(l?.id ?? '')) errors.push(`${at}: id must be lowercase letters, digits, dashes (e.g. "music")`);
    if (listIds.has(l?.id)) errors.push(`${at}: duplicate list id ${l.id}`);
    listIds.add(l?.id);
    if (typeof l?.name !== 'string' || !l.name.trim()) errors.push(`${at}: name is required`);
    if (l?.description != null && typeof l.description !== 'string') errors.push(`${at}: description must be a string`);
  });
  const seen = new Set();
  data.items.forEach((it, i) => {
    const at = `items[${i}]${it?.title ? ` (${it.title})` : ''}`;
    if (!it || typeof it !== 'object') return errors.push(`${at}: not an object`);
    if (!IMDB_ID.test(it.id ?? '')) errors.push(`${at}: id must be an IMDb id like tt1375666`);
    if (seen.has(it.id)) errors.push(`${at}: duplicate id ${it.id}`);
    seen.add(it.id);
    if (!TYPES.includes(it.type)) errors.push(`${at}: type must be one of ${TYPES.join(', ')}`);
    if (typeof it.title !== 'string' || !it.title.trim()) errors.push(`${at}: title is required`);
    if (it.year != null && !Number.isInteger(it.year)) errors.push(`${at}: year must be an integer`);
    if (it.added != null && !/^\d{4}-\d{2}-\d{2}$/.test(it.added)) errors.push(`${at}: added must be YYYY-MM-DD`);
    if (it.watched != null && typeof it.watched !== 'boolean') errors.push(`${at}: watched must be true/false`);
    for (const k of ['note', 'source', 'poster']) {
      if (it[k] != null && typeof it[k] !== 'string') errors.push(`${at}: ${k} must be a string`);
    }
    if (it.lists != null) {
      if (!Array.isArray(it.lists)) errors.push(`${at}: lists must be an array of list ids`);
      else
        for (const l of it.lists) {
          if (!listIds.has(l)) errors.push(`${at}: unknown list "${l}" (define it in top-level "lists")`);
        }
    }
  });
  return errors;
}

export const isImdbId = (s) => IMDB_ID.test(s);
export const today = () => new Date().toISOString().slice(0, 10);

// ---------- lookup ----------
// Cinemeta (Stremio's own metadata addon) first, IMDb's public suggestion endpoint as fallback.
// Neither needs an API key.

export const norm = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

const firstYear = (v) => {
  const m = String(v ?? '').match(/\d{4}/);
  return m ? Number(m[0]) : undefined;
};

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.json();
}

export async function searchCinemeta(query, type, fetchImpl = fetch) {
  const url = `https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(query)}.json`;
  const { metas = [] } = await getJson(url, fetchImpl);
  return metas
    .filter((m) => isImdbId(m.imdb_id ?? m.id))
    .map((m) => ({ id: m.imdb_id ?? m.id, type, title: m.name, year: firstYear(m.releaseInfo ?? m.year) }));
}

const IMDB_TYPES = { movie: 'movie', tvMovie: 'movie', tvSeries: 'series', tvMiniSeries: 'series' };

export async function searchImdb(query, fetchImpl = fetch) {
  const q = query.trim().toLowerCase();
  const url = `https://v2.sg.media-imdb.com/suggestion/${encodeURIComponent(q[0] ?? 'x')}/${encodeURIComponent(q)}.json`;
  const { d = [] } = await getJson(url, fetchImpl);
  return d
    .filter((r) => isImdbId(r.id) && IMDB_TYPES[r.qid])
    .map((r) => ({ id: r.id, type: IMDB_TYPES[r.qid], title: r.l, year: r.y }));
}

// Score candidates: exact title match and matching year win; otherwise keep source order.
export function rank(candidates, title, year) {
  const t = norm(title);
  return candidates
    .map((c, i) => {
      let score = -i * 0.01;
      if (norm(c.title) === t) score += 10;
      else if (norm(c.title).startsWith(t) || t.startsWith(norm(c.title))) score += 3;
      if (year != null && c.year != null) score += c.year === year ? 20 : -Math.min(Math.abs(c.year - year), 10);
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score);
}

export async function lookupTitle(title, { year, type, fetchImpl = fetch } = {}) {
  const types = type ? [type] : TYPES;
  let candidates = [];
  const failures = [];
  for (const t of types) {
    try {
      candidates.push(...(await searchCinemeta(title, t, fetchImpl)));
    } catch (e) {
      failures.push(`cinemeta: ${e.message}`);
    }
  }
  if (!candidates.length) {
    try {
      candidates = (await searchImdb(title, fetchImpl)).filter((c) => types.includes(c.type));
    } catch (e) {
      failures.push(`imdb: ${e.message}`);
    }
  }
  if (!candidates.length && failures.length === types.length + 1) {
    throw new Error(`lookup failed:\n  ${failures.join('\n  ')}`);
  }
  return rank(candidates, title, year);
}

export async function lookupId(id, { type, fetchImpl = fetch } = {}) {
  for (const t of type ? [type] : TYPES) {
    try {
      const { meta } = await getJson(`https://v3-cinemeta.strem.io/meta/${t}/${id}.json`, fetchImpl);
      if (meta?.name) return { id, type: t, title: meta.name, year: firstYear(meta.releaseInfo ?? meta.year) };
    } catch {
      /* try next type */
    }
  }
  return null;
}
