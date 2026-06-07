/**
 * Virtual File System (VFS) using IndexedDB with Bash-like Commands
 * (C) 2026 by Michael Peter Christen
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program in the file lgpl21.txt
 * If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * This script implements a simple key-value store using IndexedDB, which is a low-level API
 * for client-side storage of significant amounts of structured data, including files/blobs.
 * This API uses indexes to enable high-performance searches of this data.
 *
 * The VFS provides a set of methods for storing, retrieving, and deleting key-value pairs in an
 * IndexedDB object store, where keys represent paths in a file system-like structure.
 * Paths are delimited by a slash (/) and must start with a leading slash.
 * Paths ending with a slash are considered directories, while paths not ending with a slash are considered files.
 *
 * The VFS includes Bash-like commands for manipulating the virtual file system.
 *
 * The VFS is exposed as a global object in pages and workers.
 */

// Open a connection to the database
const openRequest = indexedDB.open('vfs', 1);

let vfsReadyResolve;
let vfsReadyReject;
globalThis.vfsReady = new Promise((resolve, reject) => {
  vfsReadyResolve = resolve;
  vfsReadyReject = reject;
});

let db;

const applyUnifiedDiff = (originalText, diffText) => {
  const originalEndsWithNewline = originalText.endsWith('\n');
  const originalLines = originalText.split('\n');
  const diffLines = diffText.split('\n');
  const result = [];
  let origIndex = 0;
  let i = 0;
  const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

  const collectHunkOps = (startIndex) => {
    const ops = [];
    let index = startIndex;
    while (index < diffLines.length && !diffLines[index].startsWith('@@')) {
      const hunkLine = diffLines[index];
      if (hunkLine.startsWith(' ') || hunkLine.startsWith('-') || hunkLine.startsWith('+')) {
        ops.push(hunkLine);
      }
      index += 1;
    }
    return { ops, nextIndex: index };
  };

  const hunkFitsAt = (startAt, ops) => {
    let checkIndex = startAt;
    for (const op of ops) {
      if (op.startsWith(' ') || op.startsWith('-')) {
        const content = op.slice(1);
        if (originalLines[checkIndex] !== content) {
          return false;
        }
        checkIndex += 1;
      }
    }
    return true;
  };

  const findHunkStart = (fromIndex, ops, suggestedStart) => {
    if (Number.isInteger(suggestedStart) && suggestedStart >= fromIndex) {
      if (hunkFitsAt(suggestedStart, ops)) {
        return suggestedStart;
      }
    }
    const firstContext = ops.find((op) => op.startsWith(' '));
    if (!firstContext) {
      return fromIndex;
    }
    const needle = firstContext.slice(1);
    for (let idx = fromIndex; idx < originalLines.length; idx += 1) {
      if (originalLines[idx] === needle && hunkFitsAt(idx, ops)) {
        return idx;
      }
    }
    return -1;
  };

  while (i < diffLines.length) {
    const line = diffLines[i];
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    ) {
      i += 1;
      continue;
    }
    const match = line.match(hunkHeader);
    if (!match) {
      i += 1;
      continue;
    }

    const oldStart = parseInt(match[1], 10) - 1;
    const { ops, nextIndex } = collectHunkOps(i + 1);
    const hunkStart = findHunkStart(origIndex, ops, oldStart);
    if (hunkStart < 0) {
      throw new Error('Patch context mismatch.');
    }

    while (origIndex < hunkStart && origIndex < originalLines.length) {
      result.push(originalLines[origIndex]);
      origIndex += 1;
    }

    for (const op of ops) {
      if (op.startsWith(' ')) {
        const content = op.slice(1);
        if (originalLines[origIndex] !== content) {
          throw new Error('Patch context mismatch.');
        }
        result.push(content);
        origIndex += 1;
      } else if (op.startsWith('-')) {
        const content = op.slice(1);
        if (originalLines[origIndex] !== content) {
          throw new Error('Patch removal mismatch.');
        }
        origIndex += 1;
      } else if (op.startsWith('+')) {
        result.push(op.slice(1));
      }
    }

    i = nextIndex;
  }

  while (origIndex < originalLines.length) {
    result.push(originalLines[origIndex]);
    origIndex += 1;
  }

  let patched = result.join('\n');
  if (originalEndsWithNewline && !patched.endsWith('\n')) {
    patched += '\n';
  }
  return patched;
};

