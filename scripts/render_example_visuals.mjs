/** Render repo-native SVG drawings and optional PNG upload copies. No external service. */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = path.join(root, 'scripts', '.example-renderer.mjs');
await build({ entryPoints: [path.join(root,'scripts/example_visual_templates.tsx')], outfile: temporary, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' } });
try {
  const { operationSvg, diagramSvg } = await import(pathToFileURL(temporary).href);
  const inputIndex = process.argv.indexOf('--data');
  const input = inputIndex >= 0 ? path.resolve(root, process.argv[inputIndex + 1]) : path.join(root, 'data/demo.json');
  const data = JSON.parse(await readFile(input, 'utf8'));
  const directory = path.join(root, 'public/examples');
  await mkdir(directory, { recursive: true });
  const style = `<style>.mech-body{fill:#dce5d5;stroke:#7d9470;stroke-width:1.5;stroke-linejoin:round}.mech-hole{fill:#f7faf2;stroke:#849b76;stroke-width:1.5}.mech-machining{fill:none;stroke:#9bae8d;stroke-width:1}.mech-axis{fill:none;stroke:#a8b99a;stroke-width:.9;stroke-dasharray:13 4 2 4}.mech-datum{fill:none;stroke:#6e8860;stroke-width:3}.mech-pitch{fill:none;stroke:#9eaf8e;stroke-width:1;stroke-dasharray:7 5}.mech-selected{fill:#99d3bc66;stroke:#17846e;stroke-width:3}.mech-active-line{stroke:#168372;stroke-width:3;fill:none}.mech-thread-line{fill:none;stroke:#91a581;stroke-width:1.2}.mech-measure{stroke:#168372;stroke-width:2;fill:none}.mech-extension{stroke:#50a18a;stroke-width:1;fill:none;stroke-dasharray:5 3}.mech-reference-plane,.mech-surface-plane{stroke:#729b77;stroke-width:1.3;stroke-dasharray:6 4;fill:none}.mech-floor-plane{stroke:#b6b79a;stroke-width:1;stroke-dasharray:4 4;fill:none}.mech-small-text{font-family:sans-serif;font-size:12px;letter-spacing:.6px;fill:#90a37f;stroke:none}.mech-label-text{font-family:sans-serif;font-size:11px;fill:#4e9276;stroke:none}.mech-footer-text{font-family:sans-serif;font-size:9px;letter-spacing:1px;fill:#a2b28f}.mech-dimension-label rect{fill:#fbfff7;stroke:#b4d7bb;stroke-width:1}.mech-dimension-label text{font-family:monospace;font-size:18px;font-weight:600;fill:#26836b;stroke:none}.mech-trace-dot{fill:#168372;stroke:#e5f8e8;stroke-width:2}.mech-flatness-band{fill:#69bb952e;stroke:none}.mech-gage-shaft{fill:#b2c6b0;stroke:#6f967c;stroke-width:1.4}.mech-gage-handle{fill:#396d59;stroke:#2a5947;stroke-width:1.5}.mech-gage-member{fill:#77b2a0dd;stroke:#3b8d74;stroke-width:1.3}.mech-gage-grip{fill:none;stroke:#b7d5c0;stroke-width:1.1}.mech-gage-lead{fill:#c5d4bba8;stroke:#81a17d;stroke-width:1.2;stroke-dasharray:3 2}.mech-full-form-plane{fill:none;stroke:#066e5a;stroke-width:3}.mech-sleeve{fill:#e2e7ce;stroke:#9aab7e;stroke-width:1.2}.sketch-callout path{stroke:#8aa48e;fill:none;stroke-width:1}.sketch-callout circle{fill:#f6faf0;stroke:#6c9378;stroke-width:1.3}.sketch-callout text{fill:#376750;stroke:none;font:11px monospace;text-anchor:middle}.sketch-callout.selected circle{fill:#26745f}.sketch-callout.selected text{fill:white}.sketch-heading{font:12px sans-serif;fill:#3f6250}.sketch-note{font:10px sans-serif;fill:#738774}.sketch-label{font:12px sans-serif;fill:#55715b}.sketch-dimension{font:12px monospace;fill:#168372}</style>`;
  const sharpSource = process.env.PARTCENTRAL_SHARP_MODULE;
  const sharp = process.argv.includes('--png') ? (await import(sharpSource ? pathToFileURL(sharpSource).href : 'sharp')).default : null;
  let count = 0;
  for (const part of [...data.parts, ...(data.revisionExamples || []).filter(part => part.references?.modelAvailable)]) {
    for (const [kind, make] of [['sketch', operationSvg], ['diagram', diagramSvg]]) {
      let svg = make(part);
      if (!svg.includes('viewBox="0 0 1120 690"') && !svg.includes('viewBox="0 0 900 570"')) throw new Error(`Expected a complete drawing for ${part.number} ${kind}, not a placeholder.`);
      svg = svg.replace(/class="mech-thread-gage" style="[^"]*--gage-stop:([0-9.]+)px[^"]*"/g, 'class="mech-thread-gage" transform="translate(0 $1)"').replace(/class="mech-depth-probe" style="[^"]*--probe-stop:([0-9.]+)px[^"]*"/g, 'class="mech-depth-probe" transform="translate(0 $1)"');
      if (!svg.includes('xmlns=')) svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
      svg = svg.replace(/(<svg[^>]*>)/, `$1${style}`);
      const basename = `${part.number}-${part.revision.code}-${kind}`;
      await writeFile(path.join(directory, `${basename}.svg`), svg);
      if (sharp) await sharp(Buffer.from(svg), { density: 145 }).resize({ width: 1680 }).png().toFile(path.join(directory, `${basename}.png`));
      count++;
    }
  }
  console.log(`Rendered ${count} local synthetic SVG references${sharp ? ' and PNG upload copies' : ''}.`);
} finally { await unlink(temporary).catch(() => {}); }
