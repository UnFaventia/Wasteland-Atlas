# Wasteland Atlas

The travel side of a solo Fallout 2d20 campaign: the wasteland's maps as data, and a route calculator that runs the GM Toolkit's travel rules over them. It feeds the campaign's Obsidian vault (`UnFaventia/Obsidian`), whose GM console plans and runs journeys with it. The vault's `_System/Design/GM Toolkit Plan.md` (rounds 3 and 5) holds the decisions behind it.

The first map is the **Capital Wasteland**, 82 km across, with 458 places, a 455-place gazetteer and 31 terrain zones.

## Credit

The Capital Wasteland map's markers, terrain zones and location notes are the work of the maker of the **"Fallout 3 v2"** Obsidian vault for Fallout 2d20, shared through their Google Drive with an install guide and a travel time calculator. The map image is Fallout 3's Pip-Boy world map (Bethesda). Their files sit in `source/capital-wasteland/` and `maps/` as they came; everything in `data/` is derived from them. This repo is private and for personal play.

## What's where

| Folder | Holds |
|---|---|
| `source/<map>/` | The map-maker's files, untouched: `markers.json` (the Zoom Map plugin's markers and drawn zones), `Locations/` (one note per place), `World Map.md` |
| `maps/` | The map images (`<map>.png`, and one image per overlay), and `<map>.json`: the map's settings (scale, the winding factor, which zone label is which terrain and going, which marker icon is which kind of place, the overlays, the credit) |
| `data/` | What the importer makes: `<map>.json` (nodes, zones, roads, scale) and `<map>.places.json` (the gazetteer); and `<map>.edits.json`, the hand edits it applies last |
| `lib/atlas.js` | The route calculator. Plain JavaScript with nothing from Obsidian in it, so the vault's console runs the very same file |
| `bin/atlas.js` | The command line |
| `tools/` | `import-zoommap.js` (source → data) and `export-vault.js` (data → the vault) |

## The data

- **Coordinates** are `x` and `y` from 0 to 1, from the image's top left. The scale (`km_across`) turns them into kilometres.
- **A node** is a place on the map: `{ name, x, y, marker, layer }`. `marker` is the vault's map-marker kind (`settlement`, `vault`, `danger`…). `layer` is the map-maker's (Settlements, Minor Locations, Metro & Caves, Homebrew).
- **A zone** is a terrain polygon: `{ label, terrain, going, danger, polygon }`. `terrain` names a terrain note in the vault (`Rules/Travel/Terrain/`). `going` is open, normal, rough or hard. Ground outside every zone is normal going. `danger` is 0 for now, for the encounter dice later.
- **A gazetteer entry** is the map-maker's profile of a place, parsed into fields: description, size, type, loot by category, degree searched (with its difficulty and the items it removes), hazards (exterior and interior), terrain, lighting, cover, likely inhabitants, suggested difficulty, vendors, notable NPCs and source.
- **Hand edits** go in `data/<map>.edits.json` (`nodes`, `zones`, `roads`), never in the generated files, so re-importing keeps them. The vault's Rustwater Junction lives there.
- **Roads** are empty for now. They come in P2, traced from the map a district at a time.

## The route (P1)

A trip runs in a straight line, times the map's winding factor (1.3) for the bends. The calculator samples the zones every 100 m along the way, and each stretch goes at its going. These rules are the vault's `Rules/Travel/Travel and Terrain.md` (the vault passes them in; `DEFAULT_RULES` holds the same numbers):

- **Speed:** the slowest traveller's Agility sets it, in round km/h by going (4–5: 4.5, 3, 2.5, 1.5; 6–8: 7.5, 5, 4, 2.5; 9+: 10, 6.5, 5, 3.5).
- **Hours a day:** the lowest Endurance + 2.
- **Hurrying:** twice the speed, with 1 Fatigue for each hurried hour after the first.
- **Pushing on:** extra hours, 1 Fatigue each.
- **Camps** fall where a day's hours run out, and step back out of water.
- **The answer** comes in plain words, with a hint when pushing on an hour or two would save a day.

## Commands

Run from the repo's root:

```
node bin/atlas.js route <from> <to> [--agi 6] [--end 5] [--hurried] [--push n] [--json]
node bin/atlas.js find <text>             places on the map whose names match
node bin/atlas.js place <name>            a place's gazetteer entry
node bin/atlas.js at <name | x,y>         the terrain zone there
node bin/atlas.js maps                    the maps
node bin/atlas.js export <vault folder>   copy the calculator, the data and the images into the vault

node tools/import-zoommap.js capital-wasteland   rebuild data/ from source/ and the edits
```

## Into the vault

`node bin/atlas.js export ../Obsidian` writes:

- `_System/gm/atlas/atlas.js`: the calculator. The vault's console loads it; the phone never does.
- `_System/gm/atlas/<map>.json` and `<map>.places.json`: the map and its gazetteer.
- `_Assets/Maps/<Name>.webp`: the map, plus a copy with each overlay drawn on. The vault's Leaflet map switches between them.
- `_Assets/Maps/<Name> terrain.json`: the zones as GeoJSON, in the Leaflet map's pixels (y up from the bottom), coloured by terrain.
- `_System/gm/atlas/manifest.json`: what it wrote, so the next export removes only its own files.

The WebP images need `@napi-rs/canvas`. The export looks in `GM_CANVAS`, then `/tmp/gm-canvas` (where the vault's cloud environment installs it), then the usual places. Without it, the map goes over as PNG and the overlays are skipped.

After exporting, run the vault's checks (`node _System/gm/check.js`, and the viewtest) and commit there.

In the vault, the console's `travel plan | go | next` runs journeys with this calculator: the clock, Fatigue, camps and arrival. `atlas place` brings a gazetteer place in as a note and a GM profile, rolled with the GM Toolkit's tables.
