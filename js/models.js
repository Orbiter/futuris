const statusEl = document.getElementById("model-status");
const tableEl = document.getElementById("model-table");
const tbodyEl = document.getElementById("model-table-body");
const refreshButton = document.getElementById("refresh-models");
const configForm = document.getElementById("llm-config-form");
const apiHostInput = document.getElementById("apihost");
const systemPromptInput = document.getElementById("systemprompt");

const llm = createSusiLLM();
const CONFIG_PATH = "/config.json";
const DEFAULT_API_HOST = "http://localhost:11434";
const DEFAULT_SYSTEM_PROMPT = "";

const setStatus = (message, isError = false) => {
	statusEl.textContent = message;
	statusEl.style.color = isError ? "#ff3719" : "";
};

const formatCreated = (value) => {
	if (!value && value !== 0) return "—";
	if (typeof value === "number") {
		const timestamp = value > 1000000000000 ? value : value * 1000;
		return new Date(timestamp).toLocaleString();
	}
	const parsed = Date.parse(value);
	if (!Number.isNaN(parsed)) {
		return new Date(parsed).toLocaleString();
	}
	return "—";
};

const normalizeModels = (payload) => {
	if (Array.isArray(payload)) return payload;
	if (payload && Array.isArray(payload.data)) return payload.data;
	if (payload && Array.isArray(payload.models)) return payload.models;
	return [];
};

const renderModels = (models) => {
	tbodyEl.innerHTML = "";
	models.forEach((model) => {
		const row = document.createElement("tr");
		const nameCell = document.createElement("td");
		const ownerCell = document.createElement("td");
		const createdCell = document.createElement("td");

		nameCell.textContent = model.id || model.name || "—";
		ownerCell.textContent = model.owned_by || model.owner || "—";
		createdCell.textContent = formatCreated(model.created || model.created_at);

		row.appendChild(nameCell);
		row.appendChild(ownerCell);
		row.appendChild(createdCell);
		tbodyEl.appendChild(row);
	});
};

const applyConfigToForm = (config) => {
	if (!configForm) return;
	if (apiHostInput) apiHostInput.value = config.apihost || DEFAULT_API_HOST;
	if (systemPromptInput) systemPromptInput.value = config.systemprompt || "";
};

const normalizeConfig = (config) => {
	const normalized = {
		apihost:
			typeof config.apihost === "string" && config.apihost.trim()
				? config.apihost.trim()
				: DEFAULT_API_HOST,
		systemprompt:
			typeof config.systemprompt === "string" ? config.systemprompt : DEFAULT_SYSTEM_PROMPT
	};
	return normalized;
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

const loadModels = async () => {
	setStatus("Loading models...");
	tableEl.hidden = true;
	try {
		const config = await readConfig();
		applyConfigToForm(config);
		const response = await llm.listModels({ baseUrl: config.apihost });
		const models = normalizeModels(response);
		if (!models.length) {
			setStatus("No models reported by the server.");
			return;
		}
		renderModels(models);
		setStatus(`Showing ${models.length} model${models.length === 1 ? "" : "s"}.`);
		tableEl.hidden = false;
	} catch (error) {
		const message = error && error.message ? error.message : "Unknown error";
		setStatus(`Failed to load models: ${message}`, true);
	}
};

if (refreshButton) {
	refreshButton.addEventListener("click", () => {
		loadModels();
	});
}

if (configForm) {
	configForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		const nextConfig = normalizeConfig({
			apihost: apiHostInput ? apiHostInput.value : DEFAULT_API_HOST,
			systemprompt: systemPromptInput ? systemPromptInput.value : DEFAULT_SYSTEM_PROMPT
		});
		try {
			await writeConfig(nextConfig);
			applyConfigToForm(nextConfig);
		} catch (error) {
			const message = error && error.message ? error.message : "Unknown error";
			setStatus(`Failed to save config: ${message}`, true);
			return;
		}
		loadModels();
	});
}

loadModels();
