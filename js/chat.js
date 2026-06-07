const chatLog = document.getElementById("chat-log");
const chatScroll = document.getElementById("chat-scroll");
const chatLatest = document.getElementById("chat-latest");
const chatEmpty = document.getElementById("chat-empty");
const chatSetup = document.getElementById("chat-setup");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatStatus = document.getElementById("chat-status");
const chatStorage = document.getElementById("chat-storage");
const chatSend = document.getElementById("chat-send");
const chatStop = document.getElementById("chat-stop");
const chatNew = document.getElementById("chat-new");

const llm = createLLM();
const markdown = window.markdownit({ html: false }).disable("image");
const toolingGuidance =
	"Tooling policy: use vfs_apply_diff for edits to existing files. " +
	"Use vfs_write_file only to create new files or when explicitly asked to overwrite completely.";

let currentConfig;
let turns = [];
let generation;
let following = true;
let checkpoint;

function followLatest() {
	if (following) chatScroll.scrollTop = chatScroll.scrollHeight;
	chatLatest.hidden = following || !turns.length;
}

function jumpToLatest() {
	following = true;
	followLatest();
}

chatScroll.addEventListener("scroll", () => {
	following = chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight < 40;
	chatLatest.hidden = following || !turns.length;
}, { passive: true });
chatLatest.addEventListener("click", () => {
	jumpToLatest();
	chatScroll.focus({ preventScroll: true });
});
new ResizeObserver(followLatest).observe(chatScroll);

function sizeViewport() {
	const viewport = window.visualViewport;
	if (viewport?.scale === 1) {
		document.body.style.setProperty("--chat-viewport-height", `${viewport.height}px`);
	} else {
		document.body.style.removeProperty("--chat-viewport-height");
	}
}
window.visualViewport?.addEventListener("resize", sizeViewport);
sizeViewport();

function setStatus(message, isError = false) {
	chatStatus.textContent = message;
	chatStatus.toggleAttribute("data-error", isError);
}

function updateControls() {
	chatEmpty.hidden = turns.length > 0;
	chatInput.disabled = !currentConfig?.model;
	chatSend.disabled = chatInput.disabled || !chatInput.value.trim();
	chatSend.hidden = Boolean(generation);
	chatStop.hidden = !generation;
	chatStop.disabled = generation?.signal.aborted ?? false;
	chatNew.disabled = Boolean(generation) || !turns.length;
}

function resizeComposer() {
	chatInput.style.height = "auto";
	chatInput.style.height = `${chatInput.scrollHeight}px`;
	updateControls();
}
chatInput.addEventListener("input", resizeComposer);
chatInput.addEventListener("keydown", (event) => {
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !generation) {
		event.preventDefault();
		if (!chatSend.disabled) chatForm.requestSubmit();
	}
});

function historyKey() {
	return `futuris.chat.v1:${currentConfig.apihost}`;
}

function showStorageNote(message) {
	chatStorage.textContent = message;
	chatStorage.hidden = !message;
}

function persistHistory() {
	clearTimeout(checkpoint);
	checkpoint = undefined;
	try {
		localStorage.setItem(historyKey(), JSON.stringify(turns));
		showStorageNote("");
	} catch {
		showStorageNote("This browser could not save the conversation.");
	}
}

function checkpointHistory() {
	if (checkpoint === undefined) checkpoint = setTimeout(persistHistory, 800);
}

function settleDraft(turn) {
	if (turn.draft) turn.messages.push({ role: "assistant", content: turn.draft });
	turn.draft = "";
}

function restoreHistory() {
	showStorageNote("");
	try {
		const saved = JSON.parse(localStorage.getItem(historyKey()) || "[]");
		if (!Array.isArray(saved) || saved.some((turn) => typeof turn?.prompt !== "string" || !Array.isArray(turn.messages))) {
			throw new Error("Invalid saved conversation.");
		}
		return saved.map((turn) => {
			if (turn.state === "streaming") {
				settleDraft(turn);
				turn.state = "stopped";
				turn.note = "Generation interrupted.";
			}
			return turn;
		});
	} catch {
		showStorageNote("This browser could not restore the conversation.");
		return [];
	}
}

