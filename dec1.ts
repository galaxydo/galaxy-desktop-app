import { WebUI } from "https://deno.land/x/webui@2.4.4/mod.ts";

import excalidrawAssets from './embed/excalidraw-assets/dir.ts';
import galaxyAssets from './embed/galaxy-assets/dir.ts';
import embedDefaultMacros from './embed/macros/dir.ts';
import { Embeds } from "./deno-embedder/embed.ts";
import { dynamicImport, importString } from "./dynamic-import/mod.ts";

const OPENAI_KEY = Deno.env.get("OPENAI_KEY");
const GOOGLE_KEY = Deno.env.get("GOOGLE_KEY");
const GALAXY_PATH = `${Deno.env.get("HOME")}/.galaxy`;

const galaxyWindow = new WebUI();

const loadAssets = (assets: Embeds<any>) => assets.list().map(async fit => {
  const afit = await assets.load(fit);
  const efit = await afit.bytes();
  return [fit, efit];
});

const files = await Promise.all([
  ...loadAssets(excalidrawAssets),
  ...loadAssets(galaxyAssets),
]);

console.log('Loaded files:', files.length);

const filesMap = new Map(files);

console.log('filesMap', ...filesMap.keys());

const macros = await registerMacrosAsync(`${GALAXY_PATH}/macros`);
const defaultFallbackMacro = 'FallbackAI.ts';
const defaultStartupMacro = 'Startup.ts';

console.log('Registered macros:', ...macros.keys());
console.assert(macros.has(defaultStartupMacro), 'should have startup macro');
console.assert(macros.has(defaultFallbackMacro), 'should have fallback macro');

galaxyWindow.setFileHandler((opts: URL) => {
  let { pathname } = opts;
  console.log('pathname', pathname)
  if (pathname.startsWith('/')) {
    pathname = pathname.substring(1);
  }
  const file = filesMap.get(pathname);
  console.log(pathname, file?.length);
  return file;
});

galaxyWindow.bind('execute', async (e: WebUI.Event) => {
  const arrowIds = e.args.map((arg) => arg.string());
  Promise.all(arrowIds.map(async (arrowId) => {
    const label = await galaxyWindow.script(`return window.helpers.getArrowById('${arrowId}');`);
    const code = macros.get(label) || macros.get(defaultFallbackMacro) || '';
    return executeInDeno(code.toString());
  })).then((res) => {
    console.log('Execution success:', res.length);
  }).catch((err) => {
    console.error('Execution failed:', err);
  });
  return true;
});

const index = await galaxyAssets.load('index.html').then(it => it.text());
console.log('indx', index.toString())
galaxyWindow.show(index);
await WebUI.wait();

galaxyWindow.run("alert('3')");
await executeInDeno(macros.get(defaultStartupMacro)?.toString() || '');
galaxyWindow.run("alert('4')");

async function registerMacrosAsync(macrosDir: string): Promise<Map<string, string>> {
  const registeredMacros = new Map<string, string>();

  let alreadyInitialized = false;
  
  try {
    const it = await Deno.stat(macrosDir);
    if (it.isDirectory) {
      alreadyInitialized = true;
    }
  } catch (_) {}

  console.log('macrosDir', macrosDir, alreadyInitialized);

  if (!alreadyInitialized) {
    try {
      await Deno.mkdir(macrosDir, { recursive: true });
      await Promise.all(
        embedDefaultMacros.list().map(fit => {
          return embedDefaultMacros.load(fit)
            .then(afit => afit.text())
            .then(tafit => Deno.writeTextFile(`${macrosDir}/${fit}`, tafit));
        })
      );
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        console.error(`Error creating directory: ${error.message}`);
        throw error;
      }
    }
  }

  for await (const entry of Deno.readDir(macrosDir)) {
    if (entry.isFile && entry.name.endsWith('.ts')) {
      try {
        const scriptContent = await Deno.readTextFile(`${macrosDir}/${entry.name}`);
        console.log(`Registering macro: ${entry.name}`);

        const functionNameMatch = scriptContent.match(/(async\s*)?function (\w+)/);
        if (!functionNameMatch) throw new Error('Invalid function format in script content. ' + entry.name);

        const asyncKeyword = functionNameMatch[1] || '';
        const functionName = functionNameMatch[2];
        let processedCode = scriptContent
          .replace(/\s+/g, ' ')
          .replace(/(async\s*)?function \w+/, `${asyncKeyword}function ${functionName}`)
          .replace(/import\(/g, 'dynamicImport(');
        processedCode = `export default ${processedCode}`;

        registeredMacros.set(entry.name, processedCode);
      } catch (err) {
        console.error(err)
      }
    }
  }

  return registeredMacros;
}

async function executeInDeno(code: string) {
  try {
    const { default: fn } = await importString(code, {
      parameters: {
        dynamicImport: (moduleName: string) => dynamicImport(moduleName, { force: true }),
        env: {
          galaxyPath: GALAXY_PATH,
          apiKey: OPENAI_KEY,
          googleKey: GOOGLE_KEY,
        },
        executeInWindow: (script: string) => {
          console.log('executeInWindow', script);
          return galaxyWindow.script('return "ok";');
        },
      }
    });

    console.log('Begin execution:', new Date(), code);
    await fn();
    console.log('Completed execution:', new Date(), fn.toString());
  } catch (err) {
    console.error('Execution error:', err);
    galaxyWindow.run(`ea.setToast({ message: "${err.toString()}" })`);
  }
}