// Run filesystem operations against a single committed view of the shared VFS.
function vfsTransaction(database, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('keyValueStore', mode);
    let result;
    let failure;
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(failure || transaction.error);
    operation(transaction.objectStore('keyValueStore')).then((value) => {
      result = value;
    }).catch((error) => {
      failure = error;
      try {
        transaction.abort();
      } catch {
        reject(error);
      }
    });
  });
}

function vfsRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function createVfsFileSystem(database, directoryRange) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const read = (operation) => vfsTransaction(database, 'readonly', operation);
  const write = (operation) => vfsTransaction(database, 'readwrite', operation);

  function fail(code, path) {
    throw Object.assign(new Error(`${code}: ${path}`), { code });
  }

  function resolvePath(base, path) {
    if (path.includes('\0')) fail('EINVAL', path);
    const parts = path.startsWith('/') ? [] : base.split('/').filter(Boolean);
    for (const part of path.split('/')) {
      if (part === '..') parts.pop();
      else if (part && part !== '.') parts.push(part);
    }
    return '/' + parts.join('/');
  }

  function directoryKey(path) {
    return path === '/' ? '/' : path + '/';
  }

  function parent(path) {
    return path.slice(0, path.lastIndexOf('/')) || '/';
  }

  function bytes(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return encoder.encode(value ?? '');
  }

  function fileValue(data) {
    try {
      const text = decoder.decode(data);
      if (!text.includes('\0')) return text;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    return data;
  }

  function append(previous, value) {
    if (typeof previous === 'string' && typeof value === 'string') return previous + value;
    if (previous instanceof Blob || value instanceof Blob) return new Blob([previous, value]);
    const initial = bytes(previous);
    const added = bytes(value);
    const joined = new Uint8Array(initial.length + added.length);
    joined.set(initial);
    joined.set(added, initial.length);
    return fileValue(joined);
  }

  async function lookup(store, path) {
    if (path !== '/') {
      const file = await vfsRequest(store.get(path));
      if (file) return file;
    }
    const key = directoryKey(path);
    const directory = await vfsRequest(store.get(key));
    if (directory) return directory;

    // Older VFS entries may have descendants without an explicit directory record.
    const firstChild = await vfsRequest(store.getKey(directoryRange(key)));
    return path === '/' || firstChild !== undefined ? { id: key, value: '' } : undefined;
  }

  async function requireEntry(store, path) {
    const record = await lookup(store, path);
    if (!record) fail('ENOENT', path);
    return record;
  }

  async function requireDirectory(store, path) {
    const record = await requireEntry(store, path);
    if (!record.id.endsWith('/')) fail('ENOTDIR', path);
    return record;
  }

  async function requireFile(store, path) {
    const record = await requireEntry(store, path);
    if (record.id.endsWith('/')) fail('EISDIR', path);
    return record;
  }

  async function verifyDestination(store, path, isDirectory) {
    const entry = await lookup(store, path);
    if (entry && entry.id.endsWith('/') !== isDirectory) {
      fail(isDirectory ? 'ENOTDIR' : 'EISDIR', path);
    }
    return entry;
  }

  async function transfer(src, dest, { move = false, recursive = false, overwrite = true } = {}) {
    const source = resolvePath('/', src);
    const target = resolvePath('/', dest);
    return write(async (store) => {
      const original = await requireEntry(store, source);
      const isDirectory = original.id.endsWith('/');
      if (source === target && move) return;
      if (source === target || (isDirectory && target.startsWith(directoryKey(source)))) {
        fail('EINVAL', target);
      }
      if (isDirectory && !recursive) fail('EISDIR', source);
      if (target === '/') fail('EBUSY', target);
      await requireDirectory(store, parent(target));
      const existing = await verifyDestination(store, target, isDirectory);
      if (existing && !overwrite) fail('EEXIST', target);
      if (move && existing && isDirectory) {
        const range = directoryRange(existing.id, true);
        if (await vfsRequest(store.getKey(range)) !== undefined) fail('ENOTEMPTY', target);
      }

      const targetKey = isDirectory ? directoryKey(target) : target;
      await vfsRequest(store.put({ ...original, id: targetKey }));
      if (isDirectory) {
        const records = await vfsRequest(store.getAll(directoryRange(original.id)));
        for (const record of records) {
          if (record.id === original.id) continue;
          const id = targetKey + record.id.slice(original.id.length);
          if (existing) {
            const directory = id.endsWith('/');
            await verifyDestination(store, directory ? id.slice(0, -1) : id, directory);
          }
          await vfsRequest(store.put({ ...record, id }));
        }
      }
      if (move) {
        await vfsRequest(store.delete(isDirectory ? directoryRange(original.id) : original.id));
      }
    });
  }

  return {
    resolvePath,
    fileValue,

    stat(path) {
      return read(async (store) => {
        const record = await requireEntry(store, resolvePath('/', path));
        const isDirectory = record.id.endsWith('/');
        return {
          isDirectory,
          size: isDirectory ? 0 : record.value instanceof Blob ? record.value.size : bytes(record.value).byteLength,
          mode: record.mode ?? (isDirectory ? 0o755 : 0o644),
          mtime: new Date(record.mtime ?? 0)
        };
      });
    },

    async readBytes(path) {
      const { value } = await read((store) => requireFile(store, resolvePath('/', path)));
      return value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : bytes(value);
    },

    write(path, data, { append: appendData = false, exclusive = false, mode = 0o644 } = {}) {
      const key = resolvePath('/', path);
      const value = typeof data === 'string' ? data : fileValue(data);
      return write(async (store) => {
        await requireDirectory(store, parent(key));
        const existing = await lookup(store, key);
        if (existing && exclusive) fail('EEXIST', key);
        if (existing?.id.endsWith('/')) fail('EISDIR', key);
        const contents = appendData && existing ? append(existing.value, value) : value;
        await vfsRequest(store.put({ id: key, value: contents, mode: existing?.mode ?? mode, mtime: Date.now() }));
      });
    },

    mkdir(path, { recursive = false, mode = 0o755 } = {}) {
      const key = resolvePath('/', path);
      return write(async (store) => {
        if (key === '/') {
          if (!recursive) fail('EEXIST', key);
          return;
        }
        const parts = key.slice(1).split('/');
        const directories = recursive
          ? parts.map((_, index) => '/' + parts.slice(0, index + 1).join('/'))
          : [key];
        if (!recursive) await requireDirectory(store, parent(key));
        for (const directory of directories) {
          const existing = await lookup(store, directory);
          if (existing) {
            if (!recursive) fail('EEXIST', directory);
            if (!existing.id.endsWith('/')) fail('ENOTDIR', directory);
          } else {
            await vfsRequest(store.add({ id: directoryKey(directory), value: '', mode, mtime: Date.now() }));
          }
        }
      });
    },

    readdir(path) {
      return read(async (store) => {
        const { id } = await requireDirectory(store, resolvePath('/', path));
        const keys = await vfsRequest(store.getAllKeys(directoryRange(id)));
        return [...new Set(keys.filter((key) => key !== id).map((key) => key.slice(id.length).split('/')[0]))];
      });
    },

    rm(path, { recursive = false, force = false } = {}) {
      const key = resolvePath('/', path);
      return write(async (store) => {
        if (key === '/') fail('EBUSY', key);
        const record = await lookup(store, key);
        if (!record) {
          if (!force) fail('ENOENT', key);
          return;
        }
        const isDirectory = record.id.endsWith('/');
        if (isDirectory && !recursive) {
          const range = directoryRange(record.id, true);
          if (await vfsRequest(store.getKey(range)) !== undefined) fail('ENOTEMPTY', key);
        }
        await vfsRequest(store.delete(isDirectory ? directoryRange(record.id) : record.id));
      });
    },

    cp(src, dest, options) {
      return transfer(src, dest, options);
    },

    mv(src, dest, { overwrite = true } = {}) {
      return transfer(src, dest, { move: true, recursive: true, overwrite });
    },

    setMetadata(path, { mode, mtime }) {
      return write(async (store) => {
        const record = await requireEntry(store, resolvePath('/', path));
        await vfsRequest(store.put({ ...record, mode: mode ?? record.mode, mtime: mtime ?? record.mtime }));
      });
    }
  };
}

