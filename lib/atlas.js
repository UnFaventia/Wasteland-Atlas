// The Wasteland Atlas's route calculator: plain JavaScript with nothing from Obsidian in it, so the Atlas's
// command line and the vault's GM console (which gets a copy through the export) run the same code.
//
// A map is the data file the importer writes (data/<map>.json): its size, its scale (km across), the
// nodes (places on it, x and y from 0 to 1, top left), the zones (terrain polygons in the same units) and,
// later, the roads. A route (P1, GM Toolkit Plan) runs straight from A to B, times a winding factor, and
// samples the zones along the way, so the terrain's going (open, normal, rough, hard) sets the time.
//
//   route(map, from, to, { agi, end, hurried, push, rules })   the trip: km, legs, hours, days, Fatigue
//   words(trip)                                               the same in plain words
//
// `rules` are the travel rules as data (the vault passes its Rules/Travel/Travel and Terrain note's
// frontmatter); DEFAULT_RULES are the same numbers, for the Atlas on its own.
"use strict";

const DEFAULT_RULES = {
	speed_kmh: [
		{ agi: "4-5", open: 4.5, normal: 3, rough: 2.5, hard: 1.5 },
		{ agi: "6-8", open: 7.5, normal: 5, rough: 4, hard: 2.5 },
		{ agi: "9+", open: 10, normal: 6.5, rough: 5, hard: 3.5 },
	],
	travel_hours: "END + 2",
	hurried: { speed: 2, free_hours: 1, fatigue_per_hour: 1 },
	pushing_on: { fatigue_per_hour: 1 },
};
const GOINGS = ["open", "normal", "rough", "hard"];

// "4-5", "9+": does an AGI fall in it?
function inBand(band, v) {
	const s = String(band);
	const plus = /^(\d+)\+$/.exec(s);
	if (plus) return v >= Number(plus[1]);
	const m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(s);
	return m ? v >= Number(m[1]) && v <= Number(m[2]) : Number(s) === v;
}

// The speeds for an AGI: { open, normal, rough, hard } in km/h. Below the table's lowest band, its lowest.
function speedFor(rules, agi) {
	const rows = [].concat(rules?.speed_kmh ?? DEFAULT_RULES.speed_kmh);
	const a = Number(agi);
	return rows.find((r) => inBand(r.agi, a)) ?? (a < 4 ? rows[0] : rows[rows.length - 1]);
}

// "END + 2" → the hours a day you can walk comfortably
function hoursPerDay(rules, end) {
	const m = /END\s*\+\s*(\d+)/i.exec(String(rules?.travel_hours ?? DEFAULT_RULES.travel_hours));
	return Math.max(1, Number(end ?? 5) + (m ? Number(m[1]) : 2));
}

// A map, ready to use: km per unit on each axis, and each zone's area (the smallest zone holding a point wins)
function loadMap(data) {
	const map = { ...data };
	map.kmX = Number(data.km_across);
	map.kmY = Number(data.km_across) * (Number(data.height) / Number(data.width));
	map.zones = [].concat(data.zones ?? []).map((z) => ({ ...z, area: Math.abs(area(z.polygon)) }));
	map.nodes = [].concat(data.nodes ?? []);
	return map;
}
function area(poly) {
	let s = 0;
	for (let i = 0; i < poly.length; i++) {
		const [x1, y1] = poly[i];
		const [x2, y2] = poly[(i + 1) % poly.length];
		s += x1 * y2 - x2 * y1;
	}
	return s / 2;
}
function inside(poly, x, y) {
	let hit = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, yi] = poly[i];
		const [xj, yj] = poly[j];
		if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
	}
	return hit;
}

// The zone at a point: the smallest that holds it, or null (normal ground)
function zoneAt(map, x, y) {
	let best = null;
	for (const z of map.zones) if (inside(z.polygon, x, y) && (!best || z.area < best.area)) best = z;
	return best;
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[–—]/g, "-").replace(/[^a-z0-9 -]/g, "").replace(/\s+/g, " ").trim();

