import { WebUI } from "https://deno.land/x/webui@2.4.3/mod.ts";

import excalidrawAssets from './embed/excalidraw-assets/dir.ts';
import galaxyAssets from './embed/galaxy-assets/dir.ts';
import { Embeds } from "./deno-embedder/embed.ts";
import { dynamicImport, importString } from "./dynamic-import/mod.ts";

import * as windowScripts from './window-scripts/index.ts';
import * as denoMacros from './deno-macros';

// TODO: a new tool should show metadata including added macros and linked anchored elements
// similarly as selecting (v) allows to see and edit styling of elements,
// metadata tool should allow to see and edit custom data,
// and should show buttons corresponding to execute macros scripts

const OPENAI_KEY = Deno.env.get("OPENAI_KEY");
const GOOGLE_KEY = Deno.env.get("GOOGLE_KEY");
const GALAXY_PATH = `${Deno.env.get("HOME")}/.galaxy`;

// const macros = await registerMacrosAsync('./macros');

const galaxyWindow = new WebUI();

const loadAssets = (assets: Embeds<any>) => assets.list().map(async fit => {
  const afit = await assets.load(fit);
  const efit = await afit.bytes();
  return [fit, efit];
})

const files = await Promise.all([
  ...loadAssets(excalidrawAssets),
  ...loadAssets(galaxyAssets),
])

console.log('files', files.length);

const filesMap = new Map<string, Uint8Array>();

for (const fit of files) {
  filesMap.set(fit[0] as string, fit[1] as Uint8Array);
}

console.log('filesMap', ...filesMap.keys())

const macros = await registerMacrosAsync('./macros');

galaxyWindow.setFileHandler((opts: URL) => {
  let { pathname } = opts;
  if (pathname.startsWith('/')) {
    pathname = pathname.substring(1);
  }
  const file = filesMap.get(pathname);
  console.log(pathname, file?.length);
  return file;
})

galaxyWindow.bind('execute', async (e: WebUI.Event) => {
  // Extract arguments
  const arrowIds: string[] = [];
  let hasMore = true;
  let argIdx = 0;
  while (hasMore) {
    try {
      const it = e.arg.string(argIdx++);
      arrowIds.push(it);
    } catch (_) {
      hasMore = false;
    }
  }
  Promise.all(arrowIds.map(execute)).then(res => {
    console.log('execute success', res.length);
  }).catch(err => {
    console.error('execute failed', err);
  });
  return true;

});

galaxyWindow.show('index.html');
await WebUI.wait();

async function registerMacrosAsync(macrosDir: string): Promise<Map<string, string>> {
  const registeredMacros = new Map<string, string>();

  for await (const entry of Deno.readDir(macrosDir)) {
    if (entry.isFile && entry.name.endsWith('.ts')) {
      const scriptContent = await Deno.readTextFile(`${macrosDir}/${entry.name}`);
      console.log(`Registering macro: ${entry.name}`);

      try {
        const functionNameMatch = scriptContent.match(/(async\s*)?function (\w+)/);
        if (!functionNameMatch) {
          throw new Error('Invalid function format in scriptContent.');
        }

        const asyncKeyword = functionNameMatch[1] || '';
        const functionName = functionNameMatch[2];

        let processedCode = scriptContent
          .replace(/\s+/g, ' ')
          .replace(/(async\s*)?function \w+/, `${asyncKeyword}function ${functionName}`)
          .replace(/import\(/g, 'dynamicImport('); // Assuming dynamicImport is defined elsewhere
        processedCode = `export default ${processedCode}`;

        registeredMacros.set(entry.name, processedCode);
      } catch (error) {
        console.error(`Error processing macro ${entry.name}:`, error);
      }
    }
  }
  return registeredMacros;
}

async function executeInWindow(fn: Function, ...args: string[]) {
  const str = `return (${fn.toString()})(${args.join(',')})`
  return galaxyWindow.script(str)
}

async function executeInDeno(arrowId: string) {
  try {
    // const label = await executeInWindow(windowScripts.get('getArrowLabel'), arrowId);
    const label = await executeInWindow(windowScripts., arrowId);
    let code;
    if (denoMacros.has(label)) {
      code = denoMacros.get(label)!;
    } else {
      code = denoMacros.get('fallback')!;
    }
    const { default: fn } = await importString(code, {
      parameters: {
        dynamicImport: (moduleName: string) => dynamicImport(moduleName, { force: true }),
        env: {
          galaxyPath: GALAXY_PATH,
          apiKey: OPENAI_KEY,
          googleKey: GOOGLE_KEY,
        },
        scripts: {
          // get Input, output, label
          // set Output Text, Image, rearrange
        },
        script,
      }
    });
    console.log('begin execution', new Date());
    const result = await fn();
    console.log('completed execution', new Date());
  } catch (err) {
    console.error('execute error', err);
    galaxyWindow.run(`ea.setToast({ message: "${err.toString()}" })`);
  }
}
