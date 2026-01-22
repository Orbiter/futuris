// createSusiLLM is a single-file client for chat history + HTTP calls.
// Usage:
//   const llm = createSusiLLM({ systemPrompt });
//   llm.history.addUser("Hello");
//   await llm.streamChat({ baseUrl, apiKey, model, stopTokens, onToken: (t) => console.log(t) });
function createSusiLLM(options = {}) {
    const defaultSystemPrompt = options.systemPrompt || '';

    // In-memory chat history. Intended to be the only state store for prompts.
    class SusiChatHistory {
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

    const history = new SusiChatHistory(defaultSystemPrompt);

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
        return payload;
    };

    const buildHeaders = (apiKey) => {
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey && apiKey !== '' && apiKey !== '_') {
            headers.Authorization = 'Bearer ' + apiKey;
        }
        return headers;
    };

    // Streaming chat-completions: passes tokens to onToken and signals onDone.
    const streamChat = async (options = {}) => {
        const baseUrl = options.baseUrl;
        const apiKey = options.apiKey;
        if (!baseUrl) {
            throw new Error('Missing baseUrl');
        }
        const payload = buildChatPayload(options);
        const response = await fetch(baseUrl + '/v1/chat/completions', {
            method: 'POST',
            headers: buildHeaders(apiKey),
            body: JSON.stringify(payload),
            signal: options.signal
        });
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        if (!response.body) {
            throw new Error('Error: Missing response body');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let tokenCount = 0;
        let startedAt = performance.now();
        let firstTokenAt = 0;
        while (true) {
            const result = await reader.read();
            if (result.done) break;
            const lines = decoder.decode(result.value).split('\n');
            for (let line of lines) {
                line = line.replace(/^data: /, '').trim();
                if (!line) continue;
                if (line === '[DONE]') continue;
                if (line.startsWith('error')) {
                    if (typeof options.onError === 'function') options.onError(line);
                    continue;
                }
                try {
                    const json = JSON.parse(line);
                    const delta = json.choices && json.choices[0] && json.choices[0].delta;
                    if (delta && delta.content) {
                        if (firstTokenAt === 0) firstTokenAt = performance.now();
                        tokenCount += 1;
                        if (typeof options.onToken === 'function') options.onToken(delta.content);
                    }
                } catch (error) {
                    if (typeof options.onError === 'function') {
                        options.onError('Error parsing JSON: ' + error.message);
                    }
                }
            }
        }
        if (typeof options.onDone === 'function') {
            options.onDone({ tokenCount, startedAt, firstTokenAt, endedAt: performance.now() });
        }
        return { tokenCount, startedAt, firstTokenAt, endedAt: performance.now() };
    };

    // Non-streaming chat-completions, returns the full JSON response.
    const completeChat = async (options = {}) => {
        const baseUrl = options.baseUrl;
        const apiKey = options.apiKey;
        if (!baseUrl) {
            throw new Error('Missing baseUrl');
        }
        const payload = buildChatPayload({ ...options, stream: false });
        const response = await fetch(baseUrl + '/v1/chat/completions', {
            method: 'POST',
            headers: buildHeaders(apiKey),
            body: JSON.stringify(payload),
            signal: options.signal
        });
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
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
            headers: buildHeaders(apiKey),
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
