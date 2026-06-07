"use strict";

function createVfsAceEditor(host) {
	return window.ace.edit(host, {
		theme: { cssClass: "ace-futuris", isDark: true, cssText: "", padding: 12 },
		fontFamily: getComputedStyle(host).getPropertyValue("--font-mono").trim(),
		fontSize: "0.875rem",
		showPrintMargin: false
	});
}

// Keep the syntax modes available when Futuris is opened directly from disk.
const vfsAceModes = new Set([
	"c_cpp", "css", "golang", "html", "java", "javascript", "json", "jsx",
	"markdown", "python", "rust", "sh", "tsx", "typescript", "xml", "yaml"
]);

function setVfsAceMode(session, path) {
	const detected = window.ace.require("ace/ext/modelist").getModeForPath(path);
	const supported = vfsAceModes.has(detected.name);
	session.setMode(supported ? detected.mode : "ace/mode/text");
	return supported ? detected.caption : "Plain text";
}

function createVfsAceSession(path, source) {
	const session = window.ace.createEditSession(source);
	session.setUseWorker(false);
	const language = setVfsAceMode(session, path);
	session.setUseWrapMode(true);
	return { session, language };
}
