"use strict";

(async () => {
	const studio = document.getElementById("code-studio");
	const tree = document.getElementById("studio-tree");
	const treeEmpty = document.getElementById("studio-tree-empty");
	const toggle = document.getElementById("studio-toggle");
	const tablist = document.getElementById("studio-tabs");
	const panel = document.getElementById("studio-panel");
	const host = document.getElementById("studio-editor");
	const empty = document.getElementById("studio-empty");
	const pathLabel = document.getElementById("studio-path");
	const languageLabel = document.getElementById("studio-language");
	const saveGroup = document.getElementById("studio-save-group");
	const saveButton = document.getElementById("studio-save");
	const saveStatus = document.getElementById("studio-save-status");
	const message = document.getElementById("studio-message");
	const menu = document.getElementById("studio-context");
	const menuItems = [...menu.querySelectorAll("button")];
	const narrow = matchMedia("(max-width: 42rem)");
	const touch = matchMedia("(pointer: coarse)");

	let openFiles = new Map();
	const fileRows = new Map();
	const expanded = new Set();
	const busyPaths = new Set();
	let active;
	let selectedPath;
	let contextRow;
	let openRequest = 0;
	let refreshRequest = 0;
	let nextTabId = 0;
	let listedPaths;
	let vfs;
	let editor;
	let emptySession;

	function showMessage(text = "", error = false) {
		message.textContent = text;
		message.hidden = !text;
		message.toggleAttribute("data-error", error);
	}

	function icon(name) {
		const image = document.createElement("img");
		image.src = `icons/${name}.svg`;
		image.alt = "";
		return image;
	}

	function selectFile(path) {
		fileRows.get(selectedPath)?.removeAttribute("data-selected");
		selectedPath = path;
		fileRows.get(path)?.setAttribute("data-selected", "");
	}

	function renderTree(node, list) {
		for (const entry of sortedVfsChildren(node)) {
			const item = document.createElement("li");
			const label = document.createElement("span");
			label.textContent = entry.name;

			if (entry.type === "folder") {
				const folder = document.createElement("details");
				const summary = document.createElement("summary");
				const children = document.createElement("ul");
				folder.dataset.path = entry.path;
				folder.open = expanded.has(entry.path);
				summary.title = entry.name;
				summary.append(icon("place-folder"), label);
				folder.append(summary, children);
				renderTree(entry, children);
				item.append(folder);
				const play = createVfsPreviewLink(entry);
				if (play) item.append(play);
			} else {
				const row = document.createElement("div");
				row.dataset.studioFile = entry.path;
				fileRows.set(entry.path, row);
				const name = document.createElement("button");
				name.type = "button";
				name.className = "studio-filename";
				name.title = entry.path;
				name.append(icon("mime-text-x-generic"), label);
				const actions = document.createElement("button");
				actions.type = "button";
				actions.className = "studio-file-actions";
				actions.setAttribute("aria-label", `Actions for ${entry.name}`);
				actions.setAttribute("aria-haspopup", "menu");
				actions.textContent = "⋯";
				row.append(name, actions);
				item.append(row);
			}
			list.append(item);
		}
	}

	async function refreshTree() {
		const request = ++refreshRequest;
		try {
			const paths = await vfs.ls("/");
			if (request !== refreshRequest) return;
			const snapshot = JSON.stringify(paths);
			if (listedPaths === snapshot) return;
			listedPaths = snapshot;
			hideMenu();
			fileRows.clear();
			tree.replaceChildren();
			treeEmpty.textContent = "Open VFS to add files.";
			treeEmpty.hidden = paths.length > 0;
			renderTree(buildVfsTree(paths), tree);
			selectFile(selectedPath);
		} catch {
			if (request === refreshRequest) showMessage("Unable to read the VFS file list.", true);
		}
	}

	function showExplorer(open) {
		studio.dataset.explorerOpen = String(open);
		toggle.setAttribute("aria-expanded", String(open));
	}

	function updateSaveStatus() {
		saveGroup.hidden = !active;
		if (!active) return;
		const state = active.saving ? "saving" : active.error ? "error" : active.dirty ? "dirty" : "saved";
		saveStatus.dataset.state = state;
		saveStatus.textContent = { saving: "Saving…", error: "Save failed", dirty: "Unsaved", saved: "Saved" }[state];
		saveButton.disabled = active.saving || busyPaths.has(active.path);
	}

	function updateFilebar(file) {
		pathLabel.textContent = file.path;
		pathLabel.title = file.path;
		languageLabel.textContent = file.language;
	}

	function activate(file, focus = false) {
		if (active) {
			active.tab.removeAttribute("data-active");
			active.label.setAttribute("aria-selected", "false");
			active.label.tabIndex = -1;
		}
		active = file;
		panel.hidden = !file;
		empty.hidden = Boolean(file);
		updateSaveStatus();
		showMessage(file?.error, Boolean(file?.error));
		if (!file) {
			editor.setSession(emptySession);
			panel.removeAttribute("aria-labelledby");
			return;
		}

		file.tab.setAttribute("data-active", "");
		file.label.setAttribute("aria-selected", "true");
		file.label.tabIndex = 0;
		file.tab.scrollIntoView({ block: "nearest", inline: "nearest" });
		panel.setAttribute("aria-labelledby", file.label.id);
		updateFilebar(file);
		selectFile(file.path);
		editor.setSession(file.session);
		editor.resize(true);
		if (focus) {
			if (narrow.matches) showExplorer(false);
			editor.focus();
		}
	}

	function updateDirty(file) {
		file.dirty = file.session.getValue() !== file.savedValue;
		file.tab.toggleAttribute("data-dirty", file.dirty);
		if (active === file) updateSaveStatus();
	}

	function createTab(path, source) {
		const { session, language } = createVfsAceSession(path, source);
		const name = vfs.baseName(path);
		const tab = document.createElement("div");
		tab.className = "studio-tab";
		tab.setAttribute("role", "presentation");
		const label = document.createElement("button");
		label.type = "button";
		label.id = `studio-tab-${++nextTabId}`;
		label.className = "studio-tab-label";
		label.title = path;
		label.setAttribute("role", "tab");
		label.setAttribute("aria-controls", panel.id);
		label.setAttribute("aria-selected", "false");
		label.tabIndex = -1;
		const title = document.createElement("span");
		title.textContent = name;
		label.append(title);
		const close = document.createElement("button");
		close.type = "button";
		close.className = "studio-tab-close";
		close.setAttribute("aria-label", `Close ${name}`);
		close.title = "Close tab";
		close.textContent = "×";
		tab.append(label, close);
		tablist.append(tab);
		const file = { path, name, session, language, source, savedValue: session.getValue(), tab, label, title, close };
		openFiles.set(path, file);
		session.on("change", () => updateDirty(file));
		label.addEventListener("click", () => activate(file, true));
		close.addEventListener("click", () => closeTab(file));
		return file;
	}

	async function openFile(path) {
		if (busyPaths.has(path)) return;
		const request = ++openRequest;
		const existing = openFiles.get(path);
		if (existing) {
			activate(existing, true);
			return;
		}

		try {
			const source = await vfs.getasync(path);
			if (busyPaths.has(path) || !fileRows.has(path)) return;
			if (typeof source !== "string") {
				if (request === openRequest) showMessage("Use Download in the file menu to open this binary file.");
				return;
			}
			const file = openFiles.get(path) || createTab(path, source);
			if (!active || request === openRequest) activate(file, request === openRequest);
		} catch {
			if (request === openRequest) showMessage("Unable to open the file.", true);
		}
	}

	function removeTab(file) {
		const files = [...openFiles.values()];
		const index = files.indexOf(file);
		if (index === -1) return;
		openFiles.delete(file.path);
		if (active === file) activate(files[index + 1] || files[index - 1], true);
		file.tab.remove();
		file.session.destroy();
	}

	function closeTab(file) {
		if (file.saving || busyPaths.has(file.path)) return;
		if (file.dirty && !window.confirm(`Close ${file.name} and discard its unsaved changes?`)) return;
		removeTab(file);
	}

	async function saveFile(file) {
		if (!file?.dirty || file.saving || busyPaths.has(file.path)) return;
		const value = file.session.getValue();
		file.saving = true;
		file.close.disabled = true;
		if (active === file) {
			showMessage();
			updateSaveStatus();
		}
		try {
			await vfs.put(file.path, value, { expectedValue: file.source });
			file.source = value;
			file.savedValue = value;
			file.error = "";
		} catch (error) {
			file.error = error?.message || "Unable to save the file.";
		} finally {
			file.saving = false;
			file.close.disabled = false;
			updateDirty(file);
			if (active === file) showMessage(file.error, Boolean(file.error));
		}
	}

	function showMenu(row, x, y) {
		if (busyPaths.has(row.dataset.studioFile)) return;
		contextRow = row;
		selectFile(row.dataset.studioFile);
		menu.hidden = false;
		menu.style.left = `${Math.max(4, Math.min(x, innerWidth - menu.offsetWidth - 4))}px`;
		menu.style.top = `${Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 4))}px`;
		menuItems[0].focus();
	}

	function menuForRow(row) {
		const rect = row.getBoundingClientRect();
		showMenu(row, rect.left + 12, rect.bottom);
	}

	function hideMenu(restoreFocus = false) {
		if (menu.hidden) return;
		const row = contextRow;
		menu.hidden = true;
		contextRow = undefined;
		if (restoreFocus) row.querySelector(".studio-filename").focus();
	}

	async function renameFile(path) {
		const file = openFiles.get(path);
		if (file?.saving || busyPaths.has(path)) return;
		const current = vfs.baseName(path);
		const name = window.prompt("Rename file", current);
		if (name === null || name === current) return;
		if (!name.trim() || name === "." || name === ".." || /[/\\\x00-\x1f\x7f]/.test(name)) {
			showMessage("Enter a valid file name without a path.", true);
			return;
		}
		const target = vfs.parentDir(path) + name;
		if (openFiles.has(target) || busyPaths.has(target)) {
			showMessage(`The name ${name} is already in use.`, true);
			return;
		}

		busyPaths.add(path);
		busyPaths.add(target);
		if (file) file.close.disabled = true;
		updateSaveStatus();
		try {
			await vfs.fileSystem.mv(path, target, { overwrite: false });
			if (file) {
				// Keep the map order aligned with the visible tab order.
				openFiles = new Map([...openFiles].map(([key, entry]) => [entry === file ? target : key, entry]));
				file.path = target;
				file.name = name;
				file.title.textContent = name;
				file.label.title = target;
				file.close.setAttribute("aria-label", `Close ${name}`);
				file.language = setVfsAceMode(file.session, target);
				if (active === file) updateFilebar(file);
			}
			if (selectedPath === path) selectFile(target);
			const restoreFocus = fileRows.get(path)?.contains(document.activeElement);
			showMessage(active?.error, Boolean(active?.error));
			await refreshTree();
			if (restoreFocus && document.activeElement === document.body) {
				fileRows.get(target)?.querySelector(".studio-filename").focus();
			}
		} catch (error) {
			const collision = error?.code === "EEXIST" || error?.code === "EISDIR";
			showMessage(collision ? `An entry named ${name} already exists.` : error?.message || "Unable to rename the file.", true);
		} finally {
			busyPaths.delete(path);
			busyPaths.delete(target);
			if (file) file.close.disabled = false;
			updateSaveStatus();
		}
	}

	async function deleteFile(path) {
		const file = openFiles.get(path);
		if (file?.saving || busyPaths.has(path)) return;
		const name = vfs.baseName(path);
		const question = file?.dirty ? `Delete ${name} and discard its unsaved changes?` : `Delete ${name} from the VFS?`;
		if (!window.confirm(question)) return;
		busyPaths.add(path);
		updateSaveStatus();
		try {
			await vfs.deleteTree(path);
			if (file) removeTab(file);
			if (selectedPath === path) selectFile(undefined);
			await refreshTree();
		} catch (error) {
			showMessage(error?.message || "Unable to delete the file.", true);
		} finally {
			busyPaths.delete(path);
			updateSaveStatus();
		}
	}

	try {
		vfs = await window.vfsReady;
		editor = createVfsAceEditor(host);
		emptySession = editor.session;
		editor.textInput.getElement().setAttribute("aria-label", "Code editor");
		new ResizeObserver(() => {
			if (active) editor.resize();
		}).observe(host);
	} catch {
		treeEmpty.textContent = "Unable to start Code Studio.";
		return;
	}

	toggle.addEventListener("click", () => showExplorer(studio.dataset.explorerOpen !== "true"));
	tree.addEventListener("toggle", (event) => {
		const folder = event.target;
		if (folder.open) expanded.add(folder.dataset.path);
		else expanded.delete(folder.dataset.path);
	}, true);
	tree.addEventListener("click", (event) => {
		const row = event.target.closest("[data-studio-file]");
		if (!row) return;
		const path = row.dataset.studioFile;
		selectFile(path);
		if (event.target.closest(".studio-file-actions")) menuForRow(row);
		else if (event.detail === 0 || touch.matches) openFile(path);
	});
	tree.addEventListener("dblclick", (event) => {
		const name = event.target.closest(".studio-filename");
		if (name) openFile(name.parentElement.dataset.studioFile);
	});
	tree.addEventListener("contextmenu", (event) => {
		const row = event.target.closest("[data-studio-file]");
		if (!row) return;
		event.preventDefault();
		showMenu(row, event.clientX, event.clientY);
	});
	tree.addEventListener("keydown", (event) => {
		if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
		const row = event.target.closest("[data-studio-file]");
		if (!row) return;
		event.preventDefault();
		menuForRow(row);
	});
	menu.addEventListener("keydown", (event) => {
		if (event.key === "Escape" || event.key === "Tab") {
			event.preventDefault();
			hideMenu(true);
		} else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
			event.preventDefault();
			const index = menuItems.indexOf(document.activeElement);
			const step = event.key === "ArrowUp" ? -1 : 1;
			menuItems[(index + step + menuItems.length) % menuItems.length].focus();
		}
	});
	menu.addEventListener("click", async (event) => {
		const action = event.target.closest("[data-command]")?.dataset.command;
		if (!action || !contextRow) return;
		const path = contextRow.dataset.studioFile;
		hideMenu(true);
		if (action === "delete") {
			await deleteFile(path);
		} else if (action === "rename") {
			await renameFile(path);
		} else {
			try {
				await downloadVfsFile(vfs, path);
			} catch (error) {
				showMessage(error?.message || "Unable to download the file.", true);
			}
		}
	});
	document.addEventListener("pointerdown", (event) => {
		if (!menu.contains(event.target)) hideMenu();
	});
	window.addEventListener("resize", () => hideMenu());
	document.getElementById("studio-tree-scroll").addEventListener("scroll", () => hideMenu());
	saveButton.addEventListener("click", () => saveFile(active));
	document.addEventListener("keydown", (event) => {
		if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
			event.preventDefault();
			event.stopPropagation();
			saveFile(active);
		}
	}, true);
	tablist.addEventListener("keydown", (event) => {
		if (!event.target.matches('[role="tab"]')) return;
		const files = [...openFiles.values()];
		const index = files.findIndex(file => file.label === event.target);
		const destination = {
			ArrowLeft: (index - 1 + files.length) % files.length,
			ArrowRight: (index + 1) % files.length,
			Home: 0,
			End: files.length - 1
		}[event.key];
		if (destination !== undefined) {
			event.preventDefault();
			activate(files[destination]);
			files[destination].label.focus();
		} else if (event.key === "Delete") {
			event.preventDefault();
			closeTab(files[index]);
		}
	});
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) refreshTree();
	});
	window.addEventListener("pageshow", () => refreshTree());
	window.addEventListener("beforeunload", (event) => {
		if ([...openFiles.values()].some(file => file.dirty)) {
			event.preventDefault();
			event.returnValue = true;
		}
	});
	await refreshTree();
})();
