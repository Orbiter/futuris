(async () => {
  const output = document.getElementById('console-output');
  const interrupt = document.getElementById('console-interrupt');
  const status = document.getElementById('console-status');
  const location = document.getElementById('console-cwd');

  const terminal = new Terminal({
    convertEol: true,
    cursorInactiveStyle: 'none',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    fontSize: matchMedia('(max-width: 43rem)').matches ? 12 : 14,
    scrollback: 4000,
    theme: {
      background: '#0b0f1a',
      foreground: '#dce3f0',
      cursor: '#dafc3d',
      selectionBackground: '#35435d',
      black: '#080a12',
      brightBlack: '#a5b2cc',
      red: '#ff85bd',
      brightRed: '#ffa7cf',
      green: '#dafc3d',
      brightGreen: '#efffa1',
      yellow: '#f7df7a',
      brightYellow: '#fff2a9',
      blue: '#91abff',
      brightBlue: '#bbcbff',
      magenta: '#c8a0fa',
      brightMagenta: '#e2caff',
      cyan: '#97eaf9',
      brightCyan: '#c4f8ff',
      white: '#dce3f0',
      brightWhite: '#f1f4ff'
    }
  });
  const fit = new FitAddon.FitAddon();
  terminal.loadAddon(fit);
  terminal.open(output);
  terminal.textarea.setAttribute('aria-label', 'Bash command');
  terminal.textarea.setAttribute('aria-describedby', 'console-keys');
  new ResizeObserver(() => fit.fit()).observe(output);
  document.fonts.ready.then(() => fit.fit());

  function sizeViewport() {
    const viewport = window.visualViewport;
    if (viewport?.scale === 1) {
      document.body.style.setProperty('--console-viewport', `${viewport.height}px`);
    } else {
      document.body.style.removeProperty('--console-viewport');
    }
  }
  window.visualViewport?.addEventListener('resize', sizeViewport);
  sizeViewport();

  function setStatus(message, error = false) {
    status.textContent = message;
    status.toggleAttribute('data-error', error);
  }

  let shell;
  let fs;
  try {
    fs = createJustBashFileSystem(await window.vfsReady);
    const displayText = (args, { exec, cwd, stdin }) =>
      exec('cat', { args, cwd, stdin, stdinKind: 'bytes' });
    shell = new JustBash.Bash({
      fs,
      cwd: '/',
      env: { TERM: 'xterm-256color', COLORTERM: 'truecolor', TMPDIR: '/' },
      customCommands: ['more', 'less'].map((name) => ({ name, execute: displayText }))
    });
  } catch (error) {
    setStatus('VFS unavailable', true);
    terminal.writeln(error?.message || 'Unable to open the virtual file system.');
    return;
  }

  let cwd = '/';
  let env = shell.getEnv();
  let exitCode = 0;
  let execution;
  const readline = new XtermReadline.Readline();
  readline.setCompletionHandler((line, cursor) => completeVfsPath(fs, cwd, env.HOME, line, cursor));
  terminal.loadAddon(readline);

  function cancel() {
    if (!execution || execution.signal.aborted) return;
    execution.abort();
    interrupt.disabled = true;
    setStatus('Stopping…');
  }

  function writeResult(result) {
    const { stdout, stderr } = result;
    if (stdout) {
      if (result.stdoutKind === 'bytes' || result.stdoutEncoding === 'binary') {
        terminal.write(Uint8Array.from(stdout, (character) => character.charCodeAt(0)));
      } else {
        terminal.write(stdout);
      }
      if (!stdout.endsWith('\n')) terminal.writeln('');
    }
    if (stderr) {
      terminal.write(stderr);
      if (!stderr.endsWith('\n')) terminal.writeln('');
    }
  }

  output.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && terminal.hasSelection()) {
      event.stopPropagation();
    }
  }, { capture: true });
  readline.setCtrlCHandler(cancel);
  interrupt.addEventListener('click', () => {
    terminal.focus();
    cancel();
  });

  async function execute(command) {
    execution = new AbortController();
    interrupt.hidden = false;
    interrupt.disabled = false;
    setStatus('Running…');
    terminal.scrollToBottom();
    terminal.write('\x1b[?25l');

    try {
      const result = await shell.exec(`(exit ${exitCode})\n${command}`, {
        rawScript: true,
        cwd,
        env: { ...env, COLUMNS: String(terminal.cols), LINES: String(terminal.rows) },
        replaceEnv: true,
        signal: execution.signal
      });
      exitCode = result.exitCode;
      env = result.env;
      if (env.PWD !== cwd && env.PWD?.startsWith('/')) {
        const entry = await fs.stat(env.PWD).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
        if (entry?.isDirectory) cwd = env.PWD;
      }
      location.textContent = cwd;
      location.title = cwd;
      writeResult(result);
      setStatus(exitCode ? `Exit ${exitCode}` : 'Ready', exitCode !== 0);
    } catch (error) {
      exitCode = execution.signal.aborted ? 130 : 1;
      if (!execution.signal.aborted) terminal.writeln(error?.message || String(error));
      setStatus(`Exit ${exitCode}`, true);
    } finally {
      if (execution.signal.aborted) {
        exitCode = 130;
        terminal.writeln('^C');
        setStatus('Interrupted');
      }
      execution = undefined;
      interrupt.hidden = true;
    }
  }

  terminal.writeln('\x1b[1;92mFUTURIS CONSOLE\x1b[0m');
  terminal.writeln('Working directory / · Type help for built-in commands.');
  terminal.writeln('');
  setStatus('Ready');
  if (matchMedia('(pointer: fine)').matches) terminal.focus();

  while (true) {
    // Enable bracketed paste so pasted line breaks stay in the draft.
    terminal.write('\x1b[0m\x1b[?25h\x1b[?2004h');
    const directory = cwd.replace(/[\x00-\x1f\x7f-\x9f]/g, '?');
    const command = await readline.read(`\x1b[1;92m${directory} $\x1b[0m `);
    if (command.trim()) await execute(command);
  }
})();
