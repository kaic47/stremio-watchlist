#!/usr/bin/env node
// Edit watchlist.json from the command line. Run with no arguments for help.
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadWatchlist, saveWatchlist, lookupTitle, lookupId, isImdbId, today, TYPES, LIST_ID, WATCHLIST_PATH } from './lib.mjs';
import { historyPathFor, loadHistory, saveHistory, parseRating, upsert, findHistory, importExport, fmtHistory } from './history.mjs';

const HELP = `Usage: node scripts/watchlist.mjs <command> [options]

  add "<title>"            Look up the IMDb id by title and append it.
      --year <yyyy>        Disambiguate remakes / same-name titles.
      --type movie|series  Restrict the search (default: both).
      --id <tt...>         Skip search; use this IMDb id (title/year fetched if not given).
      --title "<title>"    With --id: no network call at all (needs --type, --year optional).
      --note "<text>"      Why it's on the list.
      --source "<text>"    Who/where recommended it.
      --list <id>          Also put it in a themed list (repeatable, or comma-separated).
                           If the title is already on the watchlist, just adds the list tags.
      --pick <n>           Take the n-th search result instead of the best match (1-based).
      --dry-run            Print what would be added, write nothing.
  tag <id|title> --list <id>     Put an existing entry into themed list(s).
  untag <id|title> --list <id>   Take it out of themed list(s).
  lists                          Show themed lists with counts.
  lists add <id> "<name>"        Create a themed list, e.g. lists add comedy "Comedies I'll like".
  lists rename <id> "<name>"     Change its display name in Stremio.
  lists remove <id>              Delete the list and its tags (entries stay on the watchlist).
  watched <id|title>       Mark watched (hidden from the Stremio catalog, kept in the file) and log it
                           in history.json. Works for films not on the watchlist too.
      --rating <r>         0.5-5 in half steps (4, 3.5, 4/5 or 8/10).
      --note "<text>"      Your verdict and why ("too punishing, not uplifting").
      --date <yyyy-mm-dd>  When you watched it (default today).
      --year/--type/--id   Identify a film that isn't on the watchlist.
  unwatched <id|title>     Undo watched on the watchlist (history entry stays).
  history                  Print rated/watched films, best first.
      --min <r> --max <r>  Only ratings in this range, e.g. --min 4.5 (loves), --max 2 (dislikes).
  import <file|folder>     Merge a Letterboxd / IMDb / Trakt export into history.json.
      --format <name>      letterboxd | imdb | trakt (auto-detected if left out).
      --dry-run            Show counts, write nothing.
  remove <id|title>        Delete the entry.
  list [--all] [--list <id>]  Print unwatched entries (--all includes watched).
  check                    Validate watchlist.json and history.json.
`;

