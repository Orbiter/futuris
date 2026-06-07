// createLLM is a single-file client for chat history + HTTP calls.
// Usage:
//   const llm = createLLM({ systemPrompt });
//   llm.history.addUser("Hello");
//   await llm.streamChat({ baseUrl, apiKey, model, stopTokens, onToken: (t) => console.log(t) });
function createLLM(options = {}) {
    const defaultSystemPrompt = options.systemPrompt || '';

    // In-memory chat history. Intended to be the only state store for prompts.
    class ChatHistory {
        constructor(systemPrompt) {
            this.systemPrompt = systemPrompt;
            this.messages = [{ role: 'system', content: systemPrompt }];
        }

        reset(systemPrompt = this.systemPrompt) {
            this.systemPrompt = systemPrompt;
            this.messages = [{ role: 'system', content: systemPrompt }];
        }

        setSystemPrompt(systemPrompt) {
            this.systemPrompt = systemPrompt;
            if (this.messages.length > 0) {
                this.messages[0] = { role: 'system', content: systemPrompt };
            } else {
                this.messages = [{ role: 'system', content: systemPrompt }];
            }
        }

        addMessage(message) {
            this.messages.push(message);
        }

        addUser(content) {
            this.messages.push({ role: 'user', content });
        }

        addAssistant(content) {
            this.messages.push({ role: 'assistant', content });
        }

        getMessages() {
            return this.messages;
        }

        setMessages(messages) {
            this.messages = messages;
        }

        length() {
            return this.messages.length;
        }

        last() {
            return this.messages[this.messages.length - 1];
        }

        getLastContent() {
            const last = this.last();
            return last ? last.content : '';
        }

        getLastAssistantContent() {
            for (let i = this.messages.length - 1; i >= 0; i -= 1) {
                if (this.messages[i].role === 'assistant') return this.messages[i].content;
            }
            return '';
        }

        getSecondLastContent() {
            return this.messages.length >= 2 ? this.messages[this.messages.length - 2].content : '';
        }

        chopLastPair() {
            const before = this.messages.length;
            if (this.messages.length > 1) {
                this.messages.pop();
                this.messages.pop();
            }
            return { before, after: this.messages.length };
        }

        truncateLastPair() {
            if (this.messages.length >= 2) {
                this.messages = this.messages.slice(0, -2);
            }
        }

        appendUserEmptyAndAssistant(content) {
            this.messages.push({ role: 'user', content: '' });
            this.messages.push({ role: 'assistant', content });
        }

        buildEmptyPromptState() {
            const transposed = [];
            let promptContent = '';
            if (this.messages.length > 0) {
                transposed.push({ ...this.messages[0] });
            }
            for (let i = 2; i < this.messages.length - 2; i += 2) {
                const assistantm = { ...this.messages[i], role: 'user' };
                const userm = { ...this.messages[i + 1], role: 'assistant' };
                transposed.push(assistantm);
                transposed.push(userm);
                promptContent = assistantm.content;
            }
            return { transposed, promptContent };
        }
    }

    const history = new ChatHistory(defaultSystemPrompt);

    const toolLibrary = {
        get_datetime: {
            definition: {
                type: 'function',
                function: {
                    name: 'get_datetime',
                    description: 'Return the current date and time.'
                }
            },
            handler: () => new Date().toLocaleString()
        },
        vfs_read_file: {
            definition: {
                type: 'function',
                function: {
                    name: 'vfs_read_file',
                    description: 'Read a text file from the virtual file system.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Absolute VFS path starting with /.'
                            }
                        },
                        required: ['path']
                    }
                }
            },
            handler: async (toolCall) => {
                const args = toolCall && toolCall.function ? toolCall.function.arguments : '{}';
                let parsed = {};
                try {
                    parsed = JSON.parse(args || '{}');
                } catch (error) {
                    return 'Invalid arguments.';
                }
                const path = typeof parsed.path === 'string' ? parsed.path.trim() : '';
                if (!path || !path.startsWith('/')) {
                    return 'Invalid path.';
                }
                try {
                    const vfs = await window.vfsReady;
                    return await vfs.getasync(path);
                } catch (error) {
                    return 'Unable to read file.';
                }
            }
        },
        vfs_list_files: {
            definition: {
                type: 'function',
                function: {
                    name: 'vfs_list_files',
                    description: 'List entries in a VFS directory.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Absolute directory path ending with /. Defaults to /.'
                            }
                        }
                    }
                }
            },
            handler: async (toolCall) => {
                const args = toolCall && toolCall.function ? toolCall.function.arguments : '{}';
                let parsed = {};
                try {
                    parsed = JSON.parse(args || '{}');
                } catch (error) {
                    return 'Invalid arguments.';
                }
                let path = typeof parsed.path === 'string' ? parsed.path.trim() : '/';
                if (!path) path = '/';
                if (!path.startsWith('/')) {
                    return 'Invalid path.';
                }
                if (!path.endsWith('/')) {
                    path += '/';
                }
                try {
                    const vfs = await window.vfsReady;
                    const entries = await vfs.ls(path);
                    const basePath = path === '/' ? '/' : path;
                    const formatted = entries
                        .filter((entry) => !entry.endsWith('/'))
                        .map((entry) => `${basePath}${entry}`);
                    return formatted.join('\n');
                } catch (error) {
                    return 'Unable to list directory.';
                }
            }
        },
        vfs_apply_diff: {
            definition: {
                type: 'function',
                function: {
                    name: 'vfs_apply_diff',
                    description: 'Apply a unified diff to an existing VFS file (preferred for edits).',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Absolute file path starting with /.'
                            },
                            diff: {
                                type: 'string',
                                description: 'Unified diff to apply.'
                            }
                        },
                        required: ['path', 'diff']
                    }
                }
            },
            handler: async (toolCall) => {
                const args = toolCall && toolCall.function ? toolCall.function.arguments : '{}';
                let parsed = {};
                try {
                    parsed = JSON.parse(args || '{}');
                } catch (error) {
                    return 'Invalid arguments.';
                }
                const path = typeof parsed.path === 'string' ? parsed.path.trim() : '';
                const diff = typeof parsed.diff === 'string' ? parsed.diff : '';
                if (!path || !path.startsWith('/')) {
                    return 'Invalid path.';
                }
                if (!diff) {
                    return 'Empty diff.';
                }
                try {
                    const vfs = await window.vfsReady;
                    await vfs.applyDiff(path, diff);
                    return 'OK';
                } catch (error) {
                    return 'Unable to apply diff.';
                }
            }
        },
        vfs_write_file: {
            definition: {
                type: 'function',
                function: {
                    name: 'vfs_write_file',
                    description: 'Create or overwrite a VFS file with text content.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Absolute file path starting with /.'
                            },
                            content: {
                                type: 'string',
                                description: 'Text content to write.'
                            }
                        },
                        required: ['path', 'content']
                    }
                }
            },
            handler: async (toolCall) => {
                const args = toolCall && toolCall.function ? toolCall.function.arguments : '{}';
                let parsed = {};
                try {
                    parsed = JSON.parse(args || '{}');
                } catch (error) {
                    return 'Invalid arguments.';
                }
                const path = typeof parsed.path === 'string' ? parsed.path.trim() : '';
                const content = typeof parsed.content === 'string' ? parsed.content : '';
                if (!path || !path.startsWith('/') || path.endsWith('/')) {
                    return 'Invalid path.';
                }
                try {
                    const vfs = await window.vfsReady;
                    await vfs.put(path, content);
                    return 'OK';
                } catch (error) {
                    return 'Unable to write file.';
                }
            }
        },
        vfs_rename_file: {
            definition: {
                type: 'function',
                function: {
                    name: 'vfs_rename_file',
                    description: 'Rename or move a VFS file.',
                    parameters: {
                        type: 'object',
                        properties: {
                            from: {
                                type: 'string',
                                description: 'Source file path starting with /.'
                            },
                            to: {
                                type: 'string',
                                description: 'Destination file path starting with /.'
                            }
                        },
                        required: ['from', 'to']
                    }
                }
            },
            handler: async (toolCall) => {
                const args = toolCall && toolCall.function ? toolCall.function.arguments : '{}';
                let parsed = {};
                try {
                    parsed = JSON.parse(args || '{}');
                } catch (error) {
                    return 'Invalid arguments.';
                }
                const from = typeof parsed.from === 'string' ? parsed.from.trim() : '';
                const to = typeof parsed.to === 'string' ? parsed.to.trim() : '';
                if (!from || !from.startsWith('/') || from.endsWith('/')) {
                    return 'Invalid source path.';
                }
                if (!to || !to.startsWith('/') || to.endsWith('/')) {
                    return 'Invalid destination path.';
                }
                try {
                    const vfs = await window.vfsReady;
                    await vfs.mv(from, to);
                    return 'OK';
                } catch (error) {
                    return 'Unable to rename file.';
                }
            }
        },
        vfs_delete_file: {
            definition: {
                type: 'function',
                function: {
                    name: 'vfs_delete_file',
                    description: 'Delete a VFS file.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Absolute file path starting with /.'
                            }
                        },
                        required: ['path']
                    }
                }
            },
            handler: async (toolCall) => {
                const args = toolCall && toolCall.function ? toolCall.function.arguments : '{}';
                let parsed = {};
                try {
                    parsed = JSON.parse(args || '{}');
                } catch (error) {
                    return 'Invalid arguments.';
                }
                const path = typeof parsed.path === 'string' ? parsed.path.trim() : '';
                if (!path || !path.startsWith('/') || path.endsWith('/')) {
                    return 'Invalid path.';
                }
                try {
                    const vfs = await window.vfsReady;
                    await vfs.rm(path);
                    return 'OK';
                } catch (error) {
                    return 'Unable to delete file.';
                }
            }
        },
        vfs_copy_file: {
            definition: {
                type: 'function',
                function: {
                    name: 'vfs_copy_file',
                    description: 'Copy a VFS file.',
                    parameters: {
                        type: 'object',
                        properties: {
                            from: {
                                type: 'string',
                                description: 'Source file path starting with /.'
                            },
                            to: {
                                type: 'string',
                                description: 'Destination file path starting with /.'
                            }
                        },
                        required: ['from', 'to']
                    }
                }
            },
            handler: async (toolCall) => {
                const args = toolCall && toolCall.function ? toolCall.function.arguments : '{}';
                let parsed = {};
                try {
                    parsed = JSON.parse(args || '{}');
                } catch (error) {
                    return 'Invalid arguments.';
                }
                const from = typeof parsed.from === 'string' ? parsed.from.trim() : '';
                const to = typeof parsed.to === 'string' ? parsed.to.trim() : '';
                if (!from || !from.startsWith('/') || from.endsWith('/')) {
                    return 'Invalid source path.';
                }
                if (!to || !to.startsWith('/') || to.endsWith('/')) {
                    return 'Invalid destination path.';
                }
                try {
                    const vfs = await window.vfsReady;
                    await vfs.cp(from, to);
                    return 'OK';
                } catch (error) {
                    return 'Unable to copy file.';
                }
            }
        },
        vfs_mkdir: {
            definition: {
                type: 'function',
                function: {
                    name: 'vfs_mkdir',
                    description: 'Create a directory in the VFS.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Absolute directory path starting with / and ending with /.'
                            }
                        },
                        required: ['path']
                    }
                }
            },
            handler: async (toolCall) => {
                const args = toolCall && toolCall.function ? toolCall.function.arguments : '{}';
                let parsed = {};
                try {
                    parsed = JSON.parse(args || '{}');
                } catch (error) {
                    return 'Invalid arguments.';
                }
                let path = typeof parsed.path === 'string' ? parsed.path.trim() : '';
                if (!path || !path.startsWith('/')) {
                    return 'Invalid path.';
                }
                if (!path.endsWith('/')) {
                    path += '/';
                }
                try {
                    const vfs = await window.vfsReady;
                    await vfs.put(path, '');
                    return 'OK';
                } catch (error) {
                    return 'Unable to create directory.';
                }
            }
        },
        vfs_file_exists: {
            definition: {
                type: 'function',
                function: {
                    name: 'vfs_file_exists',
                    description: 'Check if a VFS file exists.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Absolute file path starting with /.'
                            }
                        },
                        required: ['path']
                    }
                }
            },
            handler: async (toolCall) => {
                const args = toolCall && toolCall.function ? toolCall.function.arguments : '{}';
                let parsed = {};
                try {
                    parsed = JSON.parse(args || '{}');
                } catch (error) {
                    return 'Invalid arguments.';
                }
                const path = typeof parsed.path === 'string' ? parsed.path.trim() : '';
                if (!path || !path.startsWith('/')) {
                    return 'Invalid path.';
                }
                try {
                    const vfs = await window.vfsReady;
                    await vfs.getasync(path);
                    return 'true';
                } catch (error) {
                    return 'false';
                }
            }
        },
        vfs_grep: {
            definition: {
                type: 'function',
                function: {
                    name: 'vfs_grep',
                    description: 'Find files containing a given string in the VFS.',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: 'String to search for.'
                            }
                        },
                        required: ['query']
                    }
                }
            },
            handler: async (toolCall) => {
                const args = toolCall && toolCall.function ? toolCall.function.arguments : '{}';
                let parsed = {};
                try {
                    parsed = JSON.parse(args || '{}');
                } catch (error) {
                    return 'Invalid arguments.';
                }
                const query = typeof parsed.query === 'string' ? parsed.query : '';
                if (!query) {
                    return 'Empty query.';
                }
                try {
                    const vfs = await window.vfsReady;
                    const entries = await vfs.ls('/');
                    const files = entries.filter((entry) => !entry.endsWith('/'));
                    const matches = [];
                    for (const entry of files) {
                        const path = `/${entry}`;
                        try {
                            const contents = await vfs.getasync(path);
                            if (String(contents || '').includes(query)) {
                                matches.push(path);
                            }
                        } catch (error) {
                            // skip unreadable entries
                        }
                    }
                    return matches.join('\n');
                } catch (error) {
                    return 'Unable to search files.';
                }
            }
        }
    };

    const listTools = () => Object.values(toolLibrary).map((tool) => tool.definition);

    const runTool = async (toolCall) => {
        const name = toolCall && toolCall.function ? toolCall.function.name : '';
        const tool = toolLibrary[name];
        if (!tool || typeof tool.handler !== 'function') {
            return `Unsupported tool: ${name || 'unknown'}`;
        }
        return await tool.handler(toolCall);
    };

    // Build /v1/chat/completions payload from history + overrides.
    const buildChatPayload = (options = {}) => {
        const model = options.model;
        const messages = options.messages || history.getMessages();
        if (!model) {
            throw new Error('Missing model');
        }
        const payload = {
            model: model,
            messages: messages,
            stream: options.stream !== false
        };
        const maxTokens = options.maxTokens;
        const temperature = options.temperature;
        const stopTokens = Array.isArray(options.stopTokens) ? options.stopTokens : null;
        const tools = Array.isArray(options.tools) ? options.tools : null;
        const toolChoice = options.toolChoice;
        if (model && (model.startsWith('o4') || model.startsWith('gpt-4.1'))) {
            if (typeof maxTokens === 'number') payload.max_completion_tokens = maxTokens;
        } else {
            if (typeof maxTokens === 'number') payload.max_tokens = maxTokens;
            if (typeof temperature === 'number') payload.temperature = temperature;
            if (stopTokens && stopTokens.length) payload.stop = stopTokens;
        }
        if (tools && tools.length) payload.tools = tools;
        if (toolChoice) payload.tool_choice = toolChoice;
        if (options.thinking === false) {
            payload.enable_thinking = false;
            payload.reasoning_effort = 'none';
        }
        return payload;
    };

    const buildHeaders = (apiKey, hasJsonBody = true) => {
        const headers = hasJsonBody ? { 'Content-Type': 'application/json' } : {};
        if (apiKey && apiKey !== '' && apiKey !== '_') {
            headers.Authorization = 'Bearer ' + apiKey;
        }
        return headers;
    };

    const requestChat = async (options) => {
        if (!options.baseUrl) {
            throw new Error('Missing baseUrl');
        }
        const payload = buildChatPayload(options);
        const response = await fetch(options.baseUrl + '/v1/chat/completions', {
            method: 'POST',
            headers: buildHeaders(options.apiKey),
            body: JSON.stringify(payload),
            signal: options.signal
        });
        if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw new Error(data?.error?.message || 'HTTP ' + response.status);
        }
        return response;
    };

    // Decode complete SSE events even when a response splits a line across chunks.
    async function* readChatEvents(body) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let data = [];
        try {
            while (true) {
                const { value, done } = await reader.read();
                buffer += decoder.decode(value, { stream: !done });
                for (let end = buffer.match(/\r\n?|\n/); end; end = buffer.match(/\r\n?|\n/)) {
                    const nextIndex = end.index + end[0].length;
                    if (!done && end[0] === '\r' && nextIndex === buffer.length) break;
                    const line = buffer.slice(0, end.index);
                    buffer = buffer.slice(nextIndex);
                    if (line.startsWith('data:')) {
                        data.push(line.slice(5).replace(/^ /, ''));
                    } else if (!line && data.length) {
                        const event = data.join('\n');
                        data = [];
                        yield event;
                    }
                }
                if (done) return;
            }
        } finally {
            // Also closes the response when a [DONE] event arrives before EOF.
            await reader.cancel().catch(() => {});
            reader.releaseLock();
        }
    }

    const streamChat = async (options = {}) => {
        const startedAt = performance.now();
        let tokenCount = 0;
        let firstTokenAt = 0;
        let content = '';
        let finishReason;
        const calls = new Map();
        const response = await requestChat({ ...options, stream: true });

        const addDelta = (delta) => {
            if (delta.content) {
                if (!firstTokenAt) firstTokenAt = performance.now();
                tokenCount += 1;
                content += delta.content;
                options.onToken?.(delta.content);
            }
            for (const [position, part] of (delta.tool_calls || []).entries()) {
                const index = part.index ?? position;
                const call = calls.get(index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
                if (part.id) call.id = part.id;
                call.function.name += part.function?.name || '';
                call.function.arguments += part.function?.arguments || '';
                calls.set(index, call);
            }
        };

        try {
            if (response.headers.get('content-type')?.includes('application/json')) {
                const data = await response.json();
                if (data.error) throw new Error(data.error.message || String(data.error));
                const choice = data.choices?.[0];
                if (!choice?.message) throw new Error('The model returned no message.');
                addDelta(choice.message);
                finishReason = choice.finish_reason;
            } else {
                if (!response.body) throw new Error('Missing response stream.');
                let sawDone = false;
                for await (const event of readChatEvents(response.body)) {
                    if (event.trim() === '[DONE]') {
                        sawDone = true;
                        break;
                    }
                    const data = JSON.parse(event);
                    if (data.error) throw new Error(data.error.message || String(data.error));
                    const choice = data.choices?.[0];
                    if (choice?.delta) addDelta(choice.delta);
                    if (choice?.finish_reason) finishReason = choice.finish_reason;
                }
                if (!sawDone && !finishReason) throw new Error('The response stream was interrupted.');
            }

            const message = { role: 'assistant', content };
            if (calls.size) {
                message.tool_calls = Array.from(calls.keys()).sort((a, b) => a - b).map((index) => calls.get(index));
                if (message.tool_calls.some((call) => !call.id || !call.function.name)) {
                    throw new Error('The model returned an incomplete tool call.');
                }
            }
            const result = { message, finishReason, tokenCount, startedAt, firstTokenAt, endedAt: performance.now() };
            options.onDone?.(result);
            return result;
        } catch (error) {
            if (!options.signal?.aborted) options.onError?.(error.message);
            throw error;
        }
    };

    const completeChat = async (options = {}) => {
        const response = await requestChat({ ...options, stream: false });
        return response.json();
    };

    // Lightweight model warmup; returns answer + token usage.
    const warmup = async (options = {}) => {
        const systemPrompt = typeof options.systemPrompt === 'string' ? options.systemPrompt : defaultSystemPrompt;
        const messages = [{ role: 'system', content: systemPrompt }];
        const data = await completeChat({
            ...options,
            messages
        });
        const answer = data.choices && data.choices[0] && data.choices[0].message
            ? data.choices[0].message.content
            : '';
        const usage = data.usage || {};
        return {
            answer,
            completion_tokens: usage.completion_tokens || 0,
            prompt_tokens: usage.prompt_tokens || 0,
            total_tokens: usage.total_tokens || 0
        };
    };

    // llama.cpp-specific model loader (POST /models/load).
    const llamaCppLoadModel = async (options = {}) => {
        const baseUrl = options.baseUrl;
        const apiKey = options.apiKey;
        if (!baseUrl) {
            throw new Error('Missing baseUrl');
        }
        const response = await fetch(baseUrl + '/models/load', {
            method: 'POST',
            headers: buildHeaders(apiKey),
            body: JSON.stringify({ model: options.model }),
            signal: options.signal
        });
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        return response.json();
    };

    // OpenAI-compatible model list (GET /v1/models).
    const listModels = async (options = {}) => {
        const baseUrl = options.baseUrl;
        const apiKey = options.apiKey;
        if (!baseUrl) {
            throw new Error('Missing baseUrl');
        }
        const response = await fetch(baseUrl + '/v1/models', {
            method: 'GET',
            headers: buildHeaders(apiKey, false),
            signal: options.signal
        });
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        return response.json();
    };

    // Ollama pull with llama.cpp load as failover.
    const ollamaPull = async (options = {}) => {
        const baseUrl = options.baseUrl;
        const apiKey = options.apiKey;
        if (!baseUrl) {
            throw new Error('Missing baseUrl');
        }
        try {
            const response = await fetch(baseUrl + '/api/pull', {
                method: 'POST',
                headers: buildHeaders(apiKey),
                body: JSON.stringify({ model: options.model }),
                signal: options.signal
            });
            if (!response.ok) {
                throw new Error(`Error: ${response.status}`);
            }
            return response.json();
        } catch (error) {
            return await llamaCppLoadModel(options);
        }
    };

    // Ollama delete endpoint (POST /api/delete).
    const ollamaDelete = async (options = {}) => {
        const baseUrl = options.baseUrl;
        const apiKey = options.apiKey;
        if (!baseUrl) {
            throw new Error('Missing baseUrl');
        }
        const response = await fetch(baseUrl + '/api/delete', {
            method: 'POST',
            headers: buildHeaders(apiKey),
            body: JSON.stringify({ model: options.model }),
            signal: options.signal
        });
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        return response.json();
    };

    // Public API surface (single object for easy embedding).
    return {
        history,
        listTools,
        runTool,
        buildChatPayload,
        streamChat,
        completeChat,
        warmup,
        listModels,
        llamaCppLoadModel,
        ollamaPull,
        ollamaDelete
    };
}

