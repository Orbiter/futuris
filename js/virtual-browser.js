"use strict";

(async () => {
	const folder = new URL(location.href).searchParams.get("folder");
	const label = document.getElementById("preview-folder");
	const notice = document.getElementById("preview-notice");
	const status = document.getElementById("preview-status");
	const frame = document.getElementById("preview-frame");
	const reload = document.getElementById("preview-reload");

	if (!folder || !folder.startsWith("/") || !folder.endsWith("/")) {
		status.textContent = "Open a folder with index.html using the Play button in the VFS.";
		return;
	}
	label.textContent = folder;
	label.hidden = false;

	if (!/^https?:$/.test(location.protocol) || !isSecureContext) {
		status.textContent = "Website previews use a service worker. Serve the Futuris folder from localhost or HTTPS, then open its VFS.";
		document.getElementById("preview-serve-command").hidden = false;
		document.getElementById("preview-local-link").hidden = false;
		return;
	}
	if (!("serviceWorker" in navigator)) {
		status.textContent = "Service workers are unavailable in this browser.";
		return;
	}

	try {
		const registration = await navigator.serviceWorker.register("./vfs_preview.js", {
			scope: "./run/",
			type: "module",
			updateViaCache: "none"
		});
		// This page sits outside /run/, so wait on the registration, not navigator.serviceWorker.ready.
		const worker = registration.installing || registration.waiting || registration.active;
		if (!worker) throw new Error("Preview worker unavailable.");
		await new Promise((resolve, reject) => {
			function checkState() {
				if (worker.state !== "activated" && worker.state !== "redundant") return;
				worker.removeEventListener("statechange", checkState);
				if (worker.state === "activated") resolve();
				else reject(new Error("Preview worker stopped."));
			}
			worker.addEventListener("statechange", checkState);
			checkState();
		});
	} catch {
		status.textContent = "Unable to start the VFS preview. Reload this page to try again.";
		return;
	}

	const project = new URL(`./run/${encodeURIComponent(folder)}/`, location.href);
	const entry = new URL("index.html", project);
	frame.src = entry.href;
	frame.hidden = false;
	notice.hidden = true;
	reload.disabled = false;
	reload.addEventListener("click", () => {
		try {
			const current = new URL(frame.contentWindow.location.href);
			if (current.origin === project.origin && current.pathname.startsWith(project.pathname)) {
				frame.contentWindow.location.reload();
				return;
			}
		} catch {
			// A cross-origin link can replace the frame. Reload the VFS entry point in that case.
		}
		frame.src = entry.href;
	});
})();