const OPTIONS = {
  year: { type: 'string' },
  type: { type: 'string' },
  id: { type: 'string' },
  title: { type: 'string' },
  note: { type: 'string' },
  source: { type: 'string' },
  pick: { type: 'string' },
  list: { type: 'string', multiple: true },
  rating: { type: 'string' },
  date: { type: 'string' },
  min: { type: 'string' },
  max: { type: 'string' },
  format: { type: 'string' },
  'dry-run': { type: 'boolean' },
  all: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

const fmt = (it) =>
  `${it.id}  ${it.type.padEnd(6)}  ${it.title}${it.year ? ` (${it.year})` : ''}${it.lists?.length ? `  #${it.lists.join(' #')}` : ''}${it.watched ? '  [watched]' : ''}`;

function wantedLists(data, raw = []) {
  const ids = [...new Set(raw.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean))];
  const known = new Set((data.lists ?? []).map((l) => l.id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) {
    throw new Error(`unknown list(s): ${missing.join(', ')}. Create with: lists add <id> "<name>"` + (known.size ? `\nexisting: ${[...known].join(', ')}` : ''));
  }
  return ids;
}

function addTags(entry, ids) {
  const before = entry.lists?.length ?? 0;
  const merged = [...new Set([...(entry.lists ?? []), ...ids])];
  if (merged.length) entry.lists = merged;
  return merged.length - before;
}

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
  const historyFile = historyPathFor(file);

  switch (cmd) {
    case 'check': {
      const history = await loadHistory(historyFile);
      return log(`ok: ${data.items.length} entries, ${history.entries.length} in history`);
    }

    case 'list': {
      const [only] = wantedLists(data, o.list);
      const items = data.items.filter((it) => (o.all || !it.watched) && (!only || it.lists?.includes(only)));
      return log(items.length ? items.map(fmt).join('\n') : '(empty)');
    }

    case 'add': {
      const tags = wantedLists(data, o.list);
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
      if (existing) {
        if (!addTags(existing, tags)) return log(`already on the list: ${fmt(existing)}`);
        if (o['dry-run']) return log(`would tag: ${fmt(existing)}`);
        await saveWatchlist(data, file);
        return log(`already on the list, tagged: ${fmt(existing)}`);
      }

      const entry = {
        id: pick.id,
        type: pick.type,
        title: pick.title,
        ...(pick.year ? { year: pick.year } : {}),
        ...(o.note ? { note: o.note } : {}),
        ...(o.source ? { source: o.source } : {}),
        ...(tags.length ? { lists: tags } : {}),
        added: today(),
        watched: false,
      };
      if (o['dry-run']) return log(`would add: ${fmt(entry)}`);
      data.items.push(entry);
      await saveWatchlist(data, file);
      return log(`added: ${fmt(entry)}`);
    }

    case 'watched': {
      const key = arg || o.id;
      if (!key) throw new Error('watched needs an id or exact title');
      const rating = o.rating != null ? parseRating(o.rating) : undefined;
      if (o.date && !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new Error('--date must be YYYY-MM-DD');
      const entry = findEntry(data.items, key) ?? (o.id ? data.items.find((it) => it.id === o.id) : undefined);
      const film = entry
        ? { id: entry.id, type: entry.type, title: entry.title, year: entry.year }
        : {
            id: o.id ?? (isImdbId(key) ? key : undefined),
            type: o.type,
            title: o.title ?? (isImdbId(key) ? undefined : key),
            year,
          };
      if (!film.title) throw new Error(`${key} is not on the watchlist; pass --title to log it`);
      const history = await loadHistory(historyFile);
      upsert(history.entries, { ...film, rating, date: o.date ?? today(), note: o.note, source: 'manual' });
      if (entry && !entry.watched) {
        entry.watched = true;
        await saveWatchlist(data, file);
      }
      await saveHistory(history, historyFile);
      const logged = fmtHistory(findHistory(history.entries, film));
      return log(entry ? `marked watched: ${fmt(entry)}
history: ${logged}` : `not on the watchlist; logged in history: ${logged}`);
    }

    case 'unwatched':
    case 'remove': {
      if (!arg) throw new Error(`${cmd} needs an id or exact title`);
      const entry = findEntry(data.items, arg);
      if (!entry) throw new Error(`not on the list: ${arg}`);
      if (cmd === 'remove') data.items.splice(data.items.indexOf(entry), 1);
      else entry.watched = false;
      await saveWatchlist(data, file);
      return log(`${cmd === 'remove' ? 'removed' : `marked ${cmd}`}: ${fmt(entry)}`);
    }

    case 'history': {
      const { entries } = await loadHistory(historyFile);
      const min = o.min != null ? parseRating(o.min) : undefined;
      const max = o.max != null ? parseRating(o.max) : undefined;
      const shown = entries
        .filter((e) => (min == null || (e.rating ?? -1) >= min) && (max == null || (e.rating ?? 99) <= max))
        .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.date ?? '').localeCompare(a.date ?? ''));
      return log(shown.length ? `${shown.map(fmtHistory).join('\n')}\n(${shown.length} of ${entries.length})` : '(no history yet)');
    }

    case 'import': {
      if (!arg) throw new Error('import needs a file or folder: the unzipped Letterboxd export, IMDb ratings CSV, or Trakt JSON');
      const { format, entries } = await importExport(arg, o.format);
      const history = await loadHistory(historyFile);
      const counts = { added: 0, updated: 0, unchanged: 0 };
      for (const e of entries) counts[upsert(history.entries, e)]++;
      const rated = entries.filter((e) => e.rating != null).length;
      const summary = `${format}: ${entries.length} films read (${rated} rated); ${counts.added} added, ${counts.updated} updated, ${counts.unchanged} unchanged`;
      if (o['dry-run']) return log(`dry run, nothing written. ${summary}`);
      await saveHistory(history, historyFile);
      return log(summary);
    }

    case 'tag':
    case 'untag': {
      if (!arg) throw new Error(`${cmd} needs an id or exact title, plus --list <id>`);
      const ids = wantedLists(data, o.list);
      if (!ids.length) throw new Error(`${cmd} needs --list <id>`);
      const entry = findEntry(data.items, arg);
      if (!entry) throw new Error(`not on the watchlist: ${arg} (use add "<title>" --list ${ids[0]})`);
      if (cmd === 'tag') addTags(entry, ids);
      else {
        entry.lists = (entry.lists ?? []).filter((l) => !ids.includes(l));
        if (!entry.lists.length) delete entry.lists;
      }
      await saveWatchlist(data, file);
      return log(`${cmd === 'tag' ? 'tagged' : 'untagged'}: ${fmt(entry)}`);
    }

    case 'lists': {
      const [sub, id, ...nameParts] = rest;
      const name = nameParts.join(' ').trim();
      data.lists ??= [];
      const list = data.lists.find((l) => l.id === id);
      if (!sub) {
        if (!data.lists.length) return log('(no themed lists; create one with: lists add <id> "<name>")');
        return log(
          data.lists
            .map((l) => {
              const n = data.items.filter((it) => !it.watched && it.lists?.includes(l.id)).length;
              return `${l.id.padEnd(16)} ${String(n).padStart(3)}  ${l.name}`;
            })
            .join('\n'),
        );
      }
      if (sub === 'add') {
        if (!LIST_ID.test(id ?? '')) throw new Error('list id must be lowercase letters, digits, dashes, e.g. "comedy"');
        if (list) throw new Error(`list "${id}" already exists: ${list.name}`);
        if (!name) throw new Error('lists add needs a display name, e.g. lists add comedy "Comedies I\'ll like"');
        data.lists.push({ id, name });
        await saveWatchlist(data, file);
        return log(`created list ${id}: ${name}`);
      }
      if (!list) throw new Error(`no list "${id ?? ''}"`);
      if (sub === 'rename') {
        if (!name) throw new Error('lists rename needs a new name');
        list.name = name;
      } else if (sub === 'remove') {
        data.lists.splice(data.lists.indexOf(list), 1);
        for (const it of data.items) {
          if (!it.lists) continue;
          it.lists = it.lists.filter((l) => l !== id);
          if (!it.lists.length) delete it.lists;
        }
      } else throw new Error(`unknown lists subcommand "${sub}" (add, rename, remove)`);
      await saveWatchlist(data, file);
      return log(`${sub === 'remove' ? 'removed' : 'renamed'} list ${id}`);
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
