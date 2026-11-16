# Notes for agents

## Before recommending anything

1. Read [TASTE.md](TASTE.md) in full, including "How to weigh evidence" and "Open questions".
2. Check what Kai has already seen or been pitched: `node scripts/watchlist.mjs history` (watched and rated), the
   `watchlist.json` items, and the "Reactions to recommendation lists" table in TASTE.md. Don't re-recommend any of it
   unless Kai asks.
3. If the request touches an open question (genre, subtitles, darkness, era...), ask it, briefly, alongside the list.

## After Kai reacts (before the thread finishes)

Write the feedback into TASTE.md in the same thread:
- Reaction to a list: add a row to "Reactions to recommendation lists", noting who the list was for.
- A verdict on a film ("loved it", "too slow", "turned it off"): put it under Loves / Liked / Dislikes with Kai's
  reason and the date. If Kai gave a rating, also run
  `node scripts/watchlist.mjs watched "<title>" --rating N --note "<reason>"` so it lands in `history.json`.
- A rule ("no horror", "subtitles are fine"): Dislikes, Dealbreakers or About Kai. Remove the open question it answers.
- Context that will go stale ("stressed about the EP"): Current context, dated.
- Add a Changelog line. Don't rewrite Kai's words, and don't promote an inference to a fact without Kai saying so.

Commit TASTE.md changes straight to `main` with a message like `Taste: <what changed>`; pull first, since other
threads push here too.

## Adding recommendations to the watchlist

- Add entries with `node scripts/watchlist.mjs add "<title>" [--year] [--type] [--list <id>] --note "<why>" --source "<thread or person>"`.
- Themed lists: `node scripts/watchlist.mjs lists` shows them. Put a pick in every list it fits. Create a new list
  (`lists add <id> "<name>"`) only when Kai asks for that theme; don't invent lists.
  Check stderr for other matches; rerun with `--id` if the pick is wrong.
- If the network blocks `v3-cinemeta.strem.io` and `v2.sg.media-imdb.com`, add offline with
  `--id <tt...> --title "<title>" --type movie|series --year <yyyy>`. Only use an IMDb id you are certain of.
- Run `npm test` before committing. One commit per batch, message like `Add 5 films from <thread>`.
- Never reorder or rewrite existing entries; append only. Mark seen titles with `watched`, don't delete them.

## History and ratings

- `history.json` holds everything Kai has watched, one entry per film, with an optional 0.5-5 rating and note.
  Entries from `import` carry `source: letterboxd|imdb|trakt` and may lack an IMDb id. Treat them as weak signal
  (see TASTE.md). Entries from `watched` carry `source: manual` and always win over imports.
- `node scripts/watchlist.mjs import <folder|file>` merges an export. It is idempotent; rerun it with a newer export.
- `liked: true` with no rating means Kai named it as a favourite in words; treat it like a 4.5-5.
