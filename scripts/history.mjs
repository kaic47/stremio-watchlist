// Viewing history and ratings: history.json. This is the taste data (what Kai watched and what they
// thought of it), kept apart from watchlist.json, which is only what Stremio shows.
// Ratings use Letterboxd's scale: 0.5 to 5 in half steps. IMDb/Trakt 1-10 ratings are halved on import.
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { isImdbId, norm, TYPES } from './lib.mjs';

export const historyPathFor = (watchlistFile) => path.join(path.dirname(watchlistFile), 'history.json');

export async function loadHistory(file) {
  let data;
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return { entries: [] };
    throw e;
  }
  const errors = validateHistory(data);
  if (errors.length) throw new Error(`${file} is invalid:\n  ${errors.join('\n  ')}`);
  return data;
}

export async function saveHistory(data, file) {
  const errors = validateHistory(data);
  if (errors.length) throw new Error(`refusing to save invalid history:\n  ${errors.join('\n  ')}`);
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
}

export function validateHistory(data) {
  if (!data || !Array.isArray(data.entries)) return ['top level must be {"entries": [...]}'];
  const errors = [];
  const ids = new Set();
  data.entries.forEach((e, i) => {
    const at = `entries[${i}]${e?.title ? ` (${e.title})` : ''}`;
    if (!e || typeof e !== 'object') return errors.push(`${at}: not an object`);
    if (typeof e.title !== 'string' || !e.title.trim()) errors.push(`${at}: title is required`);
    if (e.id != null) {
      if (!isImdbId(e.id)) errors.push(`${at}: id must be an IMDb id like tt1375666`);
      if (ids.has(e.id)) errors.push(`${at}: duplicate id ${e.id}`);
      ids.add(e.id);
    }
    if (e.type != null && !TYPES.includes(e.type)) errors.push(`${at}: type must be one of ${TYPES.join(', ')}`);
    if (e.year != null && !Number.isInteger(e.year)) errors.push(`${at}: year must be an integer`);
    if (e.rating != null && !isRating(e.rating)) errors.push(`${at}: rating must be 0.5-5 in half steps`);
    if (e.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) errors.push(`${at}: date must be YYYY-MM-DD`);
    if (e.liked != null && typeof e.liked !== 'boolean') errors.push(`${at}: liked must be true/false`);
    for (const k of ['note', 'source']) if (e[k] != null && typeof e[k] !== 'string') errors.push(`${at}: ${k} must be a string`);
  });
  return errors;
}

const isRating = (r) => typeof r === 'number' && r >= 0.5 && r <= 5 && Number.isInteger(r * 2);

// "4", "3.5", "4/5", "8/10" -> 0.5..5
export function parseRating(raw) {
  const m = String(raw).trim().match(/^(\d+(?:\.\d+)?)(?:\s*\/\s*(5|10))?$/);
  if (!m) throw new Error(`--rating must be like 4, 3.5, 4/5 or 8/10, got ${raw}`);
  let r = Number(m[1]);
  if (m[2] === '10') r /= 2;
  r = Math.round(r * 2) / 2;
  if (!isRating(r)) throw new Error(`--rating out of range (0.5-5, or 1-10 with /10): ${raw}`);
  return r;
}

const sameFilm = (a, b) =>
  a.id && b.id ? a.id === b.id : norm(a.title) === norm(b.title) && (a.year == null || b.year == null || a.year === b.year);

export const findHistory = (entries, film) => entries.find((e) => sameFilm(e, film));

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''));

// Manual verdicts (from the CLI) always win. Imports fill gaps, and a re-import from the same source
// refreshes what that source owns (e.g. a rating changed on Letterboxd).
export function upsert(entries, incoming) {
  const film = clean(incoming);
  const existing = findHistory(entries, film);
  if (!existing) {
    entries.push(film);
    return 'added';
  }
  const before = JSON.stringify(existing);
  if (film.source === 'manual' || film.source === existing.source) {
    Object.assign(existing, film);
  } else {
    for (const [k, v] of Object.entries(film)) if (existing[k] == null && k !== 'source') existing[k] = v;
  }
  return JSON.stringify(existing) === before ? 'unchanged' : 'updated';
}

// ---------- import ----------

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') (field += '"'), i++;
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [header = [], ...body] = rows.filter((r) => r.length > 1 || r[0] !== '');
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const int = (v) => (/^\d{4}$/.test(String(v ?? '').trim()) ? Number(v) : undefined);
const day = (v) => (String(v ?? '').match(/^\d{4}-\d{2}-\d{2}/) ?? [])[0];
const clip = (s, n = 400) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || undefined);
const num = (v) => (v === '' || v == null ? undefined : Number(v));

