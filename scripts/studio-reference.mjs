// Checkout referensi yang dipin dan jalankan contoh upstream secara lokal.
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const which = process.argv[2];
const refs = {
  shotcraft: {repo: 'https://github.com/Vincentwei1021/video-shotcraft.git', dir: 'shotcraft-source', sha: '43bd349a136651865ecfa6ea1cf012f6e957d304', sparse: ['references', 'assets/lib', 'demos/typography/blur-slide', 'demos/_fixtures'], port: 3003},
  toolkit: {repo: 'https://github.com/digitalsamba/claude-code-video-toolkit.git', dir: 'toolkit-source', sha: 'da3f474c1230d161be1384ef97aec27f73b11636', sparse: ['lib', '.claude/skills/remotion', 'examples/hello-world'], port: 3002},
};
const ref = refs[which];
if (!ref) throw new Error('Pilih shotcraft atau toolkit.');
const checkout = path.join(root, '.cache', ref.dir);
const writeCachePreview = (dir, name, contents) => {
  const cacheRoot = path.resolve(root, '.cache');
  const cachePreviewPath = path.resolve(dir, name);
  const relative = path.relative(cacheRoot, cachePreviewPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Preview harus berada di .cache proyek.');
  writeFileSync(cachePreviewPath, contents);
};
const run = (exe, args, cwd = checkout) => {
  const r = spawnSync(exe, args, {cwd, stdio: 'inherit', shell: process.platform === 'win32' && exe === 'npm.cmd'});
  if (r.status !== 0) throw new Error(`${exe} gagal (${r.status}).`);
};
if (!existsSync(path.join(checkout, '.git'))) {
  mkdirSync(path.dirname(checkout), {recursive: true});
  run('git', ['clone', '--filter=blob:none', '--no-checkout', '--depth=1', ref.repo, checkout], root);
  run('git', ['sparse-checkout', 'set', ...ref.sparse]);
  run('git', ['fetch', '--depth=1', 'origin', ref.sha]);
  run('git', ['checkout', '--detach', ref.sha]);
}
const head = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: checkout, encoding: 'utf8'});
if (head.status !== 0 || head.stdout.trim() !== ref.sha) throw new Error(`Checkout ${checkout} berbeda dari commit dokumentasi. Tidak diubah otomatis.`);

let cwd = checkout;
let entry;
if (which === 'shotcraft') {
  entry = 'preview.tsx';
  writeCachePreview(checkout, entry, `import React from 'react';\nimport {Composition, registerRoot} from 'remotion';\nimport {BlurSlide, BLUR_SLIDE_DURATION} from './demos/typography/blur-slide/BlurSlide';\nconst Root = () => <Composition id="ShotcraftBlurSlide" component={BlurSlide} width={1920} height={1080} fps={30} durationInFrames={BLUR_SLIDE_DURATION}/>;\nregisterRoot(Root);\n`);
} else {
  cwd = path.join(checkout, 'examples', 'hello-world');
  const packageFile = path.join(cwd, 'package.json');
  const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));
  const installed = existsSync(path.join(cwd, 'node_modules', 'remotion', 'package.json'));
  if (!installed || pkg.dependencies?.remotion !== '4.0.539') {
    run('npm.cmd', ['install', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', 'remotion@4.0.539', '@remotion/cli@4.0.539', '@remotion/paths@4.0.539', '@remotion/shapes@4.0.539', '@remotion/transitions@4.0.539'], cwd);
  }
  // Berkas khusus launcher; konfigurasi upstream tetap dipertahankan.
  writeCachePreview(cwd, 'preview.config.ts', `import {Config} from '@remotion/cli/config';\nimport path from 'node:path';\nConfig.overrideWebpackConfig(config => ({...config, resolve:{...config.resolve, alias:{...config.resolve?.alias, react:path.resolve('node_modules/react'), 'react-dom':path.resolve('node_modules/react-dom'), remotion:path.resolve('node_modules/remotion')}}}));\n`);
}
const cli = path.join(which === 'toolkit' ? cwd : root, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
const args = [cli, 'studio', ...(entry ? [entry] : []), '--no-open', `--port=${ref.port}`, ...(which === 'toolkit' ? ['--config=preview.config.ts'] : [])];
console.log(`Preview ${which}: http://localhost:${ref.port}`);
const child = spawn(process.execPath, args, {cwd, stdio: 'inherit'});
child.on('exit', code => process.exit(code ?? 1));
