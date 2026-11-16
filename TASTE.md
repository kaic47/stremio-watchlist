# Kai's film taste

This is the single source of truth for what Kai likes. Every recommendation thread reads it first and writes
Kai's feedback back into it before finishing (see [AGENTS.md](AGENTS.md)). Keep each entry to one line with the
reason, and use Kai's own words where possible. Date anything that can go stale.

**Status (2026-11-16): thin.** Almost everything below comes from one conversation about one mood (pressure while
finishing an EP). Don't generalise from it. Ask Kai the open questions at the bottom when a request touches them.

## How to weigh evidence

1. **What Kai says directly**, about a film or a type of film, with a reason. This outranks everything else.
2. **Verdicts given after watching**: `watched "<title>" --rating N --note "..."` (source `manual` in
   `history.json`), and reactions to recommendation lists.
3. **Imported history** (`history.json` entries whose source is `letterboxd`, `imdb` or `trakt`). Weak signal: Kai has
   "only rated a few movies somewhat randomly". Use it mainly as the seen list, so you don't recommend what Kai has
   already watched. Treat a rating there as a hint only when it is extreme (5, or 1 and below), and never let it
   override 1 or 2.

Accepting a list of picks ("these are fantastic, add them all") means the pitch landed, not that Kai has seen and
liked the films. Don't promote picks to Loves until Kai has watched and rated them.

## About Kai

- Professional electronic music producer. Music films and films about making things hit close to home.
- Mostly wants films. Some shows are fine.
- Wants terse, blunt recommendation lists, one line per pick with the reason.

## Loves

- **Tick, Tick... Boom!** (2021): loved it for its spirit: someone driving themselves hard toward a creative
  deadline and coming through it. Not for the musical side. *(2026-11-15)*

## Liked, with reservations

- **Whiplash** (2014): "good, but a little bit too intense, not uplifting enough." *(2026-11-15)*

## Dislikes

- **Musicals as a form** (characters singing the story). Films about musicians are welcome; musicals aren't. *(2026-11-15)*

## Dealbreakers

None known yet. Ask before assuming any.

## Tendencies (inferred, low confidence)

- Prefers uplifting or hopeful endings over punishing ones. Source: the Whiplash comment and the Tick, Tick... Boom!
  praise. Not yet tested outside music films.
- Likely open to: documentaries (accepted Stutz, Sisters with Transistors, Get Back), animation and anime (accepted
  Soul, Kiki's Delivery Service, Blue Giant), and quiet slow films (accepted Paterson, Perfect Days). Accepted
  pitches only, nothing watched yet.

## Current context

- **2026-11-15:** stressed, struggling to finish an EP. Asked for films about overcoming self-imposed pressure,
  stress and creative block. Revisit this once the EP is done; it shouldn't steer every list forever.

## Reactions to recommendation lists

Who the list was for matters. Lists for other people say nothing about Kai's own taste.

| date | thread | for | sent | Kai's reaction |
|------|--------|-----|------|----------------|
| 2026-11-15 | Recommend films about self-imposed pressure | Kai | 18 picks: Get Back, Soul, Kiki's Delivery Service, Stutz, Once, Begin Again, Sing Street, Love & Mercy, Blue Giant, Sisters with Transistors, Eden (2014), We Are Your Friends, Wonder Boys, Adaptation., Chef, Paterson, Perfect Days, Ted Lasso | "These are fantastic, all of them." All went into the `music` list. |
| 2026-11-15 | Recommend iconic 80s to 2000s films | Kai's 12-year-old brother and mom | 18 family classics (BTTF, E.T., Goonies, Toy Story, ...) | "These are great." Not Kai's own taste. |
| 2026-11-15 | Recommend iconic 80s to 2000s films | adults in their 20s | 18 iconic picks (Breakfast Club, Pulp Fiction, Matrix, Dark Knight, Eternal Sunshine, ...) | No reaction recorded yet. Unknown which ones Kai has already seen. |

## Open questions (ask Kai, then move the answers above)

1. 10 to 15 favourite films of all time, and why.
2. Widely loved films Kai disliked, and why.
3. Genres loved and genres avoided (horror, war, rom-com, sci-fi, crime, slow arthouse).
4. Subtitles and foreign-language films: fine or not?
5. Animation and documentaries outside music: fine?
6. How dark can a film get if it ends well? Any hard no's (animal death, sexual violence, gore)?
7. Older films: is there a cutoff? Long runtimes (2.5h+): fine?
8. Directors or actors Kai follows.
9. Shows Kai has loved.
10. Last 5 films watched, with a rating for each.
11. Which of the iconic 80s to 2000s adult picks Kai has already seen, and what Kai thought of them.

## Changelog

- 2026-11-16: created from the 2026-11-15 recommendation threads.
