import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validate, rank, lookupTitle, lookupId } from '../scripts/lib.mjs';
import { run } from '../scripts/watchlist.mjs';
import { build, buildCatalog, buildManifest } from '../scripts/build.mjs';

// Fake fetch keyed by URL substring.
const fakeFetch = (routes) => async (url) => {
  const hit = Object.entries(routes).find(([k]) => url.includes(k));
  if (!hit) return { ok: false, status: 404, json: async () => ({}) };
  if (hit[1] instanceof Error) throw hit[1];
  return { ok: true, status: 200, json: async () => hit[1] };
};

const CINEMETA_DUNE = {
  metas: [
    { id: 'tt0087182', imdb_id: 'tt0087182', type: 'movie', name: 'Dune', releaseInfo: '1984' },
    { id: 'tt1160419', imdb_id: 'tt1160419', type: 'movie', name: 'Dune', releaseInfo: '2021' },
    { id: 'tt15239678', imdb_id: 'tt15239678', type: 'movie', name: 'Dune: Part Two', releaseInfo: '2024' },
  ],
};

async function tempList(items = []) {
  const dir = await mkdtemp(path.join(tmpdir(), 'wl-'));
  const file = path.join(dir, 'watchlist.json');
  await writeFile(file, JSON.stringify({ items }));
  return file;
}

test('validate catches bad entries', () => {
  assert.deepEqual(validate({ items: [] }), []);
  const errs = validate({
    items: [
      { id: 'tt1375666', type: 'movie', title: 'Inception', year: 2010 },
      { id: 'tt1375666', type: 'movie', title: 'Dup' },
      { id: 'nope', type: 'film', title: '' },
    ],
  });
  assert.equal(errs.length, 4);
  assert.match(errs.join('\n'), /duplicate/);
});

test('rank prefers exact title and matching year', () => {
  const c = [
    { id: 'a', title: 'Dune: Part Two', year: 2024 },
    { id: 'b', title: 'Dune', year: 1984 },
    { id: 'c', title: 'Dune', year: 2021 },
  ];
  assert.equal(rank(c, 'dune', 2021)[0].id, 'c');
  assert.equal(rank(c, 'Dune')[0].id, 'b');
});

test('lookupTitle uses Cinemeta, falls back to IMDb suggestions', async () => {
  const viaCinemeta = await lookupTitle('Dune', {
    year: 2021,
    fetchImpl: fakeFetch({ 'cinemeta.strem.io/catalog/movie': CINEMETA_DUNE, 'cinemeta.strem.io/catalog/series': { metas: [] } }),
  });
  assert.equal(viaCinemeta[0].id, 'tt1160419');
  assert.equal(viaCinemeta[0].type, 'movie');

  const viaImdb = await lookupTitle('Severance', {
    fetchImpl: fakeFetch({
      'cinemeta.strem.io': new Error('blocked'),
      'media-imdb.com/suggestion/s/severance.json': {
        d: [
          { id: 'tt11280740', l: 'Severance', y: 2022, qid: 'tvSeries' },
          { id: 'nm0000001', l: 'Some Person' },
        ],
      },
    }),
  });
  assert.deepEqual(viaImdb.map((r) => [r.id, r.type]), [['tt11280740', 'series']]);

  await assert.rejects(lookupTitle('x', { fetchImpl: fakeFetch({}) }), /lookup failed/);
});

test('lookupId resolves via Cinemeta meta', async () => {
  const r = await lookupId('tt0068646', {
    fetchImpl: fakeFetch({ 'meta/movie/tt0068646': { meta: { name: 'The Godfather', releaseInfo: '1972' } } }),
  });
  assert.deepEqual(r, { id: 'tt0068646', type: 'movie', title: 'The Godfather', year: 1972 });
});

test('CLI add / dedupe / watched / remove', async () => {
  const file = await tempList();
  const out = [];
  const opts = {
    file,
    log: (s) => out.push(s),
    warn: () => {},
    fetchImpl: fakeFetch({ 'catalog/movie': CINEMETA_DUNE, 'catalog/series': { metas: [] } }),
  };
  await run(['add', 'Dune', '--year', '2021', '--note', 'Villeneuve', '--source', 'thread: sci-fi recs'], opts);
  await run(['add', 'Dune', '--year', '2021'], opts);
  assert.match(out.at(-1), /already on the list/);
  await run(['add', '--id', 'tt0110912', '--title', 'Pulp Fiction', '--type', 'movie', '--year', '1994'], opts);

  let { items } = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'tt1160419');
  assert.equal(items[0].note, 'Villeneuve');
  assert.equal(items[0].watched, false);

  await run(['watched', 'Pulp Fiction'], opts);
  ({ items } = JSON.parse(await readFile(file, 'utf8')));
  assert.equal(items[1].watched, true);

  await run(['remove', 'tt1160419'], opts);
  ({ items } = JSON.parse(await readFile(file, 'utf8')));
  assert.deepEqual(items.map((i) => i.id), ['tt0110912']);

  await run(['add', 'Dune', '--dry-run'], opts);
  assert.match(out.at(-1), /would add: tt0087182/);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).items.length, 1);
});

test('catalog: per type, newest first, watched hidden, description from note/source', () => {
  const items = [
    { id: 'tt0000001', type: 'movie', title: 'Old', added: '2026-01-01' },
    { id: 'tt0000002', type: 'movie', title: 'New', year: 2020, added: '2026-06-01', note: 'n', source: 'Sam' },
    { id: 'tt0000003', type: 'movie', title: 'Seen', added: '2026-07-01', watched: true },
    { id: 'tt0000004', type: 'series', title: 'Show', added: '2026-02-01' },
  ];
  const movies = buildCatalog(items, 'movie').metas;
  assert.deepEqual(movies.map((m) => m.name), ['New', 'Old']);
  assert.equal(movies[0].releaseInfo, '2020');
  assert.equal(movies[0].description, 'n\n\nRecommended by: Sam');
  assert.match(movies[0].poster, /metahub\.space\/poster\/medium\/tt0000002\/img/);
  assert.deepEqual(buildCatalog(items, 'series').metas.map((m) => m.id), ['tt0000004']);
});

test('build writes a valid static addon', async () => {
  const src = await tempList([{ id: 'tt1375666', type: 'movie', title: 'Inception', year: 2010, added: '2026-11-15' }]);
  const out = path.join(path.dirname(src), 'dist');
  const counts = await build({ src, out });
  assert.deepEqual(counts, { movie: 1, series: 0 });
  const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest, buildManifest(manifest.version));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  for (const c of manifest.catalogs) {
    const cat = JSON.parse(await readFile(path.join(out, 'catalog', c.type, `${c.id}.json`), 'utf8'));
    assert.ok(Array.isArray(cat.metas));
  }
  assert.match(await readFile(path.join(out, 'index.html'), 'utf8'), /1 titles/);
});
