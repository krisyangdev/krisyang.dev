# krisyang.dev

Source for [krisyang.dev](https://krisyang.dev), Kris Yang's homepage: a knitted clothesline scene built with Astro and three.js. Letters, link tags and work cards hang on yarn lines you can poke, spin and pull. The scene follows the visitor's local time (day from 6:00, night from 19:00) and the pull cord switches it.

## Develop

```bash
pnpm install
pnpm dev
```

`?time=day` or `?time=night` pins the time of day.

## Deploy

```bash
pnpm build
cf pages deploy dist --project-name krisyang --branch main
```

Sound effects in `public/sfx` are CC0 recordings from freesound.org; see `public/sfx/SOURCES.txt`.