// A node by name: exact, then the only one starting with it, then the only one containing it
function findNode(map, name) {
	const n = norm(name);
	if (!n) return { error: "No place given." };
	const exact = map.nodes.filter((x) => norm(x.name) === n);
	if (exact.length) return exact[0];
	for (const test of [(x) => norm(x.name).startsWith(n), (x) => norm(x.name).includes(n)]) {
		const hits = map.nodes.filter(test);
		if (hits.length === 1) return hits[0];
		if (hits.length > 1) return { error: `Which ${name}? ${hits.slice(0, 8).map((x) => x.name).join(", ")}${hits.length > 8 ? ` and ${hits.length - 8} more` : ""}.`, matches: hits };
	}
	return { error: `Nowhere on the ${map.name} map is called ${name}.` };
}

// A point: a node's name, a node, or { x, y } (0 to 1)
function pointOf(map, ref) {
	if (ref && typeof ref === "object" && Number.isFinite(Number(ref.x)) && Number.isFinite(Number(ref.y))) return { name: ref.name ?? null, x: Number(ref.x), y: Number(ref.y) };
	const n = findNode(map, ref);
	return n.error ? n : { name: n.name, x: n.x, y: n.y, node: n };
}

// Kilometres between two points, as the crow flies
function crowKm(map, a, b) {
	return Math.hypot((b.x - a.x) * map.kmX, (b.y - a.y) * map.kmY);
}