// Handle the database upgrade event
openRequest.onupgradeneeded = function (event) {
  const db = event.target.result;
  // Check if the object store exists before creating it
  if (!db.objectStoreNames.contains('keyValueStore')) {
    db.createObjectStore('keyValueStore', { keyPath: 'id' });
  }
};

// Handle the successful opening of the database
openRequest.onsuccess = function (event) {
  db = event.target.result;

  // The next character after '/' bounds the range to keys with this directory prefix.
  const directoryRange = (path, descendantsOnly = false) =>
    IDBKeyRange.bound(path, `${path.slice(0, -1)}0`, descendantsOnly, true);

  // Define the vfs object with methods to interact with the database
  const vfs = {
    fileSystem: createVfsFileSystem(db, directoryRange),
    put: function (key, value, { expectedValue } = {}) {
      return vfsTransaction(db, 'readwrite', async (store) => {
        const previous = await vfsRequest(store.get(key));
        if (expectedValue !== undefined && previous?.value !== expectedValue) {
          throw new Error('The file changed or was removed while you were editing.');
        }
        await vfsRequest(store.put({ ...previous, id: key, value, mtime: Date.now() }));
      });
    },
    getasync: function (key) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['keyValueStore'], 'readonly');
        const store = transaction.objectStore('keyValueStore');
        const getRequest = store.get(key);
        getRequest.onsuccess = function (event) {
          // Check if the key exists before resolving the promise
          if (event.target.result) {
            resolve(event.target.result.value);
          } else {
            reject('Key not found');
          }
        };
        getRequest.onerror = function (event) {
          reject(event.target.errorCode);
        };
      });
    },
    get: async function (key) {
      return await this.getasync(key);
    },
    // the following methods all consider that keys are paths and have their proper shape:
    // - a path must have a leading slash
    // - a path ending with a slash is considered a directory
    // - a path not ending with a slash is considered a file
    // - directories cannot be created or removed directly,
    // - creating a file creates also the parent directory, removing all files removes the directory.
    touch: function (path) {
      // Create a file at the specified path.
      if (!path.startsWith('/') || path === '') {
        throw new Error('Invalid path');
      }
      const transaction = db.transaction(['keyValueStore'], 'readwrite');
      const store = transaction.objectStore('keyValueStore');
      const putRequest = store.put({ id: path, value: '' });
      putRequest.onsuccess = function (event) {
        console.log(`File created at ${path}`);
      };
      putRequest.onerror = function (event) {
        console.error(`Error creating file at ${path}: ${event.target.errorCode}`);
      };
    },
    rm: function (path) {
      if (!path.startsWith('/')) throw new Error('Invalid path');
      return vfsTransaction(db, 'readwrite', async (store) => {
        await vfsRequest(store.delete(path));
      });
    },
    cp: function (srcPath, destPath) {
      if (!srcPath.startsWith('/') || !destPath.startsWith('/')) throw new Error('Invalid path');
      return vfsTransaction(db, 'readwrite', async (store) => {
        const source = await vfsRequest(store.get(srcPath));
        await vfsRequest(store.put({ ...(source || { value: {} }), id: destPath }));
      });
    },
    mv: function (srcPath, destPath) {
      if (!srcPath.startsWith('/') || !destPath.startsWith('/')) throw new Error('Invalid path');
      return vfsTransaction(db, 'readwrite', async (store) => {
        const source = await vfsRequest(store.get(srcPath));
        await vfsRequest(store.delete(srcPath));
        await vfsRequest(store.put({ ...(source || { value: {} }), id: destPath }));
      });
    },
    applyDiff: async function (path, diffText) {
      if (!path.startsWith('/') || path === '' || path.endsWith('/')) {
        throw new Error('Invalid file path');
      }
      if (typeof diffText !== 'string') {
        throw new Error('Invalid diff');
      }
      return vfsTransaction(db, 'readwrite', async (store) => {
        const record = await vfsRequest(store.get(path));
        if (!record) throw 'Key not found';
        const next = applyUnifiedDiff(String(record.value || ''), diffText);
        await vfsRequest(store.put({ ...record, value: next, mtime: Date.now() }));
        return next;
      });
    },
    ls: function (path) {
      if (!path.endsWith('/')) {
        throw new Error('Invalid directory path');
      }
      return vfsTransaction(db, 'readonly', async (store) => {
        const keys = await vfsRequest(store.getAllKeys(directoryRange(path)));
        return keys.map((key) => key.slice(path.length));
      });
    },
    normalizeDirPath: function (path) {
      if (!path || path === '/') {
        return '/';
      }
      if (!path.startsWith('/')) {
        throw new Error('Invalid directory path');
      }
      return path.endsWith('/') ? path : `${path}/`;
    },
    parentDir: function (path) {
      if (!path || path === '/') {
        return '/';
      }
      if (!path.startsWith('/')) {
        throw new Error('Invalid path');
      }
      if (path.endsWith('/')) {
        return this.normalizeDirPath(path);
      }
      const index = path.lastIndexOf('/');
      return index <= 0 ? '/' : path.substring(0, index + 1);
    },
    baseName: function (path) {
      if (!path || path === '/') {
        return '';
      }
      const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
      const parts = trimmed.split('/').filter(Boolean);
      return parts[parts.length - 1] || '';
    },
    mkdir: async function (path) {
      const dirPath = this.normalizeDirPath(path);
      await this.put(dirPath, '');
      return dirPath;
    },
    readFolderTree: function (path) {
      const folder = this.normalizeDirPath(path);
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('keyValueStore', 'readonly');
        const request = transaction.objectStore('keyValueStore').getAll(directoryRange(folder));
        request.onsuccess = () => resolve(request.result
          .filter(({ id }) => id !== folder)
          .map(({ id, value }) => ({ path: id.slice(folder.length), value })));
        request.onerror = () => reject(request.error);
      });
    },
    addFolderTree: function (name, entries) {
      // Pick a free root name and write the complete tree in the same transaction.
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('keyValueStore', 'readwrite');
        const store = transaction.objectStore('keyValueStore');
        const request = store.getAllKeys(directoryRange('/'));
        let folder;
        let writeError;

        transaction.oncomplete = () => resolve(folder);
        transaction.onabort = () => reject(writeError || transaction.error || new Error('Unable to save the folder.'));

        request.onsuccess = () => {
          const rootNames = new Set(request.result.map((key) => key.split('/')[1]));
          let availableName = name;
          for (let number = 2; rootNames.has(availableName); number += 1) {
            availableName = `${name} (${number})`;
          }
          folder = `/${availableName}/`;
          try {
            store.add({ id: folder, value: '' });
            for (const { path, value } of entries) {
              store.add({ id: folder + path, value });
            }
          } catch (error) {
            writeError = error;
            transaction.abort();
          }
        };
      });
    },
    deleteTree: async function (path) {
      if (!path || !path.startsWith('/')) {
        throw new Error('Invalid path');
      }
      const range = path.endsWith('/') ? directoryRange(path, path === '/') : path;
      await vfsTransaction(db, 'readwrite', (store) => vfsRequest(store.delete(range)));
    },
    moveTree: async function (srcPath, destDir) {
      if (!srcPath || !srcPath.startsWith('/')) {
        throw new Error('Invalid source path');
      }
      const targetDir = this.normalizeDirPath(destDir);
      const isFolder = srcPath.endsWith('/');
      const name = this.baseName(srcPath);
      if (!name) {
        return srcPath;
      }
      const destPath = `${targetDir}${name}${isFolder ? '/' : ''}`;

      if (destPath === srcPath) {
        return destPath;
      }
      if (isFolder && targetDir.startsWith(srcPath)) {
        throw new Error('Cannot move a folder into itself.');
      }

      await vfsTransaction(db, 'readwrite', async (store) => {
        const source = isFolder ? directoryRange(srcPath) : srcPath;
        const keys = await vfsRequest(store.getAllKeys(source));
        if (!keys.length) throw new Error('Source entry no longer exists.');
        if (isFolder && srcPath.startsWith(destPath)) {
          // Moving /a/a/ into / can reuse source keys. Move the shorter keys out first.
          keys.sort((first, second) => first.length - second.length);
        }
        if (targetDir !== '/' && !await vfsRequest(store.getKey(targetDir))) {
          await vfsRequest(store.put({ id: targetDir, value: '' }));
        }
        for (const key of keys) {
          const record = await vfsRequest(store.get(key));
          record.id = destPath + key.slice(srcPath.length);
          await vfsRequest(store.put(record));
          await vfsRequest(store.delete(key));
        }
      });
      return destPath;
    },
    cat: function (path) {
      // Display the contents of a file at the specified path.
      if (path.endsWith('/')) {
        throw new Error('Invalid file path');
      }
      const transaction = db.transaction(['keyValueStore'], 'readonly');
      const store = transaction.objectStore('keyValueStore');
      const getRequest = store.get(path);
      getRequest.onsuccess = function (event) {
        console.log(event.target.result ? event.target.result.value : '');
      };
      getRequest.onerror = function (event) {
        console.error(`Error getting file at ${path}: ${event.target.errorCode}`);
      };
    },
    find: function (pattern) {
      // Search for files or directories matching a specified pattern.
      const transaction = db.transaction(['keyValueStore'], 'readonly');
      const store = transaction.objectStore('keyValueStore');
      const cursorRequest = store.openCursor();
      const matches = [];
      cursorRequest.onsuccess = function (event) {
        const cursor = event.target.result;
        if (cursor) {
          if (new RegExp(pattern).test(cursor.key)) {
            matches.push(cursor.key);
          }
          cursor.continue();
        } else {
          console.log(matches.join('\n'));
        }
      };
      cursorRequest.onerror = function (event) {
        console.error(`Error finding pattern ${pattern}: ${event.target.errorCode}`);
      };
    },

    du: function () {
      // Show the disk usage of files and directories.
      const transaction = db.transaction(['keyValueStore'], 'readonly');
      const store = transaction.objectStore('keyValueStore');
      let totalSize = 0;

      return new Promise((resolve, reject) => {
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = function (event) {
          const cursor = event.target.result;
          if (cursor) {
            const keyLength = cursor.key ? cursor.key.length : 0;
            const valueLength = cursor.value ? cursor.value.length : 0;
            if (!isNaN(keyLength) && !isNaN(valueLength)) {
              totalSize += keyLength + valueLength;
            }
            cursor.continue();
          } else {
            resolve(totalSize);
          }
        };
        cursorRequest.onerror = function (event) {
          reject(`Error getting disk usage: ${event.target.errorCode}`);
        };
      });
    },
    df: function () {
      // Show the amount of disk space used and available on the file system.
      if (navigator.storage && navigator.storage.estimate) {
        return navigator.storage.estimate().then((estimate) => {
          const quota = Number.isFinite(estimate.quota) ? estimate.quota : 0;
          const usage = Number.isFinite(estimate.usage) ? estimate.usage : 0;
          const available = Math.max(0, quota - usage);
          return { quota, usage, available };
        });
      }
      return Promise.reject('Storage estimate not available');
    },
    grep: function (path, pattern) {
      // Search for a pattern in file content at the specified path.
      if (!path.startsWith('/') || path === '') {
        throw new Error('Invalid path');
      }
      const transaction = db.transaction(['keyValueStore'], 'readonly');
      const store = transaction.objectStore('keyValueStore');
      const getRequest = store.get(path);
      getRequest.onsuccess = function (event) {
        const content = event.target.result ? event.target.result.value : '';
        if (new RegExp(pattern).test(content)) {
          console.log(`${path}: ${content}`);
        }
      };
      getRequest.onerror = function (event) {
        console.error(`Error getting file at ${path}: ${event.target.errorCode}`);
      };
    }
  };

  globalThis.vfs = vfs;
  if (vfsReadyResolve) vfsReadyResolve(vfs);
};

// Handle errors when opening the database
openRequest.onerror = function (event) {
  console.error('Error opening database:', event.target.errorCode);
  if (vfsReadyReject) vfsReadyReject(event.target.errorCode);
};
