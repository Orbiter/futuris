(function () {
	const finderList = document.getElementById("finder-list");
	const finderEmpty = document.getElementById("finder-empty");
	const createFolderButton = document.getElementById("finder-create-folder");
	const uploadButton = document.getElementById("finder-upload-button");
	const uploadInput = document.getElementById("finder-upload-input");
	const previewTitle = document.getElementById("finder-preview-title");
	const previewBody = document.getElementById("finder-preview-body");
	const editorOverlay = document.getElementById("vfs-editor");
	const editorTitle = document.getElementById("vfs-editor-title");
	const editorPathLabel = document.getElementById("vfs-editor-path");
	const editorInput = document.getElementById("vfs-editor-input");
	const editorDiscard = document.getElementById("vfs-editor-discard");
	const editorSave = document.getElementById("vfs-editor-save");
	const expandedPaths = new Set(["/"]);
	let selectedPath = null;
	let activeDropTarget = null;
	let editorPath = null;

	if (
		!finderList ||
		!uploadInput ||
		!uploadButton ||
		!createFolderButton ||
		!previewTitle ||
		!previewBody ||
		!editorOverlay ||
		!editorTitle ||
		!editorPathLabel ||
		!editorInput ||
		!editorDiscard ||
		!editorSave
	) {
		return;
	}

	const seedEntries = [
		{ path: "/Projects/", value: "" },
		{ path: "/Projects/brief.txt", value: "Futuris VFS sample file." },
		{ path: "/Design/", value: "" },
		{ path: "/Design/notes.md", value: "Palette notes and layout ideas." },
		{ path: "/Readme.md", value: "Welcome to the Futuris VFS root." }
	];

	const refreshDelay = (fn) => {
		setTimeout(fn, 120);
	};

	const escapeHtml = (value) =>
		String(value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");

	const renderHighlighted = (text, languageHint) => {
		if (window.hljs && typeof window.hljs.highlight === "function") {
			try {
				if (languageHint) {
					return window.hljs.highlight(text, { language: languageHint }).value;
				}
				return window.hljs.highlightAuto(text).value;
			} catch (error) {
				return escapeHtml(text);
			}
		}
		return escapeHtml(text);
	};

	const readFileAsText = (file) =>
		new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result || "");
			reader.onerror = () => reject(reader.error || new Error("Upload failed"));
			reader.readAsText(file);
		});

	const buildTree = (entries) => {
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
	};

	const renderTree = (node, container) => {
		const nodes = Array.from(node.children.values()).sort((a, b) => {
			if (a.type !== b.type) {
				return a.type === "folder" ? -1 : 1;
			}
			return a.name.localeCompare(b.name);
		});

		nodes.forEach((child) => {
			const li = document.createElement("li");
			li.dataset.path = child.path;
			li.dataset.kind = child.type;

			const row = document.createElement("div");
			row.setAttribute("draggable", "true");
			row.dataset.dragPath = child.path;
			if (selectedPath === child.path) {
				row.dataset.selected = "true";
			}

			if (child.type === "folder") {
				const toggle = document.createElement("button");
				toggle.type = "button";
				toggle.dataset.action = "toggle";
				toggle.setAttribute("draggable", "false");
				toggle.textContent = expandedPaths.has(child.path) ? "v" : ">";
				toggle.setAttribute("aria-label", expandedPaths.has(child.path) ? "Collapse folder" : "Expand folder");
				row.appendChild(toggle);
				row.dataset.dropPath = child.path;
			} else {
				const spacer = document.createElement("span");
				spacer.setAttribute("aria-hidden", "true");
				spacer.dataset.role = "toggle-spacer";
				row.appendChild(spacer);
			}

			const icon = document.createElement("img");
			icon.alt = "";
			icon.setAttribute("draggable", "false");
			icon.dataset.icon = child.type;
			icon.src = child.type === "folder" ? "icons/place-folder.svg" : "icons/mime-text-x-generic.svg";
			row.appendChild(icon);

			const name = document.createElement("span");
			name.textContent = child.name;
			name.dataset.role = "name";
			row.appendChild(name);

			const actions = document.createElement("span");
			actions.dataset.role = "actions";

			if (child.type === "file") {
				const edit = document.createElement("button");
				edit.type = "button";
				edit.dataset.action = "edit";
				edit.setAttribute("draggable", "false");
				edit.title = "Edit file";
				const editIcon = document.createElement("img");
				editIcon.alt = "";
				editIcon.setAttribute("draggable", "false");
				editIcon.dataset.icon = "edit";
				editIcon.src = "icons/action-document-open.svg";
				edit.appendChild(editIcon);
				actions.appendChild(edit);

				const download = document.createElement("button");
				download.type = "button";
				download.dataset.action = "download";
				download.setAttribute("draggable", "false");
				download.title = "Download file";
				const downloadIcon = document.createElement("img");
				downloadIcon.alt = "";
				downloadIcon.setAttribute("draggable", "false");
				downloadIcon.dataset.icon = "download";
				downloadIcon.src = "icons/action-document-save-as.svg";
				download.appendChild(downloadIcon);
				actions.appendChild(download);
			}

			const remove = document.createElement("button");
			remove.type = "button";
			remove.dataset.action = "delete";
			remove.setAttribute("draggable", "false");
			remove.title = "Delete";
			const deleteIcon = document.createElement("img");
			deleteIcon.alt = "";
			deleteIcon.setAttribute("draggable", "false");
			deleteIcon.dataset.icon = "delete";
			deleteIcon.src = "icons/action-edit-delete.svg";
			remove.appendChild(deleteIcon);
			actions.appendChild(remove);

			row.appendChild(actions);
			li.appendChild(row);

			if (child.type === "folder" && expandedPaths.has(child.path)) {
				const nestedList = document.createElement("ul");
				nestedList.dataset.dropPath = child.path;
				renderTree(child, nestedList);
				li.appendChild(nestedList);
			}

			container.appendChild(li);
		});
	};

	const refreshView = async () => {
		const vfs = await window.vfsReady;
		const entries = await vfs.ls("/");
		if (entries.length === 0) {
			for (const entry of seedEntries) {
				await vfs.put(entry.path, entry.value);
			}
		}

		const updatedEntries = await vfs.ls("/");
		finderList.innerHTML = "";
		const tree = buildTree(updatedEntries);

		const rootItem = document.createElement("li");
		rootItem.dataset.path = "/";
		rootItem.dataset.kind = "folder";
		const rootRow = document.createElement("div");
		rootRow.dataset.dropPath = "/";
		rootRow.dataset.root = "true";

		const rootToggle = document.createElement("button");
		rootToggle.type = "button";
		rootToggle.dataset.action = "toggle";
		rootToggle.setAttribute("draggable", "false");
		rootToggle.textContent = expandedPaths.has("/") ? "v" : ">";
		rootToggle.setAttribute("aria-label", expandedPaths.has("/") ? "Collapse folder" : "Expand folder");
		rootRow.appendChild(rootToggle);

		const rootIcon = document.createElement("img");
		rootIcon.alt = "";
		rootIcon.setAttribute("draggable", "false");
		rootIcon.dataset.icon = "folder";
		rootIcon.src = "icons/place-folder.svg";
		rootRow.appendChild(rootIcon);

		const rootName = document.createElement("span");
		rootName.textContent = "/";
		rootName.dataset.role = "name";
		rootRow.appendChild(rootName);

		rootItem.appendChild(rootRow);

		if (expandedPaths.has("/")) {
			const nestedList = document.createElement("ul");
			nestedList.dataset.dropPath = "/";
			renderTree(tree, nestedList);
			rootItem.appendChild(nestedList);
		}

		finderList.appendChild(rootItem);
		finderEmpty.style.display = updatedEntries.length ? "none" : "block";
	};

	const refreshSoon = () => {
		refreshDelay(refreshView);
	};

	const showPreviewPlaceholder = (message) => {
		previewTitle.textContent = "Preview";
		previewBody.innerHTML = `<p>${escapeHtml(message)}</p>`;
	};

	const openEditor = async (path) => {
		if (!path || path.endsWith("/")) return;
		try {
			const vfs = await window.vfsReady;
			const contents = await vfs.getasync(path);
			editorPath = path;
			editorTitle.textContent = "Edit file";
			editorPathLabel.textContent = path;
			editorInput.value = contents;
			editorOverlay.dataset.open = "true";
			editorOverlay.setAttribute("aria-hidden", "false");
			editorInput.focus();
		} catch (error) {
			window.alert("Unable to load file for editing.");
		}
	};

	const closeEditor = () => {
		editorPath = null;
		editorOverlay.removeAttribute("data-open");
		editorOverlay.setAttribute("aria-hidden", "true");
		editorInput.value = "";
	};

	const extensionToLanguage = (name) => {
		const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
		if (!match) return null;
		const ext = match[1];
		const map = {
			js: "javascript",
			mjs: "javascript",
			cjs: "javascript",
			ts: "typescript",
			jsx: "javascript",
			tsx: "typescript",
			json: "json",
			md: "markdown",
			txt: "plaintext",
			html: "xml",
			htm: "xml",
			css: "css",
			yml: "yaml",
			yaml: "yaml",
			sh: "bash",
			bash: "bash",
			py: "python",
			rs: "rust",
			go: "go",
			java: "java",
			c: "c",
			h: "c",
			cpp: "cpp",
			hpp: "cpp"
		};
		return map[ext] || null;
	};

	const updatePreview = async (path) => {
		if (!path) {
			showPreviewPlaceholder("Select a file to preview.");
			return;
		}

		const fileName = path.split("/").pop() || "";
		const languageHint = extensionToLanguage(fileName);

		try {
			const vfs = await window.vfsReady;
			const contents = await vfs.getasync(path);
			previewTitle.textContent = fileName;
			const highlighted = renderHighlighted(contents, languageHint);
			const languageClass = languageHint ? ` language-${languageHint}` : "";
			previewBody.innerHTML = `<pre><code class="hljs${languageClass}">${highlighted}</code></pre>`;
		} catch (error) {
			showPreviewPlaceholder("Unable to load file preview.");
		}
	};

	const getFolderName = (path) => {
		const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
		const parts = trimmed.split("/").filter(Boolean);
		return parts[parts.length - 1] || "";
	};

	const moveEntry = async (srcPath, destDir) => {
		if (!destDir.endsWith("/")) {
			destDir += "/";
		}
		if (srcPath === destDir) return;

		const isFolder = srcPath.endsWith("/");
		const name = getFolderName(srcPath);
		const destPath = `${destDir}${name}${isFolder ? "/" : ""}`;

		if (!name || destPath === srcPath) return;
		if (isFolder && destDir.startsWith(srcPath)) {
			window.alert("Cannot move a folder into itself.");
			return;
		}

		const vfs = await window.vfsReady;
		if (destDir !== "/") {
			await vfs.put(destDir, "");
		}

		if (isFolder) {
			const contents = await vfs.ls(srcPath);
			for (const entry of contents) {
				await vfs.mv(`${srcPath}${entry}`, `${destPath}${entry}`);
			}
		}

		await vfs.mv(srcPath, destPath);

		if (expandedPaths.has(srcPath)) {
			expandedPaths.delete(srcPath);
			expandedPaths.add(destPath);
		}
		if (selectedPath === srcPath) {
			selectedPath = destPath;
		}
	};

	createFolderButton.addEventListener("click", async () => {
		const name = window.prompt("Folder name");
		if (!name) return;
		const trimmed = name.trim().replace(/^\/+|\/+$/g, "");
		if (!trimmed || trimmed.includes("/")) {
			window.alert("Folder name must be a single segment.");
			return;
		}
		const vfs = await window.vfsReady;
		await vfs.put(`/${trimmed}/`, "");
		expandedPaths.add(`/${trimmed}/`);
		refreshSoon();
	});

	uploadButton.addEventListener("click", () => {
		uploadInput.click();
	});

	uploadInput.addEventListener("change", async (event) => {
		const files = Array.from(event.target.files || []);
		if (!files.length) return;
		const vfs = await window.vfsReady;
		for (const file of files) {
			const contents = await readFileAsText(file);
			await vfs.put(`/${file.name}`, contents);
		}
		uploadInput.value = "";
		refreshSoon();
	});

	finderList.addEventListener("click", async (event) => {
		const button = event.target.closest("button[data-action]");
		if (!button) return;
		const item = button.closest("li");
		if (!item) return;
		const path = item.dataset.path;
		const action = button.dataset.action;
		const vfs = await window.vfsReady;

		if (action === "toggle") {
			if (expandedPaths.has(path)) {
				expandedPaths.delete(path);
			} else {
				expandedPaths.add(path);
			}
			refreshView();
			return;
		}

		if (action === "delete") {
			if (path.endsWith("/")) {
				const contents = await vfs.ls(path);
				contents.forEach((entry) => vfs.rm(`${path}${entry}`));
				vfs.rm(path);
				expandedPaths.delete(path);
				if (selectedPath && selectedPath.startsWith(path)) {
					selectedPath = null;
					showPreviewPlaceholder("Select a file to preview.");
				}
			} else {
				vfs.rm(path);
				if (selectedPath === path) {
					selectedPath = null;
					showPreviewPlaceholder("Select a file to preview.");
				}
			}
			refreshSoon();
			return;
		}

		if (action === "download") {
			try {
				const contents = await vfs.getasync(path);
				const blob = new Blob([contents], { type: "text/plain" });
				const url = URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = url;
				link.download = path.split("/").pop() || "download.txt";
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				URL.revokeObjectURL(url);
			} catch (error) {
				window.alert("Unable to download file.");
			}
			return;
		}

		if (action === "edit") {
			openEditor(path);
		}
	});

	finderList.addEventListener("click", (event) => {
		const button = event.target.closest("button[data-action]");
		if (button) return;
		const row = event.target.closest("li > div");
		if (!row) return;
		const item = row.closest("li");
		if (!item || item.dataset.kind !== "file") return;
		selectedPath = item.dataset.path;
		refreshView();
		updatePreview(selectedPath);
	});

	finderList.addEventListener("dragstart", (event) => {
		const row = event.target.closest("[data-drag-path]");
		if (!row) return;
		if (event.target.closest("[data-role=\"actions\"], button, img, [data-action=\"toggle\"]")) {
			event.preventDefault();
			return;
		}
		event.dataTransfer.setData("text/plain", row.dataset.dragPath);
		event.dataTransfer.effectAllowed = "move";
		row.dataset.dragging = "true";
	});

	finderList.addEventListener("dragend", (event) => {
		const row = event.target.closest("[data-drag-path]");
		if (row) {
			delete row.dataset.dragging;
		}
		if (activeDropTarget) {
			delete activeDropTarget.dataset.dropTarget;
			activeDropTarget = null;
		}
	});

	finderList.addEventListener("dragover", (event) => {
		const target = event.target.closest("[data-drop-path]");
		if (!target) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
		if (activeDropTarget && activeDropTarget !== target) {
			delete activeDropTarget.dataset.dropTarget;
		}
		activeDropTarget = target;
		activeDropTarget.dataset.dropTarget = "true";
	});

	finderList.addEventListener("dragleave", (event) => {
		const target = event.target.closest("[data-drop-path]");
		if (!target || !activeDropTarget) return;
		if (target === activeDropTarget) {
			delete activeDropTarget.dataset.dropTarget;
			activeDropTarget = null;
		}
	});

	finderList.addEventListener("drop", async (event) => {
		const target = event.target.closest("[data-drop-path]");
		if (!target) return;
		event.preventDefault();
		const srcPath = event.dataTransfer.getData("text/plain");
		const destDir = target.dataset.dropPath || "/";
		if (!srcPath || !destDir) return;
		await moveEntry(srcPath, destDir);
		if (activeDropTarget) {
			delete activeDropTarget.dataset.dropTarget;
			activeDropTarget = null;
		}
		refreshSoon();
	});

	editorOverlay.addEventListener("click", (event) => {
		if (event.target === editorOverlay) {
			closeEditor();
		}
	});

	editorDiscard.addEventListener("click", () => {
		closeEditor();
	});

	editorSave.addEventListener("click", async () => {
		if (!editorPath) {
			closeEditor();
			return;
		}
		const vfs = await window.vfsReady;
		await vfs.put(editorPath, editorInput.value);
		const savedPath = editorPath;
		closeEditor();
		if (selectedPath === savedPath) {
			updatePreview(savedPath);
		}
	});

	const clearActiveDrop = () => {
		if (activeDropTarget) {
			delete activeDropTarget.dataset.dropTarget;
			activeDropTarget = null;
		}
	};

	refreshView();
	updatePreview(selectedPath);
})();
