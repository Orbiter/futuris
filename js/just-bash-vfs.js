// Adapt the public VFS API to just-bash's IFileSystem interface.
function createJustBashFileSystem(vfs) {
  const files = vfs.fileSystem;
  const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });
  const encodingOf = (options) => typeof options === 'string' ? options : options?.encoding;
  const byteString = (bytes) => {
    let result = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return result;
  };

  function encode(content, options) {
    if (typeof content !== 'string') return content;
    switch (encodingOf(options)) {
      case 'ascii':
      case 'binary':
      case 'latin1':
        return Uint8Array.from(content, (character) => character.charCodeAt(0) & 255);
      case 'base64':
        return Uint8Array.from(atob(content), (character) => character.charCodeAt(0));
      case 'hex':
        return Uint8Array.from(content.match(/[\da-f]{2}/gi) || [], (pair) => parseInt(pair, 16));
      default:
        return content;
    }
  }

  async function stat(path) {
    const entry = await files.stat(path);
    return { ...entry, isFile: !entry.isDirectory, isSymbolicLink: false };
  }

  function unsupported(path) {
    throw Object.assign(new Error(`ENOTSUP: links are unavailable in the VFS: ${path}`), { code: 'ENOTSUP' });
  }

  return {
    async readFile(path, options) {
      const bytes = await files.readBytes(path);
      switch (encodingOf(options)) {
        case 'ascii': return byteString(bytes.map((byte) => byte & 127));
        case 'binary':
        case 'latin1': return byteString(bytes);
        case 'base64': return btoa(byteString(bytes));
        case 'hex': return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        default: return utf8.decode(bytes);
      }
    },
    readFileBuffer: files.readBytes,
    writeFile: (path, content, options) => files.write(path, encode(content, options)),
    appendFile: (path, content, options) => files.write(path, encode(content, options), { append: true }),
    async exists(path) {
      try {
        await files.stat(path);
        return true;
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    },
    stat,
    lstat: stat,
    async realpath(path) {
      const normalized = files.resolvePath('/', path);
      await files.stat(normalized);
      return normalized;
    },
    mkdir: files.mkdir,
    createExclusive(path, { directory, mode }) {
      return directory ? files.mkdir(path, { mode }) : files.write(path, '', { exclusive: true, mode });
    },
    readdir: files.readdir,
    rm: files.rm,
    cp: files.cp,
    mv: files.mv,
    resolvePath: files.resolvePath,
    getAllPaths: () => [],
    chmod: (path, mode) => files.setMetadata(path, { mode }),
    utimes: (path, _atime, mtime) => files.setMetadata(path, { mtime: mtime.getTime() }),
    async symlink(_target, path) { unsupported(path); },
    async link(_source, path) { unsupported(path); },
    async readlink(path) {
      await files.stat(path);
      throw Object.assign(new Error(`EINVAL: ${path}`), { code: 'EINVAL' });
    }
  };
}
