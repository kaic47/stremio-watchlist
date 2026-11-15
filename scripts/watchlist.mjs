#!/usr/bin/env node
// Edit watchlist.json from the command line. Run with no arguments for help.
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadWatchlist, saveWatchlist, lookupTitle, lookupId, isImdbId, today, TYPES, WATCHLIST_PATH } from './lib.mjs';

const HELP = `Usage: node scripts/watchlist.mjs <command> [options]

  add "<title>"            Look up the IMDb id by title and append it.
      --year <yyyy>        Disambiguate remakes / same-name titles.
      --type movie|series  Restrict the search (default: both).
      --id <tt...>         Skip search; use this IMDb id (title/year fetched if not given).
      --title "<title>"    With --id: no network call at all (needs --type, --year optional).
      --note "<text>"      Why it's on the list.
      --source "<text>"    Who/where recommended it.
      --pick <n>           Take the n-th search result instead of the best match (1-based).
      --dry-run            Print what would be added, write nothing.
  watched <id|title>       Mark watched (hidden from the Stremio catalog, kept in the file).
  unwatched <id|title>     Undo watched.
  remove <id|title>        Delete the entry.
  list [--all]             Print unwatched entries (--all includes watched).
  check                    Validate watchlist.json.
`;

const OPTIONS = {
  year: { type: 'string' },
  type: { type: 'string' },
  id: { type: 'string' },
  title: { type: 'string' },
  note: { type: 'string' },
  source: { type: 'string' },
  pick: { type: 'string' },
  'dry-run': { type: 'boolean' },
  all: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

const fmt = (it) => `${it.id}  ${it.type.padEnd(6)}  ${it.title}${it.year ? ` (${it.year})` : ''}${it.watched ? '  [watched]' : ''}`;

function findEntry(items, key) {
  if (isImdbId(key)) return items.find((it) => it.id === key);
  const k = key.toLowerCase();
  const hits = items.filter((it) => it.title.toLowerCase() === k);
  if (hits.length > 1) throw new Error(`"${key}" matches several entries, use the id:\n  ${hits.map(fmt).join('\n  ')}`);
  return hits[0];
}

export async function run(argv, { fetchImpl = fetch, file = WATCHLIST_PATH, log = console.log, warn = console.error } = {}) {
  const { values: o, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [cmd, ...rest] = positionals;
  const arg = rest.join(' ').trim();
  if (!cmd || o.help) return log(HELP);

  if (o.type && !TYPES.includes(o.type)) throw new Error(`--type must be one of ${TYPES.join(', ')}`);
  const year = o.year ? Number(o.year) : undefined;
  if (o.year && !Number.isInteger(year)) throw new Error('--year must be a number');

  const data = await loadWatchlist(file);

  switch (cmd) {
    case 'check':
      return log(`ok: ${data.items.length} entries`);

    case 'list': {
      const items = data.items.filter((it) => o.all || !it.watched);
      return log(items.length ? items.map(fmt).join('\n') : '(empty)');
    }

    case 'add': {
      let pick;
      if (o.id) {
        if (!isImdbId(o.id)) throw new Error(`--id must look like tt1375666, got ${o.id}`);
        if (o.title) {
          if (!o.type) throw new Error('--id with --title also needs --type movie|series');
          pick = { id: o.id, type: o.type, title: o.title, year };
        } else {
          pick = await lookupId(o.id, { type: o.type, fetchImpl });
          if (!pick) throw new Error(`could not resolve ${o.id}; pass --title and --type to add it offline`);
        }
      } else {
        if (!arg) throw new Error('add needs a title, or --id');
        const results = await lookupTitle(arg, { year, type: o.type, fetchImpl });
        if (!results.length) throw new Error(`no match for "${arg}"${year ? ` (${year})` : ''}`);
        const n = o.pick ? Number(o.pick) : 1;
        pick = results[n - 1];
        if (!pick) throw new Error(`--pick ${n} out of range (${results.length} results)`);
        const others = results.filter((r) => r !== pick).slice(0, 4);
        if (others.length) warn(`other matches (use --pick or --id if wrong):\n${others.map((r, i) => `  ${fmt(r)}`).join('\n')}`);
      }

      const existing = data.items.find((it) => it.id === pick.id);
      if (existing) return log(`already on the list: ${fmt(existing)}`);

      const entry = {
        id: pick.id,
        type: pick.type,
        title: pick.title,
        ...(pick.year ? { year: pick.year } : {}),
        ...(o.note ? { note: o.note } : {}),
        ...(o.source ? { source: o.source } : {}),
        added: today(),
        watched: false,
      };
      if (o['dry-run']) return log(`would add: ${fmt(entry)}`);
      data.items.push(entry);
      await saveWatchlist(data, file);
      return log(`added: ${fmt(entry)}`);
    }

    case 'watched':
    case 'unwatched':
    case 'remove': {
      if (!arg) throw new Error(`${cmd} needs an id or exact title`);
      const entry = findEntry(data.items, arg);
      if (!entry) throw new Error(`not on the list: ${arg}`);
      if (cmd === 'remove') data.items.splice(data.items.indexOf(entry), 1);
      else entry.watched = cmd === 'watched';
      await saveWatchlist(data, file);
      return log(`${cmd === 'remove' ? 'removed' : `marked ${cmd}`}: ${fmt(entry)}`);
    }

    default:
      throw new Error(`unknown command "${cmd}"\n\n${HELP}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch((e) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  });
}