// Letterboxd: Settings -> Data -> Export your data, unzipped. watched.csv, ratings.csv, diary.csv,
// reviews.csv, likes/films.csv. No IMDb ids in the export; every entry is a film.
export function fromLetterboxd(files) {
  const byKey = new Map();
  const get = (r) => {
    const key = r['Letterboxd URI'] || `${norm(r.Name)}|${r.Year}`;
    if (!byKey.has(key)) byKey.set(key, { title: r.Name, year: int(r.Year), type: 'movie', source: 'letterboxd' });
    return byKey.get(key);
  };
  for (const r of files['watched.csv'] ?? []) get(r).date ??= day(r.Date);
  for (const r of files['diary.csv'] ?? []) {
    const e = get(r);
    const d = day(r['Watched Date']) ?? day(r.Date);
    if (d && (!e.date || d > e.date)) e.date = d;
    if (num(r.Rating)) e.rating = num(r.Rating);
  }
  for (const r of files['ratings.csv'] ?? []) if (num(r.Rating)) get(r).rating = num(r.Rating);
  for (const r of files['reviews.csv'] ?? []) {
    const e = get(r);
    if (r.Review) e.note = clip(r.Review);
    if (e.rating == null && num(r.Rating)) e.rating = num(r.Rating);
  }
  for (const r of files['films.csv'] ?? []) get(r).liked = true; // likes/films.csv
  for (const name of Object.keys(files)) {
    if (/^(watched|diary|ratings|reviews|films)\.csv$/.test(name)) continue;
    for (const r of files[name]) if (r['Letterboxd URI'] && r.Name) get(r); // any other Letterboxd CSV
  }
  return [...byKey.values()].filter((e) => e.title);
}

const IMDB_TYPES = { movie: 'movie', 'tv movie': 'movie', 'tv series': 'series', 'tv mini series': 'series', 'tv special': 'movie' };

// IMDb: Your Ratings -> Export. One CSV, 1-10 ratings.
export function fromImdb(rows) {
  return rows
    .filter((r) => isImdbId(r.Const) && IMDB_TYPES[(r['Title Type'] ?? 'movie').toLowerCase()])
    .map((r) => ({
      id: r.Const,
      type: IMDB_TYPES[(r['Title Type'] ?? 'movie').toLowerCase()],
      title: r.Title,
      year: int(r.Year),
      rating: num(r['Your Rating']) ? Math.round(num(r['Your Rating'])) / 2 : undefined,
      date: day(r['Date Rated']),
      source: 'imdb',
    }));
}

// Trakt: data export JSON (ratings-movies.json, ratings-shows.json, watched-movies.json, watched-shows.json).
export function fromTrakt(files) {
  const out = [];
  for (const [name, rows] of Object.entries(files)) {
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      const m = r.movie ?? r.show;
      if (!m?.title || (r.type && !['movie', 'show'].includes(r.type))) continue;
      out.push({
        id: isImdbId(m.ids?.imdb ?? '') ? m.ids.imdb : undefined,
        type: r.movie ? 'movie' : 'series',
        title: m.title,
        year: Number.isInteger(m.year) ? m.year : undefined,
        rating: /ratings/.test(name) && r.rating ? Math.round(r.rating) / 2 : undefined,
        date: day(r.rated_at ?? r.last_watched_at),
        source: 'trakt',
      });
    }
  }
  return out;
}

export function detect(files) {
  const names = Object.keys(files);
  const rows = Object.values(files).find(Array.isArray) ?? [];
  if (names.some((n) => n.endsWith('.json'))) return 'trakt';
  if (rows[0] && 'Const' in rows[0]) return 'imdb';
  if (rows[0] && ('Letterboxd URI' in rows[0] || 'Name' in rows[0])) return 'letterboxd';
  return null;
}

// Read a file or a folder (one level, plus Letterboxd's likes/ subfolder) into { basename: rows }.
export async function readExport(p) {
  const files = {};
  const add = async (f) => {
    const base = path.basename(f).toLowerCase();
    if (base.endsWith('.csv')) files[base] = parseCsv(await readFile(f, 'utf8'));
    else if (base.endsWith('.json')) files[base] = JSON.parse(await readFile(f, 'utf8'));
  };
  if ((await stat(p)).isDirectory()) {
    for (const name of await readdir(p)) {
      const f = path.join(p, name);
      if ((await stat(f)).isDirectory()) {
        if (name === 'likes') for (const n of await readdir(f)) await add(path.join(f, n));
      } else await add(f);
    }
  } else await add(p);
  if (!Object.keys(files).length) throw new Error(`no .csv or .json files in ${p} (unzip the export first)`);
  return files;
}

export async function importExport(p, format) {
  const files = await readExport(p);
  const fmt = format ?? detect(files);
  if (fmt === 'letterboxd') return { format: fmt, entries: fromLetterboxd(files) };
  if (fmt === 'imdb') return { format: fmt, entries: fromImdb(Object.values(files).flat()) };
  if (fmt === 'trakt') return { format: fmt, entries: fromTrakt(files) };
  throw new Error(`can't tell what export this is; pass --format letterboxd|imdb|trakt`);
}

export const fmtHistory = (e) =>
  `${e.rating != null ? e.rating.toFixed(1) : ' - '}${e.liked ? '♥' : ' '} ${e.title}${e.year ? ` (${e.year})` : ''}` +
  `${e.id ? `  ${e.id}` : ''}${e.date ? `  ${e.date}` : ''}${e.note ? `\n      ${e.note.replace(/\s+/g, ' ')}` : ''}`;