const LLM_CONFIG_PATH = "/config.json";
const DEFAULT_OLLAMA_PORT = "11434";
const DEFAULT_LLM_API_HOST = `http://localhost:${DEFAULT_OLLAMA_PORT}`;

function normalizeLLMConfig(config) {
    const host = typeof config?.apihost === "string" ? config.apihost.trim() : "";
    return {
        // The client adds /v1 when it builds the model and chat URLs.
        apihost: host.replace(/\/+$/, "").replace(/([^/])\/v1$/, "$1") || DEFAULT_LLM_API_HOST,
        systemprompt: typeof config?.systemprompt === "string" ? config.systemprompt : "",
        model: typeof config?.model === "string" ? config.model : "",
        // Older configs leave the reasoning setting to the API.
        thinking: typeof config?.thinking === "boolean" ? config.thinking : undefined
    };
}

async function writeLLMConfig(config) {
    const vfs = await window.vfsReady;
    await vfs.put(LLM_CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function readLLMConfig() {
    const vfs = await window.vfsReady;
    let storedConfig;
    try {
        storedConfig = JSON.parse(await vfs.getasync(LLM_CONFIG_PATH));
    } catch (error) {
        if (error !== "Key not found" && !(error instanceof SyntaxError)) {
            throw error;
        }
    }

    const config = normalizeLLMConfig(storedConfig);
    if (JSON.stringify(storedConfig) !== JSON.stringify(config)) {
        await writeLLMConfig(config);
    }
    return config;
}

function initModelsPage() {
    const statusEl = document.getElementById("model-status");
    const ollamaCorsHelp = document.getElementById("ollama-cors-help");
    const tableEl = document.getElementById("model-table");
    const tbodyEl = document.getElementById("model-table-body");
    const refreshButton = document.getElementById("refresh-models");
    const configForm = document.getElementById("llm-config-form");
    const apiHostInput = document.getElementById("apihost");
    const systemPromptInput = document.getElementById("systemprompt");
    const thinkingInput = document.getElementById("thinking");
    const saveButton = configForm?.querySelector('button[type="submit"]');

    if (!statusEl || !ollamaCorsHelp || !tableEl || !tbodyEl || !refreshButton || !saveButton ||
        !apiHostInput || !systemPromptInput || !thinkingInput) {
        return;
    }

    const llm = createLLM();
    let currentConfig = null;
    let modelRequest;

    const setStatus = (message, isError = false) => {
        statusEl.textContent = message;
        statusEl.style.color = isError ? "var(--color-accent-detail)" : "";
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

    const renderModels = (models, selectedModel) => {
        tbodyEl.innerHTML = "";
        models.forEach((model, index) => {
            const row = document.createElement("tr");
            const selectCell = document.createElement("td");
            const nameCell = document.createElement("td");
            const ownerCell = document.createElement("td");
            const createdCell = document.createElement("td");
            const radio = document.createElement("input");
            const label = document.createElement("label");

            radio.type = "radio";
            radio.name = "chat-model";
            radio.id = `model-choice-${index}`;
            radio.value = model.id;
            radio.checked = model.id === selectedModel;
            selectCell.appendChild(radio);

            label.htmlFor = radio.id;
            label.textContent = model.id;
            nameCell.appendChild(label);
            ownerCell.textContent = model.owned_by || model.owner || "—";
            createdCell.textContent = formatCreated(model.created ?? model.created_at);

            row.appendChild(selectCell);
            row.appendChild(nameCell);
            row.appendChild(ownerCell);
            row.appendChild(createdCell);
            tbodyEl.appendChild(row);
        });
    };

    const loadModels = async () => {
        modelRequest?.abort();
        const request = new AbortController();
        modelRequest = request;
        setStatus("Loading models...");
        ollamaCorsHelp.hidden = true;
        tableEl.hidden = true;
        try {
            const config = await readLLMConfig();
            if (request.signal.aborted) return;
            currentConfig = config;
            apiHostInput.value = config.apihost;
            systemPromptInput.value = config.systemprompt;
            thinkingInput.checked = config.thinking ?? true;
            const apiHost = new URL(config.apihost, window.location.href);
            const response = await llm.listModels({ baseUrl: config.apihost, signal: request.signal }).catch((error) => {
                // Fetch reports CORS blocks and other network failures as TypeError.
                if (!request.signal.aborted && error instanceof TypeError &&
                    /^https?:$/.test(apiHost.protocol) && apiHost.port === DEFAULT_OLLAMA_PORT &&
                    apiHost.origin !== window.location.origin) {
                    ollamaCorsHelp.hidden = false;
                }
                throw error;
            });
            if (request.signal.aborted) return;
            const models = normalizeModels(response).flatMap((model) => {
                const id = model?.id || model?.name;
                return typeof id === "string" && id.trim() ? [{ ...model, id }] : [];
            });
            if (!models.length) {
                setStatus(`No models reported by ${config.apihost}.`);
                return;
            }
            renderModels(models, config.model);
            setStatus(`Showing ${models.length} model${models.length === 1 ? "" : "s"} from ${config.apihost}.`);
            tableEl.hidden = false;
        } catch (error) {
            if (!request.signal.aborted) {
                setStatus(`Failed to load models: ${error?.message || error}`, true);
            }
        }
    };

    const saveConfig = async (config, failureMessage) => {
        const focusedControl = document.activeElement;
        saveButton.disabled = true;
        refreshButton.disabled = true;
        tableEl.inert = true;
        try {
            await writeLLMConfig(config);
            currentConfig = config;
            return true;
        } catch (error) {
            setStatus(`${failureMessage}: ${error?.message || error}`, true);
            return false;
        } finally {
            saveButton.disabled = false;
            refreshButton.disabled = false;
            tableEl.inert = false;
            if (document.activeElement === document.body) {
                focusedControl?.focus({ preventScroll: true });
            }
        }
    };

    refreshButton.addEventListener("click", loadModels);

    configForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (saveButton.disabled) return;
        modelRequest?.abort();
        const nextConfig = normalizeLLMConfig({
            apihost: apiHostInput.value,
            systemprompt: systemPromptInput.value,
            model: currentConfig?.model,
            thinking: thinkingInput.checked
        });
        if (nextConfig.apihost !== currentConfig?.apihost) {
            nextConfig.model = "";
        }
        if (await saveConfig(nextConfig, "Failed to save config")) {
            loadModels();
        }
    });

    tbodyEl.addEventListener("change", async (event) => {
        const radio = event.target;
        if (!radio.matches('input[name="chat-model"]:checked')) return;
        const nextConfig = { ...currentConfig, model: radio.value };
        if (await saveConfig(nextConfig, "Failed to save model")) {
            setStatus(`${nextConfig.model} saved as the default model for Chat.`);
        } else {
            tbodyEl.querySelectorAll('input[name="chat-model"]').forEach((input) => {
                input.checked = input.value === currentConfig.model;
            });
        }
    });

    loadModels();
}

if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => {
        if (document.getElementById("model-table")) {
            initModelsPage();
        }
    });
}
