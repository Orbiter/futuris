import "./js/vfs.js";

const runPath = new URL("./run/", import.meta.url).pathname;
const mimeTypes = new Map(Object.entries({
	html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript",
	mjs: "text/javascript", json: "application/json", map: "application/json",
	webmanifest: "application/manifest+json", txt: "text/plain", csv: "text/csv",
	xml: "application/xml", svg: "image/svg+xml", png: "image/png",
	jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
	avif: "image/avif", ico: "image/vnd.microsoft.icon", bmp: "image/bmp",
	woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
	wasm: "application/wasm", pdf: "application/pdf", mp3: "audio/mpeg",
	wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", mp4: "video/mp4",
	webm: "video/webm", vtt: "text/vtt"
}));

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin || !url.pathname.startsWith(runPath) || event.request.method !== "GET") return;
	event.respondWith(serveFile(url, event.request));
});

function validSegment(segment) {
	return segment && segment !== "." && segment !== ".." && !/[/\\\x00-\x1f\x7f]/.test(segment);
}

function getFilePath(url) {
	const segments = url.pathname.slice(runPath.length).split("/");
	if (segments.length < 2) return null;
	const folder = decodeURIComponent(segments.shift());
	if (!folder.startsWith("/") || !folder.endsWith("/") ||
		(folder !== "/" && !folder.slice(1, -1).split("/").every(validSegment))) return null;

	if (segments.at(-1) === "") segments[segments.length - 1] = "index.html";
	const parts = segments.map(decodeURIComponent);
	return parts.every(validSegment) ? folder + parts.join("/") : null;
}

async function readFile(path) {
	const vfs = await globalThis.vfsReady;
	try {
		return await vfs.getasync(path);
	} catch (error) {
		if (error !== "Key not found") throw error;
		return null;
	}
}

async function serveFile(url, request) {
	let path;
	try {
		path = getFilePath(url);
	} catch {
		return new Response("Invalid VFS path.", { status: 400 });
	}
	if (!path) return new Response("Invalid VFS path.", { status: 400 });

	try {
		const value = await readFile(path);
		if (value === null) {
			if (request.mode === "navigate" && !url.pathname.endsWith("/") && await readFile(path + "/index.html") !== null) {
				url.pathname += "/";
				return Response.redirect(url, 302);
			}
			return new Response("File not found in the VFS.", { status: 404 });
		}
		const extension = /\.([^.\/]+)$/.exec(path)?.[1].toLowerCase();
		const type = mimeTypes.get(extension);
		const mimeType = type && typeof value === "string" ? type + "; charset=utf-8" : type;
		return new Response(value, {
			headers: {
				"Content-Type": mimeType || "application/octet-stream",
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff"
			}
		});
	} catch {
		return new Response("Unable to read the VFS file.", { status: 500 });
	}
}
