#!/usr/bin/env node
// Import a "TTRPG Tools - Maps" (Zoom Map) vault into Atlas data: the map's nodes (its markers), its terrain
// zones (its drawn regions), and a gazetteer of its location notes. Run from the Atlas's root:
//
//   node tools/import-zoommap.js capital-wasteland
//
// Reads source/<map>/markers.json and source/<map>/Locations/**.md (the map-maker's files, kept as they came),
// and writes data/<map>.json (the map) and data/<map>.places.json (the gazetteer). Re-running it rebuilds both;
// hand edits belong in data/<map>.edits.json, which this applies last (so they survive a re-import).
const fs = require("fs");
const path = require("path");

const id = process.argv[2] ?? "capital-wasteland";
const root = path.resolve(__dirname, "..");
const src = path.join(root, "source", id);
const config = JSON.parse(fs.readFileSync(path.join(root, "maps", `${id}.json`), "utf8"));
const markers = JSON.parse(fs.readFileSync(path.join(src, "markers.json"), "utf8"));

// ---------- The gazetteer: one entry per location note ----------
// The notes follow one template: **Name**, a description, then **Overseer Information** with
// **Location Loot**, **Location Details**, **Likely Inhabitants**, **Suggested Combat Encounter
// Difficulty**, **Vendors**, **Notable NPCs**, **Full NPC list** and **Source** sections.
const decodeName = (s) => s.replace(/#U([0-9A-F]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
const key = (s) => decodeName(String(s ?? "")).toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
const list = (s) => String(s ?? "").split(/\s*,\s*/).map((x) => x.trim()).filter((x) => x && !/^none$/i.test(x));

function parseNote(file) {
	const text = fs.readFileSync(file, "utf8").replace(/\r/g, "");
	const name = decodeName(path.basename(file, ".md"));
	const sections = {};
	let current = "_top";
	for (const line of text.split("\n")) {
		const h = /^\*\*(.+?)\*\*\s*$/.exec(line.trim());
		if (h) { current = h[1].trim(); sections[current] = []; continue; }
		(sections[current] ??= []).push(line);
	}
	const lines = (s) => (sections[s] ?? []).filter((l) => l.trim() && l.trim() !== "--");
	// "- **Key**: value", with indented "- **Sub**: value" or "- text" beneath
	const fields = (s) => {
		const out = {};
		let last = null;
		for (const l of lines(s)) {
			const indented = /^\s{2,}|\t/.test(l);
			const m = /^\s*-\s*\*\*(.+?)\*\*:\s*(.*)$/.exec(l);
			if (m && !indented) { last = m[1].trim(); out[last] = m[2].trim(); continue; }
			if (last) (out[`${last} +`] ??= []).push(l.replace(/^\s*-\s*/, "").replace(/\*\*(.+?)\*\*:\s*/, "$1: ").trim());
		}
		return out;
	};
	const bullets = (s) => lines(s).map((l) => l.replace(/^\s*-\s*/, "").trim()).filter((l) => l && !/^none$/i.test(l));
	const desc = []; // the description: after the title, before Overseer Information
	for (const [k, v] of Object.entries(sections)) {
		if (k === "Overseer Information") break;
		if (k === name || k === "_top") desc.push(...v);
	}
	const loot = fields("Location Loot");
	const det = fields("Location Details");
	const lootItems = {};
	for (const m of String(loot.Loot ?? "").matchAll(/([A-Za-z][A-Za-z ()&-]*?)\s*\((\d+)\)/g)) lootItems[m[1].trim()] = Number(m[2]);
	const degreeSub = Object.fromEntries((loot["Degree Searched +"] ?? []).map((x) => x.split(/:\s*/)).filter((x) => x.length === 2));
	const terrainSub = (det["Travel Terrain +"] ?? [])[0] ?? "";
	const lighting = (v) => { const m = /^([^(]+?)\s*(\(.*\))?$/.exec(String(v ?? "").trim()); return m ? m[1].trim() || null : null; };
	const source = lines("Source").map((l) => l.trim()).join(" ").trim();
	return {
		name,
		folder: path.relative(path.join(src, "Locations"), path.dirname(file)).split(path.sep).join("/"),
		description: desc.join("\n").trim(),
		size: (loot.Size ?? "").trim() || null,
		type: (loot.Type ?? "").trim() || null,
		loot: lootItems,
		degree: (loot["Degree Searched"] ?? "").trim() || null,
		degree_difficulty: degreeSub["Test Difficulty"] != null ? Number(degreeSub["Test Difficulty"]) : null,
		notable_loot: (loot["Notable Loot +"] ?? []).filter((x) => !/^none$/i.test(x)),
		hazards: { exterior: list(det["Exterior Hazards"]), interior: list(det["Interior Hazards"]) },
		terrain: { kinds: String(det["Travel Terrain"] ?? "").split("/").map((x) => x.trim()).filter(Boolean), going: terrainSub.split("/").map((x) => x.trim().toLowerCase()).filter(Boolean) },
		lighting: { interior: lighting(det["Interior Lighting"]), exterior: lighting(det["Exterior Lighting"]) },
		cover: (det.Cover ?? "").replace(/\s*\(.*\)\s*$/, "").trim() || null,
		inhabitants: bullets("Likely Inhabitants").flatMap(list),
		difficulty: bullets("Suggested Combat Encounter Difficulty")[0] ?? null,
		vendors: bullets("Vendors"),
		npcs: bullets("Notable NPCs"),
		npc_list: lines("Full NPC list").map((l) => l.trim()).join(" ").trim() || null,
		homebrew: /^homebrew$/i.test(source),
		source: source || null,
	};
}

const notes = [];
(function walk(dir) {
	for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, f.name);
		if (f.isDirectory()) walk(p);
		else if (f.name.endsWith(".md")) notes.push(parseNote(p));
	}
})(path.join(src, "Locations"));
notes.sort((a, b) => a.name.localeCompare(b.name));

