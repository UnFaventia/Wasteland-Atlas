#!/usr/bin/env node
// The Atlas's command line. From the Atlas's root:
//
//   node bin/atlas.js route <from> <to> [--map capital-wasteland] [--agi 6] [--end 5] [--hurried] [--push n] [--json]
//   node bin/atlas.js find <text>             places on the map whose names match
//   node bin/atlas.js place <name>            a place's gazetteer entry (the map-maker's profile)
//   node bin/atlas.js at <name | x,y>         the terrain zone there
//   node bin/atlas.js maps                    the maps
//   node bin/atlas.js export <vault folder>   copy the calculator, the data and the map images into the vault
const fs = require("fs");
const path = require("path");
const A = require("../lib/atlas.js");

const root = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const args = [];
const flags = {};
for (let i = 0; i < argv.length; i++) {
	if (argv[i].startsWith("--")) {
		const k = argv[i].slice(2);
		const next = argv[i + 1];
		if (next != null && !next.startsWith("--")) { flags[k] = next; i++; } else flags[k] = true;
	} else args.push(argv[i]);
}
const [cmd, ...rest] = args;
const mapId = String(flags.map ?? "capital-wasteland");
const loadMap = (id = mapId) => A.loadMap(JSON.parse(fs.readFileSync(path.join(root, "data", `${id}.json`), "utf8")));
const places = (id = mapId) => JSON.parse(fs.readFileSync(path.join(root, "data", `${id}.places.json`), "utf8"));
const fail = (m) => { console.error(`✗ ${m}`); process.exitCode = 1; };

const commands = {
	route() {
		const [from, to] = rest;
		if (!from || !to) return fail("atlas route <from> <to>");
		const trip = A.route(loadMap(), from, to, { agi: Number(flags.agi ?? 6), end: Number(flags.end ?? 5), hurried: !!flags.hurried, push: Number(flags.push ?? 0) });
		if (trip.error) return fail(trip.error);
		if (flags.json) return console.log(JSON.stringify(trip, null, 2));
		for (const l of A.words(trip)) console.log(l);
	},
	find() {
		const q = rest.join(" ").toLowerCase();
		const map = loadMap();
		const hits = map.nodes.filter((n) => n.name.toLowerCase().includes(q));
		for (const n of hits) console.log(`${n.name}  (${n.layer ?? "?"}, ${n.marker}; ${n.x.toFixed(3)}, ${n.y.toFixed(3)})`);
		if (!hits.length) console.log("Nothing by that name.");
	},
	place() {
		const q = rest.join(" ").toLowerCase();
		const all = places();
		const p = all.find((x) => x.name.toLowerCase() === q) ?? all.filter((x) => x.name.toLowerCase().includes(q)).sort((a, b) => a.name.length - b.name.length)[0];
		if (!p) return fail(`No place called ${rest.join(" ")}.`);
		console.log(JSON.stringify(p, null, 2));
	},
	at() {
		const map = loadMap();
		const m = /^\s*([\d.]+)\s*,\s*([\d.]+)\s*$/.exec(rest.join(" "));
		const pt = m ? { x: Number(m[1]), y: Number(m[2]) } : A.pointOf(map, rest.join(" "));
		if (pt.error) return fail(pt.error);
		const z = A.zoneAt(map, pt.x, pt.y);
		console.log(z ? `${z.label}: ${z.terrain}, ${z.going} going` : "No zone: normal ground.");
	},
	maps() {
		for (const f of fs.readdirSync(path.join(root, "data")).filter((f) => /^[a-z-]+\.json$/.test(f) && !f.endsWith(".edits.json"))) {
			const m = loadMap(f.replace(/\.json$/, ""));
			console.log(`${m.id}: ${m.name} (${m.region}), ${m.km_across} km across, ${m.nodes.length} places, ${m.zones.length} zones, ${m.roads.length} roads`);
		}
	},
	export() {
		return require("../tools/export-vault.js")(root, rest[0], { maps: flags.map ? [mapId] : null });
	},
};

const run = commands[cmd];
if (!run) {
	console.log(fs.readFileSync(__filename, "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
	process.exitCode = cmd ? 1 : 0;
} else Promise.resolve(run()).catch((e) => fail(e.stack ?? e.message));
