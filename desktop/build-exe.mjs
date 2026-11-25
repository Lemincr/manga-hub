import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = process.env.RELEASE_TAG || `v${pkg.version || '1.0.0'}`;

const cscCandidates = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
];
const csc = cscCandidates.find((p) => fs.existsSync(p));
if (!csc) {
  throw new Error('Could not find Windows .NET csc.exe compiler.');
}

// 1) Generate multi-resolution icon.ico and icon.png
const genExe = path.join(root, 'desktop', 'gen-icon.exe');
const genCs = path.join(root, 'desktop', 'GenerateIcon.cs');
const outPng = path.join(root, 'client', 'public', 'icon.png');
const outIco = path.join(root, 'desktop', 'icon.ico');
const publicIco = path.join(root, 'client', 'public', 'favicon.ico');

execFileSync(csc, ['/nologo', '/optimize+', `/out:${genExe}`, '/r:System.dll', '/r:System.Drawing.dll', genCs], {
  stdio: 'inherit',
});
execFileSync(genExe, [outPng, outIco], { stdio: 'inherit' });
fs.copyFileSync(outIco, publicIco);
fs.rmSync(genExe, { force: true });
console.log(`Generated icon assets → ${outIco}, ${outPng}, ${publicIco}`);

// 2) Bundle backend into a self-contained ESM file (zero node_modules required at runtime)
const distDir = path.join(root, 'dist');
const serverBundle = path.join(distDir, 'server.mjs');
fs.mkdirSync(distDir, { recursive: true });
const esbuildBin = path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild');
const esbuildArgs = [
  path.join(root, 'server', 'index.ts'),
  '--bundle',
  '--minify',
  '--platform=node',
  '--target=node22',
  '--format=esm',
  '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  `--outfile=${serverBundle}`,
];
if (fs.existsSync(esbuildBin)) {
  execFileSync(process.execPath, [esbuildBin, ...esbuildArgs], { stdio: 'inherit' });
} else {
  execFileSync('npx', ['esbuild', ...esbuildArgs], { stdio: 'inherit', shell: true });
}
console.log(`Bundled standalone server → ${serverBundle}`);

// 3) Compile MangaHub.exe with embedded win32icon and manifest
const outExe = path.join(root, 'MangaHub.exe');
const buildExe = path.join(distDir, 'MangaHub.exe');
const srcCs = path.join(root, 'desktop', 'MangaHubLauncher.cs');
const manifest = path.join(root, 'desktop', 'app.manifest');

execFileSync(
  csc,
  [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    `/win32icon:${outIco}`,
    `/win32manifest:${manifest}`,
    `/out:${buildExe}`,
    '/r:System.dll',
    '/r:System.Drawing.dll',
    '/r:System.Net.Http.dll',
    '/r:System.Windows.Forms.dll',
    srcCs,
  ],
  { stdio: 'inherit' },
);

// 4) Sign MangaHub.exe with Authenticode code-signing certificate
const signScript = `
$ErrorActionPreference = 'Stop'
$cert = Get-ChildItem Cert:\\CurrentUser\\My -CodeSigningCert | Where-Object { $_.Subject -eq 'CN=Manga Hub' } | Select-Object -First 1
if (-not $cert) {
  $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=Manga Hub' -CertStoreLocation 'Cert:\\CurrentUser\\My' -NotAfter (Get-Date).AddYears(5)
}
$sig = Set-AuthenticodeSignature -FilePath '${buildExe.replace(/'/g, "''")}' -Certificate $cert -HashAlgorithm SHA256
Write-Host ("Authenticode status: " + $sig.Status + " (" + $cert.Thumbprint + ")")
`;
execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', signScript], {
  stdio: 'inherit',
});

// Copy signed executable to root if not currently locked by a running instance
try {
  fs.copyFileSync(buildExe, outExe);
  console.log(`Built & signed desktop executable → ${outExe}`);
} catch {
  console.log(`Note: ${outExe} is currently running; signed binary saved at ${buildExe}`);
}

// 5) Assemble portable self-contained zip (no terminal commands needed by users)
const releaseRoot = path.join(root, 'release');
const stageDir = path.join(releaseRoot, 'MangaHub');
const zipPath = path.join(releaseRoot, `MangaHub-${version}-win64.zip`);
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(path.join(stageDir, 'dist'), { recursive: true });
fs.mkdirSync(path.join(stageDir, 'client'), { recursive: true });

fs.copyFileSync(buildExe, path.join(stageDir, 'MangaHub.exe'));
fs.copyFileSync(serverBundle, path.join(stageDir, 'dist', 'server.mjs'));
fs.cpSync(path.join(root, 'client', 'dist'), path.join(stageDir, 'client', 'dist'), { recursive: true });
if (fs.existsSync(path.join(root, 'README.md'))) fs.copyFileSync(path.join(root, 'README.md'), path.join(stageDir, 'README.md'));
if (fs.existsSync(path.join(root, 'LICENSE'))) fs.copyFileSync(path.join(root, 'LICENSE'), path.join(stageDir, 'LICENSE'));

execFileSync(
  'powershell',
  [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force`,
  ],
  { stdio: 'inherit' },
);
console.log(`Packaged self-contained portable release → ${zipPath}`);
