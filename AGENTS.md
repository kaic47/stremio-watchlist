# Notes for agents adding recommendations

- Add entries with `node scripts/watchlist.mjs add "<title>" [--year] [--type] --note "<why>" --source "<thread or person>"`.
  Check stderr for other matches; rerun with `--id` if the pick is wrong.
- If the network blocks `v3-cinemeta.strem.io` and `v2.sg.media-imdb.com`, add offline with
  `--id <tt...> --title "<title>" --type movie|series --year <yyyy>`. Only use an IMDb id you are certain of.
- Run `npm test` before committing. One commit per batch, message like `Add 5 films from <thread>`.
- Never reorder or rewrite existing entries; append only. Mark seen titles with `watched`, don't delete them.