function appendRound(replies) {
	const round = document.createElement("div");
	round.className = "chat-round";
	replies.appendChild(round);
	return round;
}

function renderDraft(round, text) {
	const parsed = document.createElement("template");
	parsed.innerHTML = markdown.render(text);
	const blocks = Array.from(parsed.content.childNodes);
	let firstChange = 0;
	while (round.childNodes[firstChange]?.isEqualNode(blocks[firstChange])) firstChange += 1;
	while (round.childNodes.length > firstChange) round.lastChild.remove();
	round.append(...blocks.slice(firstChange));
}

function appendToolResult(replies, call, message) {
	const details = document.createElement("details");
	details.className = "chat-tool";
	const summary = document.createElement("summary");
	const name = call?.function?.name;
	const label = name?.replace(/^vfs_/, "").replaceAll("_", " ");
	summary.textContent = name?.startsWith("vfs_") ? `VFS · ${label}` : label || "Tool result";
	const result = document.createElement("pre");
	result.textContent = message.content;
	details.append(summary, result);
	replies.appendChild(details);
}

function appendTurn(turn) {
	const article = document.createElement("article");
	article.className = "chat-turn";
	const user = document.createElement("div");
	user.className = "chat-user";
	user.setAttribute("role", "group");
	user.setAttribute("aria-label", "You");
	user.textContent = turn.prompt;

	const assistant = document.createElement("div");
	assistant.className = "chat-assistant";
	assistant.setAttribute("role", "group");
	assistant.setAttribute("aria-label", "Assistant");
	const avatar = document.createElement("span");
	avatar.className = "chat-avatar";
	avatar.setAttribute("aria-hidden", "true");
	const reply = document.createElement("div");
	reply.className = "chat-reply";
	const replies = document.createElement("div");
	const note = document.createElement("p");
	note.className = "chat-note";
	note.textContent = turn.note || "";
	note.toggleAttribute("data-error", turn.state === "error");

	const toolCalls = new Map();
	for (const message of turn.messages) {
		if (message.role === "assistant") {
			if (message.content) appendRound(replies).innerHTML = markdown.render(message.content);
			for (const call of message.tool_calls || []) toolCalls.set(call.id, call);
		} else if (message.role === "tool") {
			appendToolResult(replies, toolCalls.get(message.tool_call_id), message);
		}
	}

	reply.append(replies, note);
	assistant.append(avatar, reply);
	article.append(user, assistant);
	chatLog.appendChild(article);
	return { replies, note };
}

function showReadyStatus() {
	setStatus(currentConfig?.model ? "Ready" : "Choose a model");
}

async function loadChatConfig() {
	try {
		const config = await readLLMConfig();
		const hostChanged = currentConfig?.apihost !== config.apihost;
		currentConfig = config;
		chatSetup.hidden = Boolean(config.model);
		if (hostChanged) {
			turns = restoreHistory();
			chatLog.replaceChildren();
			for (const turn of turns) appendTurn(turn);
			jumpToLatest();
		}
		showReadyStatus();
	} catch (error) {
		currentConfig = undefined;
		setStatus(error?.message || "Could not load the chat configuration.", true);
		chatSetup.hidden = false;
	}
	updateControls();
}

function buildContext(config, turn) {
	const system = config.systemprompt ? `${config.systemprompt}\n\n${toolingGuidance}` : toolingGuidance;
	const messages = [{ role: "system", content: system }];
	for (const item of turns) {
		if (item === turn || item.messages.length) {
			messages.push({ role: "user", content: item.prompt }, ...item.messages);
		}
	}
	return messages;
}

