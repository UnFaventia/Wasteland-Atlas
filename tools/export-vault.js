// Export the Atlas into the Obsidian vault (GM Toolkit Plan, I1):
//
//   node bin/atlas.js export /home/user/Obsidian [--map capital-wasteland]
//
// writes, for each map:
//   _System/gm/atlas/atlas.js                  the route calculator (the console requires it; the phone never does)
//   _System/gm/atlas/<map>.json                the map: nodes, zones, roads, scale
//   _System/gm/atlas/<map>.places.json         the gazetteer (the map-maker's place profiles)
//   _Assets/Maps/<Name>.webp                   the map image, and each overlay on its own (transparent, drawn over
//                                              the map by Leaflet's imageOverlay, so the pins stay on one base layer)
//   _Assets/Maps/<Name> terrain.json           the zones as GeoJSON, for the Leaflet map
//   _System/gm/atlas/manifest.json             what was written, so the next export removes only its own files
// The images go to WebP through @napi-rs/canvas (the console's canvas: /tmp/gm-canvas, or GM_CANVAS); without
// it they're copied as PNG.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const TERRAIN_COLOURS = {
	Plains: "#c8b560", Hills: "#a0522d", Mountains: "#7a4a2a", Marshland: "#2e8b57",
	"Forests and Woodlands": "#2f6b2f", Water: "#1e6fa8", Ruins: "#8a8a8a", Desert: "#d9b26f",
};

function canvasKit() {
	for (const where of [process.env.GM_CANVAS, "/tmp/gm-canvas/node_modules/@napi-rs/canvas", "@napi-rs/canvas"].filter(Boolean)) {
		try { return require(where); } catch (e) { /* the next */ }
	}
	return null;
}

module.exports = async function exportVault(root, vault, { maps = null } = {}) {
	if (!vault || !fs.existsSync(path.join(vault, "_System"))) throw new Error(`Not a vault: ${vault ?? "(none given)"}. Give the vault's folder.`);
	const outDir = path.join(vault, "_System/gm/atlas");
	const assetDir = path.join(vault, "_Assets/Maps");
	fs.mkdirSync(outDir, { recursive: true });
	fs.mkdirSync(assetDir, { recursive: true });
	const manifestFile = path.join(outDir, "manifest.json");
	const old = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : { files: [] };
	const written = [];
	const write = (rel, data) => {
		fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
		fs.writeFileSync(path.join(vault, rel), data);
		written.push(rel);
	};
	const C = canvasKit();

	write("_System/gm/atlas/atlas.js", fs.readFileSync(path.join(root, "lib/atlas.js")));
	const ids = maps ?? fs.readdirSync(path.join(root, "data")).filter((f) => /^[a-z0-9-]+\.json$/.test(f)).map((f) => f.replace(/\.json$/, ""));
	const summary = [];
	for (const id of ids) {
		const map = JSON.parse(fs.readFileSync(path.join(root, "data", `${id}.json`), "utf8"));
		const places = JSON.parse(fs.readFileSync(path.join(root, "data", `${id}.places.json`), "utf8"));
		// The vault's copy names its images as the vault does
		const ext = C ? "webp" : "png";
		const image = `${map.name}.${ext}`;
		const overlayImage = (o) => `${map.name} (${o.name.toLowerCase()}).${ext}`;
		write(`_System/gm/atlas/${id}.json`, JSON.stringify({ ...map, image, overlays: (map.overlays ?? []).map((o) => ({ ...o, image: overlayImage(o) })) }));
		write(`_System/gm/atlas/${id}.places.json`, JSON.stringify(places));

		// The images: the map, and each overlay on its own. The vault's Leaflet map draws the overlays over the map as
		// tick boxes (imageOverlay), not as base layers: the plugin keeps pins per base layer, so switching base
		// images would hide them.
		const src = path.join(root, "maps", map.image);
		if (C) {
			const webp = async (file) => {
				const im = await C.loadImage(fs.readFileSync(file));
				const c = C.createCanvas(im.width, im.height);
				c.getContext("2d").drawImage(im, 0, 0);
				return c.encode("webp", 88);
			};
			write(`_Assets/Maps/${image}`, await webp(src));
			for (const o of map.overlays ?? []) write(`_Assets/Maps/${overlayImage(o)}`, await webp(path.join(root, "maps", o.image)));
		} else {
			write(`_Assets/Maps/${image}`, fs.readFileSync(src));
			for (const o of map.overlays ?? []) write(`_Assets/Maps/${overlayImage(o)}`, fs.readFileSync(path.join(root, "maps", o.image)));
		}

		// The zones as GeoJSON in the Leaflet map's pixels: x across, y up from the bottom
		const W = Number(map.width), H = Number(map.height);
		const geo = {
			type: "FeatureCollection",
			features: (map.zones ?? []).map((z) => {
				const colour = TERRAIN_COLOURS[z.terrain] ?? "#888888";
				const ring = z.polygon.map(([x, y]) => [Math.round(x * W * 10) / 10, Math.round((1 - y) * H * 10) / 10]);
				ring.push(ring[0]);
				return {
					type: "Feature",
					properties: { title: z.terrain ?? z.label, description: `${z.label}: ${z.going} going`, terrain: z.terrain, going: z.going, color: colour, stroke: colour, fill: colour, "fill-opacity": 0.2, "stroke-width": 1 },
					geometry: { type: "Polygon", coordinates: [ring] },
				};
			}),
		};
		write(`_Assets/Maps/${map.name} terrain.json`, JSON.stringify(geo));
		summary.push(`${map.name}: ${map.nodes.length} places on the map, ${places.length} in the gazetteer, ${map.zones.length} zones, ${(map.roads ?? []).length} roads`);
	}

	// Remove what the last export wrote and this one didn't
	for (const rel of old.files ?? []) if (!written.includes(rel) && fs.existsSync(path.join(vault, rel))) fs.rmSync(path.join(vault, rel));
	let commit = null;
	try { commit = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim(); } catch (e) { /* not a git checkout */ }
	written.push("_System/gm/atlas/manifest.json");
	fs.writeFileSync(manifestFile, `${JSON.stringify({ exported: new Date().toISOString(), atlas_commit: commit, maps: ids, files: written }, null, "\t")}\n`);
	console.log(`Exported into ${vault}${C ? "" : " (no canvas: the images stay PNG)"}:`);
	for (const s of summary) console.log(`  ${s}`);
	console.log(`  ${written.length} files; manifest at _System/gm/atlas/manifest.json`);
};
