const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatStatus = document.getElementById("chat-status");
const chatModel = document.getElementById("chat-model");
const chatSend = document.getElementById("chat-send");

if (!chatLog || !chatForm || !chatInput || !chatStatus || !chatModel || !chatSend) {
	throw new Error("Missing chat UI elements.");
}

const llm = createLLM();
const CONFIG_PATH = "/config.json";
const DEFAULT_API_HOST = "http://localhost:11434";
const DEFAULT_SYSTEM_PROMPT = "";
const DEFAULT_MODEL = "";
const TOOLING_GUIDANCE =
	"Tooling policy: use vfs_apply_diff for edits to existing files. " +
	"Use vfs_write_file only to create new files or when explicitly asked to overwrite completely.";

let currentConfig = null;
let currentModel = "";
let isStreaming = false;

const setStatus = (message, isError = false) => {
	chatStatus.textContent = message;
	chatStatus.style.color = isError ? "#ff3719" : "";
};

const normalizeConfig = (config) => {
	return {
		apihost:
			typeof config.apihost === "string" && config.apihost.trim()
				? config.apihost.trim()
				: DEFAULT_API_HOST,
		systemprompt:
			typeof config.systemprompt === "string" ? config.systemprompt : DEFAULT_SYSTEM_PROMPT,
		model: typeof config.model === "string" ? config.model : DEFAULT_MODEL
	};
};

const writeConfig = async (config) => {
	const vfs = await window.vfsReady;
	await vfs.put(CONFIG_PATH, JSON.stringify(config, null, 2));
};

const readConfig = async () => {
	const vfs = await window.vfsReady;
	let rawConfig = null;
	try {
		rawConfig = await vfs.getasync(CONFIG_PATH);
	} catch (error) {
		const initialConfig = normalizeConfig({});
		await writeConfig(initialConfig);
		return initialConfig;
	}

	try {
		const parsed = JSON.parse(rawConfig);
		const normalized = normalizeConfig(parsed || {});
		if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
			await writeConfig(normalized);
		}
		return normalized;
	} catch (error) {
		const repaired = normalizeConfig({});
		await writeConfig(repaired);
		return repaired;
	}
};

const setFormState = (enabled) => {
	chatInput.disabled = !enabled;
	chatSend.disabled = !enabled;
};

const setModelDisplay = (model) => {
	chatModel.textContent = model || "No model selected";
	currentModel = model || "";
};

const createMessage = (role, content, labelText) => {
	const wrapper = document.createElement("div");
	wrapper.className = `chat-message chat-message--${role}`;

	const label = document.createElement("span");
	label.className = "chat-role";
	label.textContent =
		labelText || (role === "user" ? "You" : role === "assistant" ? "Assistant" : "Tool");

	const bubble = document.createElement("div");
	bubble.className = "chat-bubble";
	bubble.textContent = content;

	wrapper.appendChild(label);
	wrapper.appendChild(bubble);
	chatLog.appendChild(wrapper);
	chatLog.scrollTop = chatLog.scrollHeight;

	return bubble;
};

const createToolCallMessage = (toolCall) => {
	const name = toolCall && toolCall.function ? toolCall.function.name : "unknown";
	const args = toolCall && toolCall.function ? toolCall.function.arguments : "";
	const content = args ? `${name}\n${args}` : name;
	return createMessage("tool", content, "Tool Call");
};

const createToolResultMessage = (toolCall, result) => {
	const name = toolCall && toolCall.function ? toolCall.function.name : "unknown";
	const content = `[${name} result]\n${result}`;
	return createMessage("tool", content, "Tool Result");
};

const flushUI = () =>
	new Promise((resolve) => {
		requestAnimationFrame(() => resolve());
	});

const loadConfigAndModels = async () => {
	setStatus("Loading configuration...");
	setFormState(false);
	try {
		currentConfig = await readConfig();
		const basePrompt = currentConfig.systemprompt || DEFAULT_SYSTEM_PROMPT;
		const combinedPrompt = basePrompt
			? `${basePrompt}\n\n${TOOLING_GUIDANCE}`
			: TOOLING_GUIDANCE;
		llm.history.setSystemPrompt(combinedPrompt);
		setModelDisplay(currentConfig.model);
		if (!currentConfig.model) {
			setStatus("Select a model in the LLM page to start chatting.", true);
			setFormState(false);
			return;
		}
		setStatus(`Ready on ${currentConfig.apihost}`);
		setFormState(true);
	} catch (error) {
		const message = error && error.message ? error.message : "Unknown error";
		setStatus(`Failed to load chat config: ${message}`, true);
	}
};

chatForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	if (isStreaming) return;
	const message = chatInput.value.trim();
	if (!message) return;
	if (!currentConfig || !currentModel) {
		setStatus("Model not ready yet.", true);
		return;
	}

	createMessage("user", message);
	llm.history.addUser(message);
	chatInput.value = "";
	isStreaming = true;
	setFormState(false);
	setStatus("Thinking...");

	let assistantBubble = null;
	let assistantText = "";
	const ensureAssistantBubble = () => {
		if (!assistantBubble) {
			assistantBubble = createMessage("assistant", "");
		}
	};

	try {
		let loopGuard = 0;
		while (loopGuard < 6) {
			loopGuard += 1;
			const response = await llm.completeChat({
				baseUrl: currentConfig.apihost,
				model: currentModel,
				tools: llm.listTools()
			});

			const choice = response.choices && response.choices[0];
			const message = choice && choice.message ? choice.message : null;
			if (!message) {
				throw new Error("Missing response message.");
			}
			llm.history.addMessage(message);

			if (!message.tool_calls || message.tool_calls.length === 0) {
				if (message.content) {
					assistantText += assistantText ? `\n${message.content}` : message.content;
					ensureAssistantBubble();
					assistantBubble.textContent = assistantText;
					chatLog.scrollTop = chatLog.scrollHeight;
					await flushUI();
				}
				break;
			}

			setStatus("Running tools...");
			for (const toolCall of message.tool_calls) {
				createToolCallMessage(toolCall);
				await flushUI();
				const toolResult = await llm.runTool(toolCall);
				createToolResultMessage(toolCall, toolResult);
				await flushUI();
				llm.history.addMessage({
					role: "tool",
					tool_call_id: toolCall.id,
					content: toolResult
				});
			}
		}

		if (!assistantText) {
			assistantText = "[No response]";
		}
		ensureAssistantBubble();
		assistantBubble.textContent = assistantText;
		setStatus(`Ready on ${currentConfig.apihost}`);
	} catch (error) {
		const message = error && error.message ? error.message : "Unknown error";
		assistantText = assistantText || `Error: ${message}`;
		assistantBubble.textContent = assistantText;
		setStatus(`Request failed: ${message}`, true);
	} finally {
		isStreaming = false;
		setFormState(true);
	}
});

loadConfigAndModels();