// The terrain along a straight line, every `step` km: [{ terrain, going, km }], neighbours merged
function sampleLine(map, a, b, step = 0.1) {
	const km = crowKm(map, a, b);
	const n = Math.max(1, Math.ceil(km / step));
	const legs = [];
	for (let i = 0; i < n; i++) {
		const t = (i + 0.5) / n;
		const z = zoneAt(map, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
		const terrain = z?.terrain ?? null;
		const going = GOINGS.includes(z?.going) ? z.going : "normal";
		const last = legs[legs.length - 1];
		if (last && last.terrain === terrain && last.going === going) last.km += km / n;
		else legs.push({ terrain, going, km: km / n, from: i / n });
	}
	return legs;
}

// The trip from A to B (P1: a straight line × the map's winding, the terrain from its zones)
//   opts: agi, end (the slowest traveller's: the party moves at its pace), hurried, push (extra hours a day),
//         rules (the travel rules as data), winding (overrides the map's)
function route(map, from, to, opts = {}) {
	const A = pointOf(map, from);
	if (A.error) return A;
	const B = pointOf(map, to);
	if (B.error) return B;
	const rules = opts.rules ?? DEFAULT_RULES;
	const winding = Number(opts.winding ?? map.winding ?? 1.3);
	const speeds = speedFor(rules, opts.agi ?? 6);
	const hurried = !!opts.hurried;
	const factor = hurried ? Number(rules.hurried?.speed ?? 2) : 1;
	const crow = crowKm(map, A, B);
	const legs = sampleLine(map, A, B).map((l) => {
		const km = l.km * winding;
		const kmh = Number(speeds[l.going] ?? speeds.normal) * factor;
		return { terrain: l.terrain, going: l.going, km, kmh, hours: km / kmh, from: l.from };
	});
	const km = legs.reduce((s, l) => s + l.km, 0);
	const hours = legs.reduce((s, l) => s + l.hours, 0);

	// Day by day: END + 2 hours of walking, plus any pushed hours (1 Fatigue each); hurrying, every hour past
	// the first in a day is 1 Fatigue (GM Toolkit p.9)
	const perDay = hoursPerDay(rules, opts.end);
	const push = Math.max(0, Math.floor(Number(opts.push ?? 0)));
	const dayCap = perDay + push;
	const days = [];
	let leg = 0;
	let into = 0; // hours already walked in the current leg
	let fatigue = 0;
	let walked = 0;
	while (leg < legs.length && days.length < 365) {
		let left = dayCap;
		let dayKm = 0;
		let dayHours = 0;
		while (left > 1e-9 && leg < legs.length) {
			const L = legs[leg];
			const take = Math.min(left, L.hours - into);
			dayHours += take;
			dayKm += take * L.kmh;
			into += take;
			left -= take;
			if (into >= L.hours - 1e-9) { leg++; into = 0; }
		}
		walked += dayKm;
		const pushed = Math.max(0, dayHours - perDay);
		const hurriedHours = hurried ? Math.max(0, dayHours - Number(rules.hurried?.free_hours ?? 1)) : 0;
		const dayFatigue = Math.ceil(pushed - 1e-9) * Number(rules.pushing_on?.fatigue_per_hour ?? 1) + Math.ceil(hurriedHours - 1e-9) * Number(rules.hurried?.fatigue_per_hour ?? 1);
		fatigue += dayFatigue;
		// Where the day ends: on the line, but never in the water (a camp steps back to the last dry ground)
		const t0 = km ? Math.min(1, walked / km) : 1;
		const pointAt = (t) => ({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t });
		let t = t0;
		const wet = (tt) => /^water$/i.test(zoneAt(map, pointAt(tt).x, pointAt(tt).y)?.terrain ?? "");
		if (leg < legs.length) for (let back = 0; wet(t) && t > 0 && back < 400; back++) t = Math.max(0, t - 0.1 / Math.max(km, 0.1));
		const at = pointAt(t);
		const z = zoneAt(map, at.x, at.y);
		days.push({ day: days.length + 1, hours: dayHours, km: dayKm, km_left: Math.max(0, km - walked), at, terrain: z?.terrain ?? null, fatigue: dayFatigue, arrives: leg >= legs.length });
	}
	return {
		map: map.id, from: A, to: B, crow_km: crow, km, winding, hours, legs, days,
		per_day: perDay, push, hurried, fatigue, speeds, agi: Number(opts.agi ?? 6), end: Number(opts.end ?? 5),
	};
}

// "7½ hours", "about 40 minutes"
function hoursText(h) {
	if (h < 0.75) return `about ${Math.max(10, Math.round((h * 60) / 10) * 10)} minutes`;
	const half = Math.round(h * 2) / 2;
	const whole = Math.floor(half);
	return `${whole}${half % 1 ? "½" : ""} hour${half === 1 ? "" : "s"}`;
}

// The trip in plain words (R3-1 c: times to the half hour, km whole, no speeds)
function words(trip) {
	if (trip.error) return [trip.error];
	const out = [];
	const kmText = (k) => `${Math.max(1, Math.round(k))} km`;
	out.push(`${trip.from.name ?? "Here"} to ${trip.to.name ?? "there"}: ${kmText(trip.km)} on foot (${kmText(trip.crow_km)} as the crow flies), ${hoursText(trip.hours)} of walking${trip.hurried ? " at a hurried pace" : ""}.`);
	// The ground, biggest share first
	const by = new Map();
	for (const l of trip.legs) {
		const k = `${l.terrain ?? "open country"}|${l.going}`;
		by.set(k, (by.get(k) ?? 0) + l.km);
	}
	const ground = [...by].sort((a, b) => b[1] - a[1]).filter(([, k]) => k >= 0.5).map(([k, v]) => {
		const [t, g] = k.split("|");
		return `${kmText(v)} of ${t === "open country" ? "open country" : t.toLowerCase()} (${g} going)`;
	});
	if (ground.length) out.push(`The ground: ${ground.join(", ")}.`);
	if (trip.days.length <= 1) out.push(`It's done in a day (you can walk ${trip.per_day} hours a day${trip.push ? `, ${trip.push} more pushing on` : ""}).`);
	else {
		out.push(`${trip.days.length} days on the road, camping ${trip.days.length - 1} time${trip.days.length === 2 ? "" : "s"} (${trip.per_day} hours a day${trip.push ? `, pushing on ${trip.push} more` : ""}):`);
		for (const d of trip.days) out.push(`  Day ${d.day}: ${hoursText(d.hours)}, ${kmText(d.km)}${d.arrives ? `, arriving` : `, camping ${d.terrain ? `in the ${d.terrain.toLowerCase()}` : "in open country"} with ${kmText(d.km_left)} to go`}${d.fatigue ? ` (+${d.fatigue} Fatigue)` : ""}.`);
	}
	if (trip.fatigue) out.push(`Fatigue: +${trip.fatigue} in all${trip.hurried ? " from hurrying" : ""}${trip.push ? " from pushing on" : ""}.`);
	// So close: the last day's walk fits in pushing on for an hour or two the day before
	const last = trip.days[trip.days.length - 1];
	if (trip.days.length > 1 && last && last.hours <= 2 && !trip.push) {
		const extra = Math.ceil(last.hours - 1e-9);
		out.push(`Pushing on ${extra} hour${extra === 1 ? "" : "s"} (--push ${extra}) would arrive a day sooner, for +${extra} Fatigue that day.`);
	}
	return out;
}

module.exports = { DEFAULT_RULES, GOINGS, speedFor, hoursPerDay, loadMap, zoneAt, findNode, pointOf, crowKm, sampleLine, route, hoursText, words };