async function generateReply(turn, view, config, signal) {
	const context = buildContext(config, turn);
	let round;
	let renderFrame = 0;

	const paintDraft = () => {
		cancelAnimationFrame(renderFrame);
		renderFrame = 0;
		if (round) renderDraft(round, turn.draft);
		followLatest();
	};

	try {
		for (let attempt = 0; attempt < 6; attempt += 1) {
			signal.throwIfAborted();
			round = appendRound(view.replies);
			view.note.textContent = config.thinking === false ? "Waiting for reply…" : "Thinking…";
			setStatus("Generating…");
			followLatest();
			const { message, finishReason } = await llm.streamChat({
				baseUrl: config.apihost,
				model: config.model,
				thinking: config.thinking,
				tools: llm.listTools(),
				messages: context,
				signal,
				onToken(token) {
					turn.draft += token;
					view.note.textContent = "";
					if (!renderFrame) renderFrame = requestAnimationFrame(paintDraft);
					checkpointHistory();
				}
			});
			paintDraft();
			signal.throwIfAborted();

			if (!message.tool_calls?.length) {
				if (!message.content) throw new Error("The model returned an empty response.");
				turn.messages.push(message);
				turn.draft = "";
				turn.state = "complete";
				turn.note = finishReason === "length" ? "Response reached the model’s output limit." : "";
				return;
			}

			if (!message.content) round.remove();
			round = null;
			setStatus("Running tools…");
			view.note.textContent = "Running tools…";
			followLatest();

			// Only keep a tool-call message when all of its tool results are available.
			const results = [];
			for (const call of message.tool_calls) {
				signal.throwIfAborted();
				const output = await llm.runTool(call);
				results.push({
					role: "tool",
					tool_call_id: call.id,
					content: typeof output === "string" ? output : JSON.stringify(output) ?? ""
				});
			}
			turn.messages.push(message, ...results);
			context.push(message, ...results);
			turn.draft = "";
			results.forEach((result, index) => appendToolResult(view.replies, message.tool_calls[index], result));
			persistHistory();
		}
		throw new Error("The tool-call limit was reached.");
	} catch (error) {
		paintDraft();
		if (!turn.draft) round?.remove();
		settleDraft(turn);
		turn.state = signal.aborted ? "stopped" : "error";
		turn.note = signal.aborted ? signal.reason.message : error?.message || "The request failed.";
	} finally {
		view.note.textContent = turn.note;
		view.note.toggleAttribute("data-error", turn.state === "error");
		persistHistory();
		followLatest();
	}
}

chatForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const prompt = chatInput.value.trim();
	if (!currentConfig?.model || !prompt || generation) return;

	const turn = { prompt, messages: [], draft: "", state: "streaming", note: "" };
	turns.push(turn);
	const view = appendTurn(turn);
	generation = new AbortController();
	chatInput.value = "";
	resizeComposer();
	if (matchMedia("(pointer: fine)").matches) chatInput.focus({ preventScroll: true });
	jumpToLatest();
	persistHistory();

	try {
		await generateReply(turn, view, currentConfig, generation.signal);
	} finally {
		generation = undefined;
		updateControls();
		if (turn.state === "error") {
			setStatus("Request failed", true);
		} else if (turn.state === "stopped") {
			setStatus("Stopped");
		} else {
			showReadyStatus();
		}
	}
});

chatStop.addEventListener("click", () => {
	generation?.abort(new DOMException("Generation stopped.", "AbortError"));
	updateControls();
});

chatNew.addEventListener("click", () => {
	if (generation || !window.confirm("Start a new chat and clear this conversation?")) return;
	turns = [];
	chatLog.replaceChildren();
	chatInput.value = "";
	resizeComposer();
	persistHistory();
	jumpToLatest();
	showReadyStatus();
});

window.addEventListener("pagehide", () => {
	if (generation) {
		persistHistory();
		generation.abort(new DOMException("Generation interrupted.", "AbortError"));
	}
});
window.addEventListener("pageshow", (event) => {
	if (event.persisted && !generation) loadChatConfig();
});

loadChatConfig();
