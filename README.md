# stremio-watchlist

Kai's watchlist as a Stremio addon. `watchlist.json` is the list; every push to `main` rebuilds a static
catalog addon and publishes it on GitHub Pages. No server, no API keys.

**Install in Stremio:** open https://kaic47.github.io/stremio-watchlist/ and press *Install in Stremio*, or paste
`https://kaic47.github.io/stremio-watchlist/manifest.json` into Stremio → Addons → search box. The list appears on
the Board and in Discover as **Watchlist** (Movies and Series), followed by one row per themed list that has
something in it (e.g. "Music films I'll like"). Streams, cast, and details come from Stremio's
other addons, keyed by IMDb id. Changes show up about a minute after a push (Stremio may cache the catalog briefly;
pull to refresh / reopen the Board). A brand-new themed row needs Stremio to re-read the manifest: every build bumps
the manifest version for that, but if the row doesn't appear after restarting Stremio, reinstall the addon from the
install page.

## Taste profile

[TASTE.md](TASTE.md) records what Kai likes and dislikes, with reasons. Recommendation threads read it first and
write Kai's feedback back into it ([AGENTS.md](AGENTS.md) has the rules). `history.json` logs films watched, with ratings.

```sh
node scripts/watchlist.mjs watched "Soul" --rating 4 --note "warm, made me want to make music"
node scripts/watchlist.mjs watched "Whiplash" --year 2014 --rating 3 --note "too punishing"   # not on the list: history only
node scripts/watchlist.mjs history --min 4.5            # loves
node scripts/watchlist.mjs history --max 2              # dislikes
node scripts/watchlist.mjs import ~/Downloads/letterboxd-kai-2026-11-16   # unzipped Letterboxd export
node scripts/watchlist.mjs import ~/Downloads/ratings.csv                  # IMDb "Your Ratings" export
node scripts/watchlist.mjs import ~/Downloads/trakt-export --dry-run       # Trakt JSON export
```

Ratings are 0.5–5 in half steps; `4/5` and `8/10` are accepted too, and IMDb/Trakt 1–10 ratings are halved on import.
Imports never overwrite a verdict entered with `watched`, and rerunning one only applies changes.

`history.json` entries: `title` (required), `id` (IMDb, when known), `type`, `year`, `rating`, `liked`, `date`
(`YYYY-MM-DD`), `note`, `source` (`manual`, `letterboxd`, `imdb`, `trakt`).

## Themed lists

One watchlist; any entry can also be in any number of themed lists. Each themed list is its own Stremio row.
Watched entries drop out of every row.

```sh
node scripts/watchlist.mjs lists                                   # show lists + counts
node scripts/watchlist.mjs lists add horror "Horror I'll like"     # create
node scripts/watchlist.mjs add "Sorcerer" --list music --list horror
node scripts/watchlist.mjs tag "Inception" --list comedy           # existing entry into a list
node scripts/watchlist.mjs untag "Inception" --list comedy
node scripts/watchlist.mjs list --list music
node scripts/watchlist.mjs lists rename music "Music docs"
node scripts/watchlist.mjs lists remove horror                     # entries stay on the main list
```

## Adding films

Node 20+ required, no `npm install` needed.

```sh
node scripts/watchlist.mjs add "Past Lives" --note "quiet, devastating" --source "recs thread: A24"
node scripts/watchlist.mjs add "Dune" --year 2021           # disambiguate remakes
node scripts/watchlist.mjs add "Severance" --type series
node scripts/watchlist.mjs add "Dune" --dry-run              # preview the match, write nothing
node scripts/watchlist.mjs add --id tt1160419                # by IMDb id (title fetched)
node scripts/watchlist.mjs add --id tt1160419 --title "Dune" --type movie --year 2021   # fully offline
node scripts/watchlist.mjs watched "Dune" --rating 4        # hide from catalog, log to history.json
node scripts/watchlist.mjs remove tt1160419
node scripts/watchlist.mjs list [--all]
node scripts/watchlist.mjs check                             # validate watchlist.json + history.json
```

Title lookup tries Stremio's Cinemeta search first, then IMDb's public suggestion endpoint. The best match wins
(exact title, then year); other candidates print to stderr so a wrong pick is easy to fix with `--pick N` or `--id`.

## Data format

`watchlist.json`:

```json
{
  "lists": [
    { "id": "music", "name": "Music films I'll like" }
  ],
  "items": [
    {
      "id": "tt1160419",
      "type": "movie",
      "title": "Dune",
      "year": 2021,
      "note": "why it's on the list",
      "source": "who or which thread recommended it",
      "lists": ["music"],
      "added": "2026-11-15",
      "watched": false
    }
  ]
}
```

| field     | required | notes |
|-----------|----------|-------|
| `id`      | yes | IMDb id, `tt` + digits. Unique. |
| `type`    | yes | `movie` or `series`. |
| `title`   | yes | Display name in Stremio. |
| `year`    | no  | Integer. |
| `note`    | no  | Shown as the description in Stremio. |
| `source`  | no  | Shown as "Recommended by: …". |
| `added`   | no  | `YYYY-MM-DD`. Catalog is sorted newest first. |
| `watched` | no  | `true` hides it from the catalog. |
| `lists`   | no  | Themed list ids, each defined in top-level `lists` (`id`: lowercase/digits/dashes, `name`: row title). |
| `poster`  | no  | Override URL; default is Stremio's metahub poster for the id. |

Hand edits are fine; CI runs `check` via the tests and fails on a malformed file.

## Development

```sh
npm test          # node:test, no dependencies
npm run build     # writes dist/ (manifest.json, catalog/<type>/watchlist.json, catalog/<type>/list-<id>.json, index.html)
```

`.github/workflows/pages.yml` tests and builds on every PR and deploys `dist/` to Pages on `main`.
GitHub Pages source must be set to **GitHub Actions** (Settings → Pages).
