import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validate, rank, lookupTitle, lookupId } from '../scripts/lib.mjs';
import { run } from '../scripts/watchlist.mjs';
import { build, buildCatalog, buildCatalogDefs, buildManifest, buildVersion } from '../scripts/build.mjs';

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

async function tempList(items = [], lists = []) {
  const dir = await mkdtemp(path.join(tmpdir(), 'wl-'));
  const file = path.join(dir, 'watchlist.json');
  await writeFile(file, JSON.stringify({ lists, items }));
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

test('validate checks themed lists', () => {
  const lists = [{ id: 'music', name: 'Music' }];
  assert.deepEqual(validate({ lists, items: [{ id: 'tt1375666', type: 'movie', title: 'X', lists: ['music'] }] }), []);
  const errs = validate({
    lists: [...lists, { id: 'Bad Id', name: '' }, { id: 'music', name: 'dup' }],
    items: [{ id: 'tt1375666', type: 'movie', title: 'X', lists: ['nope'] }],
  });
  assert.match(errs.join('\n'), /lowercase/);
  assert.match(errs.join('\n'), /duplicate list id/);
  assert.match(errs.join('\n'), /unknown list "nope"/);
});

test('CLI themed lists: create, add --list, tag existing, untag, remove list', async () => {
  const file = await tempList();
  const out = [];
  const opts = { file, log: (s) => out.push(s), warn: () => {}, fetchImpl: fakeFetch({}) };
  const read = async () => JSON.parse(await readFile(file, 'utf8'));
  const offline = (id, title) => ['add', '--id', id, '--title', title, '--type', 'movie'];

  await run(['lists', 'add', 'music', 'Music', 'films'], opts);
  await run(['lists', 'add', 'comedy', 'Comedies'], opts);
  await assert.rejects(run([...offline('tt0000001', 'A'), '--list', 'horror'], opts), /unknown list\(s\): horror/);

  await run([...offline('tt0000001', 'A'), '--list', 'music,comedy'], opts);
  await run([...offline('tt0000002', 'B')], opts);
  await run([...offline('tt0000002', 'B'), '--list', 'music'], opts); // already present: just tags
  assert.match(out.at(-1), /tagged/);
  let d = await read();
  assert.deepEqual(d.lists.map((l) => l.name), ['Music films', 'Comedies']);
  assert.deepEqual(d.items.map((i) => i.lists), [['music', 'comedy'], ['music']]);

  await run(['untag', 'A', '--list', 'comedy'], opts);
  await run(['tag', 'tt0000002', '--list', 'comedy'], opts);
  await run(['list', '--list', 'comedy'], opts);
  assert.match(out.at(-1), /^tt0000002/);
  await run(['lists'], opts);
  assert.match(out.at(-1), /music\s+2  Music films\ncomedy\s+1  Comedies/);

  await run(['lists', 'remove', 'music'], opts);
  d = await read();
  assert.deepEqual(d.lists.map((l) => l.id), ['comedy']);
  assert.deepEqual(d.items.map((i) => i.lists), [undefined, ['comedy']]);
});

test('catalog defs: main row always, themed rows only when non-empty per type', () => {
  const data = {
    lists: [
      { id: 'music', name: 'Music' },
      { id: 'comedy', name: 'Comedy' },
    ],
    items: [
      { id: 'tt0000001', type: 'movie', title: 'A', lists: ['music'] },
      { id: 'tt0000002', type: 'series', title: 'B', lists: ['music'] },
      { id: 'tt0000003', type: 'movie', title: 'C', lists: ['comedy'], watched: true },
    ],
  };
  const defs = buildCatalogDefs(data);
  assert.deepEqual(
    defs.map((d) => `${d.id}/${d.type}`),
    ['watchlist/movie', 'watchlist/series', 'list-music/movie', 'list-music/series'],
  );
  assert.deepEqual(buildCatalog(data.items, 'movie', 'music').metas.map((m) => m.id), ['tt0000001']);
  assert.deepEqual(buildCatalog(data.items, 'movie').metas.map((m) => m.id), ['tt0000001']);
  assert.equal(buildVersion('1.0.0', 120000), '1.0.2');
});

test('build writes a valid static addon', async () => {
  const src = await tempList(
    [{ id: 'tt1375666', type: 'movie', title: 'Inception', year: 2010, added: '2026-11-15', lists: ['mind'] }],
    [{ id: 'mind', name: 'Mind-benders' }],
  );
  const out = path.join(path.dirname(src), 'dist');
  const counts = await build({ src, out });
  assert.deepEqual(counts, { 'watchlist/movie': 1, 'watchlist/series': 0, 'list-mind/movie': 1 });
  const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(manifest.catalogs.at(-1), { type: 'movie', id: 'list-mind', name: 'Mind-benders' });
  assert.deepEqual(manifest, buildManifest(manifest.version, buildCatalogDefs({ lists: [{ id: 'mind', name: 'Mind-benders' }], items: [{ id: 'tt1375666', type: 'movie', title: 'Inception', lists: ['mind'] }] })));
  for (const c of manifest.catalogs) {
    const cat = JSON.parse(await readFile(path.join(out, 'catalog', c.type, `${c.id}.json`), 'utf8'));
    assert.ok(Array.isArray(cat.metas));
  }
  assert.match(await readFile(path.join(out, 'index.html'), 'utf8'), /1 titles/);
});

// ---------- history / ratings / import ----------

import { mkdir } from 'node:fs/promises';
import { parseCsv, parseRating, upsert, validateHistory, importExport } from '../scripts/history.mjs';

test('parseRating accepts stars, x/5, x/10', () => {
  assert.equal(parseRating('4'), 4);
  assert.equal(parseRating('3.5'), 3.5);
  assert.equal(parseRating('4/5'), 4);
  assert.equal(parseRating('7/10'), 3.5);
  assert.throws(() => parseRating('6'), /out of range/);
  assert.throws(() => parseRating('great'), /must be like/);
});

test('parseCsv handles quotes, commas, newlines, BOM', () => {
  const rows = parseCsv('﻿Name,Year,Review\r\n"Soul",2020,"warm, ""wise""\nand short"\nOnce,2007,\n');
  assert.deepEqual(rows, [
    { Name: 'Soul', Year: '2020', Review: 'warm, "wise"\nand short' },
    { Name: 'Once', Year: '2007', Review: '' },
  ]);
});

test('upsert: manual wins, imports fill gaps, same-source reimport refreshes', () => {
  const entries = [];
  assert.equal(upsert(entries, { title: 'Whiplash', year: 2014, rating: 3, note: 'too punishing', source: 'manual' }), 'added');
  assert.equal(upsert(entries, { id: 'tt2582802', title: 'Whiplash', year: 2014, rating: 4.5, source: 'letterboxd' }), 'updated');
  assert.deepEqual(entries[0], { title: 'Whiplash', year: 2014, rating: 3, note: 'too punishing', source: 'manual', id: 'tt2582802' });
  upsert(entries, { title: 'Soul', year: 2020, rating: 4, source: 'letterboxd' });
  assert.equal(upsert(entries, { title: 'Soul', year: 2020, rating: 4.5, source: 'letterboxd' }), 'updated');
  assert.equal(entries[1].rating, 4.5);
  assert.equal(upsert(entries, { title: 'Soul', year: 2020, rating: 4.5, source: 'letterboxd' }), 'unchanged');
  assert.deepEqual(validateHistory({ entries }), []);
  assert.match(validateHistory({ entries: [{ title: 'X', rating: 4.2 }] }).join(), /half steps/);
});

test('CLI watched --rating logs history, also for films not on the watchlist', async () => {
  const file = await tempList([{ id: 'tt2948372', type: 'movie', title: 'Soul', year: 2020, watched: false }]);
  const out = [];
  const opts = { file, log: (s) => out.push(s), warn: () => {}, fetchImpl: fakeFetch({}) };
  await run(['watched', 'Soul', '--rating', '4', '--note', 'loved the jazz', '--date', '2026-11-16'], opts);
  await run(['watched', 'Whiplash', '--year', '2014', '--rating', '3', '--note', 'too intense'], opts);
  assert.match(out.at(-1), /not on the watchlist; logged/);
  const wl = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(wl.items[0].watched, true);
  const hist = JSON.parse(await readFile(path.join(path.dirname(file), 'history.json'), 'utf8'));
  assert.deepEqual(hist.entries[0], {
    id: 'tt2948372', type: 'movie', title: 'Soul', year: 2020, rating: 4, date: '2026-11-16', note: 'loved the jazz', source: 'manual',
  });
  assert.equal(hist.entries[1].title, 'Whiplash');
  await run(['watched', 'Soul', '--rating', '4.5'], opts); // re-rate keeps the note
  await run(['history', '--min', '4'], opts);
  assert.match(out.at(-1), /^4\.5  Soul \(2020\)  tt2948372 .*\n      loved the jazz\n\(1 of 2\)$/);
  await run(['check'], opts);
  assert.match(out.at(-1), /2 in history/);
});

test('import: Letterboxd folder, IMDb CSV, Trakt JSON', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'exp-'));
  const lb = path.join(dir, 'letterboxd');
  await mkdir(path.join(lb, 'likes'), { recursive: true });
  const uri = (s) => `https://boxd.it/${s}`;
  await writeFile(path.join(lb, 'watched.csv'), `Date,Name,Year,Letterboxd URI\n2024-01-02,Soul,2020,${uri('a')}\n2024-02-03,Whiplash,2014,${uri('b')}\n2024-03-01,Cats,2019,${uri('c')}\n`);
  await writeFile(path.join(lb, 'ratings.csv'), `Date,Name,Year,Letterboxd URI,Rating\n2024-01-02,Soul,2020,${uri('a')},4.5\n2024-03-01,Cats,2019,${uri('c')},0.5\n`);
  await writeFile(path.join(lb, 'reviews.csv'), `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\n2024-02-03,Whiplash,2014,${uri('b')},3,,"brilliant, exhausting",,2024-02-03\n`);
  await writeFile(path.join(lb, 'likes', 'films.csv'), `Date,Name,Year,Letterboxd URI\n2024-01-02,Soul,2020,${uri('a')}\n`);
  const imdb = path.join(dir, 'ratings.csv');
  await writeFile(imdb, 'Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year\n' +
    'tt0907657,9,2023-05-01,Once,Once,u,Movie,7.8,86,2007\ntt1234567,7,2023-05-01,Ep,Ep,u,TV Episode,8,30,2020\ntt10986410,8,2023-06-01,Ted Lasso,Ted Lasso,u,TV Series,8.8,30,2020\n');
  const trakt = path.join(dir, 'trakt');
  await mkdir(trakt);
  await writeFile(path.join(trakt, 'ratings-movies.json'), JSON.stringify([{ rated_at: '2022-01-01T00:00:00Z', rating: 10, type: 'movie', movie: { title: 'Paterson', year: 2016, ids: { imdb: 'tt5247022' } } }]));
  await writeFile(path.join(trakt, 'watched-shows.json'), JSON.stringify([{ last_watched_at: '2022-02-02T00:00:00Z', show: { title: 'Severance', year: 2022, ids: { imdb: 'tt11280740' } } }]));

  const l = await importExport(lb);
  assert.equal(l.format, 'letterboxd');
  assert.deepEqual(l.entries.find((e) => e.title === 'Soul'), { title: 'Soul', year: 2020, type: 'movie', source: 'letterboxd', date: '2024-01-02', rating: 4.5, liked: true });
  assert.equal(l.entries.find((e) => e.title === 'Whiplash').note, 'brilliant, exhausting');

  const i = await importExport(imdb);
  assert.equal(i.format, 'imdb');
  assert.deepEqual(i.entries.map((e) => [e.id, e.type, e.rating]), [['tt0907657', 'movie', 4.5], ['tt10986410', 'series', 4]]);

  const t = await importExport(trakt);
  assert.equal(t.format, 'trakt');
  assert.deepEqual(t.entries.map((e) => [e.id, e.type, e.rating, e.date]), [['tt5247022', 'movie', 5, '2022-01-01'], ['tt11280740', 'series', undefined, '2022-02-02']]);

  // CLI: import twice is idempotent
  const file = await tempList();
  const out = [];
  const opts = { file, log: (s) => out.push(s), warn: () => {}, fetchImpl: fakeFetch({}) };
  await run(['import', lb, '--dry-run'], opts);
  assert.match(out.at(-1), /dry run.*3 films read \(3 rated\); 3 added/);
  await run(['import', lb], opts);
  await run(['import', lb], opts);
  assert.match(out.at(-1), /0 added, 0 updated, 3 unchanged/);
  await run(['history', '--max', '1'], opts);
  assert.match(out.at(-1), /^0\.5  Cats \(2019\)/);
});
