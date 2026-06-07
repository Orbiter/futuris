const vfsZip = (() => {
	function entryParts(filename, directory) {
		const path = filename.replaceAll("\\", "/");
		const parts = path.replace(/\/$/, "").split("/").filter((part) => part !== ".");
		if ((!directory && !parts.length) || /^[a-z]:/i.test(parts[0] || "") ||
			parts.some((part) => !part || part === ".." || /[\x00-\x1f\x7f]/.test(part))) {
			throw new Error(`Invalid ZIP path: ${filename}`);
		}
		return parts;
	}

	async function importFolder(vfs, file) {
		const stem = file.name.replace(/\.zip$/i, "").trim();
		const name = !stem || stem === "." || stem === ".." || /[/\\\x00-\x1f\x7f]/.test(stem) || /^[a-z]:/i.test(stem)
			? "Archive"
			: stem;
		const reader = new zip.ZipReader(new zip.BlobReader(file), { useWebWorkers: false, checkCrc32: true });
		const entries = [];
		try {
			const archive = (await reader.getEntries()).map((entry) => ({
				entry,
				parts: entryParts(entry.filename, entry.directory)
			})).filter(({ parts }) => parts.length);
			// Exports include the folder itself. Avoid nesting it twice on reimport.
			const stripRoot = archive.every(({ entry, parts }) => parts[0] === name && (parts.length > 1 || entry.directory));
			const paths = new Map();
			for (const { entry, parts } of archive) {
				const relative = stripRoot ? parts.slice(1) : parts;
				let path = "";
				for (const [index, part] of relative.entries()) {
					path += index === 0 ? part : `/${part}`;
					const isDirectory = index < relative.length - 1 || entry.directory;
					if (paths.has(path) && (!isDirectory || paths.get(path))) {
						throw new Error(`Conflicting ZIP entries: ${path}`);
					}
					paths.set(path, isDirectory ? null : entry);
				}
			}

			for (const [path, entry] of paths) {
				if (entry) {
					const bytes = await entry.getData(new zip.Uint8ArrayWriter());
					entries.push({ path, value: vfs.fileSystem.fileValue(bytes) });
				} else {
					entries.push({ path: `${path}/`, value: "" });
				}
			}
		} finally {
			await reader.close();
		}
		return vfs.addFolderTree(name, entries);
	}

	async function exportFolder(vfs, path) {
		const name = vfs.baseName(path) || "VFS";
		const entries = await vfs.readFolderTree(path);
		const writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"), { useWebWorkers: false });
		await writer.add(`${name}/`, undefined, { directory: true });
		for (const entry of entries) {
			const filename = `${name}/${entry.path}`;
			if (entry.path.endsWith("/")) {
				await writer.add(filename, undefined, { directory: true });
			} else {
				await writer.add(filename, new zip.BlobReader(new Blob([entry.value])));
			}
		}
		return { name: `${name}.zip`, blob: await writer.close() };
	}

	return { importFolder, exportFolder };
})();
