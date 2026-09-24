import {createHash} from 'node:crypto';
import {readFile, readdir, lstat, writeFile} from 'node:fs/promises';
import {posix} from 'node:path';

const fixedFiles = ['LICENSE', 'PROJECT_NOTICE.txt', 'README.md', 'package.json',
  'package-lock.json', 'scripts/build.mjs', 'scripts/source-archive.mjs',
  'third_party/runtime-notices.txt'];

async function sourceFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = posix.join(directory.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(path));
    else if (entry.isFile() && (path.endsWith('.js') || path.endsWith('.d.ts'))) result.push(path);
    else if (entry.isFile()) continue;
    else throw new Error(`Unsupported source entry: ${path}`);
  }
  return result;
}

function octal(header, offset, width, value) {
  const digits = value.toString(8).padStart(width - 1, '0');
  if (digits.length >= width) throw new Error('Source archive value exceeds USTAR field');
  header.write(digits + '\0', offset, width, 'ascii');
}

function entryHeader(path, size) {
  const name = Buffer.from(path, 'utf8');
  if (name.length > 100 || path.startsWith('/') || path.split('/').includes('..'))
    throw new Error(`Unsafe source archive path: ${path}`);
  const header = Buffer.alloc(512);
  name.copy(header);
  octal(header, 100, 8, 0o644);
  octal(header, 108, 8, 0);
  octal(header, 116, 8, 0);
  octal(header, 124, 12, size);
  octal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return header;
}

export async function writeSourceArchive(output) {
  const files = [...fixedFiles, ...await sourceFiles('src')].sort();
  const chunks = [];
  for (const path of files) {
    const stat = await lstat(path);
    if (!stat.isFile()) throw new Error(`Source archive entry is not a regular file: ${path}`);
    const bytes = await readFile(path);
    chunks.push(entryHeader(path, bytes.length), bytes,
      Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  const archive = Buffer.concat(chunks);
  await writeFile(output, archive);
  return {sha256: createHash('sha256').update(archive).digest('hex'), files};
}
