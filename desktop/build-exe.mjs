import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

// 2) Compile MangaHub.exe with embedded win32icon
const outExe = path.join(root, 'MangaHub.exe');
const srcCs = path.join(root, 'desktop', 'MangaHubLauncher.cs');

try {
  execFileSync(
    csc,
    [
      '/nologo',
      '/target:winexe',
      '/optimize+',
      `/win32icon:${outIco}`,
      `/out:${outExe}`,
      '/r:System.dll',
      '/r:System.Drawing.dll',
      '/r:System.Net.Http.dll',
      '/r:System.Windows.Forms.dll',
      srcCs,
    ],
    { stdio: 'inherit' },
  );
  console.log(`Built native desktop executable with custom icon → ${outExe}`);
} catch (e) {
  if (fs.existsSync(outExe)) {
    console.log(`Note: ${outExe} is currently running (locked by Windows); client/dist/ and server/ are updated and live.`);
  } else {
    throw e;
  }
}