// ---------- The nodes: one per marker ----------
const layers = Object.fromEntries((markers.layers ?? []).map((l) => [l.id, l.name]));
const byKey = new Map(notes.map((n) => [key(n.name), n]));
const nodes = [];
for (const m of markers.markers ?? []) {
	if (!m.link) continue; // an unnamed pin
	const place = byKey.get(key(m.link));
	const layer = layers[m.layer] ?? null;
	nodes.push({
		name: place?.name ?? decodeName(m.link),
		x: round(m.x),
		y: round(m.y),
		icon: m.iconKey ?? null,
		marker: markerFor(m.iconKey, layer, place),
		layer,
		...(place ? {} : { no_note: true }),
	});
	if (place) place.node = true;
}
nodes.sort((a, b) => a.name.localeCompare(b.name));
function round(v) { return Math.round(Number(v) * 1e5) / 1e5; }

// The vault's own map markers (_Assets/Icons/Markers/) for the map-maker's icons
function markerFor(icon, layer, place) {
	const by = config.markers ?? {};
	if (icon && by[icon]) return by[icon];
	if (layer === "Settlements") return "settlement";
	if (place?.folder?.startsWith("Nature")) return "danger";
	return config.default_marker ?? "landmark";
}

// ---------- The zones: one per drawn region ----------
const zones = [];
for (const d of markers.drawings ?? []) {
	const poly = d.polygon ?? (d.rect ? [{ x: d.rect.x0, y: d.rect.y0 }, { x: d.rect.x1, y: d.rect.y0 }, { x: d.rect.x1, y: d.rect.y1 }, { x: d.rect.x0, y: d.rect.y1 }] : null);
	if (!poly) continue;
	const label = String(d.style?.regionTooltip ?? "").trim();
	const t = terrainFor(label);
	zones.push({ id: d.id, label, terrain: t.terrain, going: t.going, danger: 0, polygon: poly.map((p) => [round(p.x), round(p.y)]) });
}
// "Forest (Rough 3/4)" → Forests and Woodlands, rough: the label's going when it gives one, else the terrain's own
function terrainFor(label) {
	const words = config.zone_terrain ?? {};
	const low = label.toLowerCase();
	const hit = Object.entries(words).find(([w]) => low.startsWith(w.toLowerCase())) ?? Object.entries(words).find(([w]) => low.includes(w.toLowerCase()));
	const terrain = hit?.[1].terrain ?? null;
	const said = /\b(open|rough|hard)\b/i.exec(label.replace(/^[^(]*/, ""))?.[1]?.toLowerCase() ?? /\b(open|rough|hard)\b/i.exec(label)?.[1]?.toLowerCase();
	return { terrain, going: hit?.[1].going ?? said ?? "normal" };
}

// ---------- Hand edits, last ----------
const editsFile = path.join(root, "data", `${id}.edits.json`);
const edits = fs.existsSync(editsFile) ? JSON.parse(fs.readFileSync(editsFile, "utf8")) : {};
for (const [n, e] of Object.entries(edits.nodes ?? {})) {
	const node = nodes.find((x) => key(x.name) === key(n));
	if (node) Object.assign(node, e);
	else nodes.push({ name: n, ...e });
}
for (const [zid, e] of Object.entries(edits.zones ?? {})) {
	const z = zones.find((x) => x.id === zid);
	if (z) Object.assign(z, e);
}
// Danger zones are hand edits only: a circle `around` a node (its `km`), or a `polygon`
const dangers = [];
for (const d of [].concat(edits.dangers ?? [])) {
	const { around, ...rest } = d;
	if (around) {
		const node = nodes.find((x) => key(x.name) === key(around));
		if (!node) { console.log(`  danger zone "${d.label ?? d.id}": no node called ${around}`); continue; }
		dangers.push({ ...rest, around: node.name, center: [node.x, node.y] });
	} else if (d.polygon) dangers.push(rest);
	else console.log(`  danger zone "${d.label ?? d.id}": give it \`around\` (a node) and \`km\`, or a \`polygon\``);
}

const map = {
	id,
	name: config.name,
	region: config.region,
	image: `${id}.png`,
	width: config.width,
	height: config.height,
	km_across: config.km_across,
	winding: config.winding,
	credit: config.credit,
	overlays: config.overlays ?? [],
	nodes,
	zones,
	dangers,
	roads: edits.roads ?? [],
};
fs.writeFileSync(path.join(root, "data", `${id}.json`), `${JSON.stringify(map, null, "\t")}\n`);
fs.writeFileSync(path.join(root, "data", `${id}.places.json`), `${JSON.stringify(notes, null, "\t")}\n`);
console.log(`${id}: ${nodes.length} nodes (${nodes.filter((n) => n.no_note).length} without a note), ${zones.length} zones (${zones.filter((z) => !z.terrain).length} without a terrain), ${dangers.length} danger zone${dangers.length === 1 ? "" : "s"}, ${notes.length} places (${notes.filter((n) => !n.node).length} not on the map, ${notes.filter((n) => n.homebrew).length} homebrew).`);
for (const z of zones.filter((z) => !z.terrain)) console.log(`  zone with no terrain: "${z.label}"`);
