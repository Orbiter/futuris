"use strict";

const shellSeparator = /[\t\r\n ;|&()<>]/;

function pathPrefixAtCursor(line, cursor) {
	let start = 0;
	let path = "";
	let quote = "";

	for (let i = 0; i < cursor; i++) {
		const char = line[i];
		if (char === "\\" && quote !== "'") {
			const next = line[i + 1];
			if (i + 1 >= cursor) return null;
			if (!quote || /["\\$`\n]/.test(next)) {
				if (next !== "\n") path += next;
				i++;
				continue;
			}
		}
		if (quote) {
			if (char === quote) quote = "";
			else path += char;
		} else if (char === "'" || char === '"') {
			quote = char;
		} else if (shellSeparator.test(char)) {
			path = "";
			start = i + 1;
		} else if (char === "#" && i === start) {
			const nextLine = line.indexOf("\n", i);
			if (nextLine < 0 || nextLine >= cursor) return null;
			i = nextLine;
			start = i + 1;
		} else {
			path += char;
		}
	}

	// Complete at a word boundary without replacing text already to the right.
	const next = line[cursor];
	if (next && (quote ? next !== quote : !shellSeparator.test(next))) return null;
	return { path, quote, homeRelative: line.startsWith("~/", start) };
}

function quotePathSuffix(suffix, quote) {
	if (quote === "'") return suffix.replaceAll("'", "'\\''");
	if (quote === '"') return suffix.replace(/["\\$`]/g, "\\$&");
	return suffix.replace(/[\s\\'"$`<>|&;(){}\[\]*?!#~=]/g, "\\$&");
}

async function completeVfsPath(fs, cwd, home, line, cursor) {
	const word = pathPrefixAtCursor(line, cursor);
	if (!word) return "";
	const slash = word.path.lastIndexOf("/") + 1;
	const directory = word.path.slice(0, slash);
	const fragment = word.path.slice(slash);
	const target = word.homeRelative && home?.startsWith("/") ? home + directory.slice(1) : directory;
	const parent = fs.resolvePath(cwd, target);
	const names = await fs.readdir(parent);
	const matches = names.filter(name => name.startsWith(fragment) &&
		(fragment.startsWith(".") || !name.startsWith(".")) && !/[\x00-\x1f\x7f-\x9f]/.test(name));
	if (!matches.length) return "";

	if (matches.length === 1) {
		const name = matches[0];
		const entry = await fs.stat(fs.resolvePath(parent, name));
		return quotePathSuffix(name.slice(fragment.length) + (entry.isDirectory ? "/" : ""), word.quote);
	}

	matches.sort();
	const first = matches[0];
	const last = matches.at(-1);
	let end = fragment.length;
	for (const char of first.slice(end)) {
		if (!last.startsWith(char, end)) break;
		end += char.length;
	}
	return quotePathSuffix(first.slice(fragment.length, end), word.quote);
}
