"use strict";

function buildVfsTree(entries) {
	const root = { name: "/", path: "/", type: "folder", children: new Map() };

	entries.forEach((entry) => {
		if (!entry) return;
		const isDir = entry.endsWith("/");
		const parts = entry.split("/").filter(Boolean);
		let current = root;
		let currentPath = "/";

		parts.forEach((part, index) => {
			const isLast = index === parts.length - 1;
			const partIsDir = isLast ? isDir : true;
			const nextPath = `${currentPath}${part}${partIsDir ? "/" : ""}`;
			if (!current.children.has(part)) {
				current.children.set(part, {
					name: part,
					path: nextPath,
					type: partIsDir ? "folder" : "file",
					children: new Map()
				});
			}
			const child = current.children.get(part);
			if (partIsDir) {
				child.type = "folder";
			} else if (isLast) {
				child.type = "file";
			}
			current = child;
			currentPath = nextPath;
		});
	});

	return root;
}

function sortedVfsChildren(node) {
	return Array.from(node.children.values()).sort((a, b) => {
		if (a.type !== b.type) {
			return a.type === "folder" ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});
}

function createVfsPreviewLink(folder) {
	if (folder.type !== "folder" || folder.children.get("index.html")?.type !== "file") return null;
	const play = document.createElement("a");
	play.href = `virtual_browser.html?${new URLSearchParams({ folder: folder.path })}`;
	play.target = "_blank";
	play.rel = "noopener";
	play.dataset.action = "play";
	play.setAttribute("aria-label", "Preview website");
	play.title = "Preview website (opens in a new tab)";
	return play;
}

function downloadVfsBlob(blob, name) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadVfsFile(vfs, path) {
	const contents = await vfs.getasync(path);
	const type = typeof contents === "string" ? "text/plain" : "application/octet-stream";
	downloadVfsBlob(new Blob([contents], { type }), vfs.baseName(path));
}
