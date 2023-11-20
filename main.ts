import { WebUI } from "./deno-webui/mod.ts";
import { dynamicImport, importString } from './dynamic-import/mod.ts';
import { encodeHex } from "https://deno.land/std@0.202.0/encoding/hex.ts";
import { decodeBase64, encodeBase64 } from "https://deno.land/std@0.206.0/encoding/base64.ts";

const DEBUG = Deno.env.get("DEV");
const OPENAI_KEY = Deno.env.get("OPENAI_KEY");

const firstWindow = new WebUI({
  'clearCache': DEBUG ? true : false,
  'libPath': DEBUG ? './webui/dist/webui-2.dylib' : undefined,
});

// const secondWindow = new WebUI({

// })

// secondWindow.showBrowser.show('<html>second</html>');

firstWindow.setProfile('', '');

const GALAXY_PATH = `${Deno.env.get("HOME")}/.galaxy`;
const KV_PATH = `${GALAXY_PATH}/meta.json`;

// --- Directory and Metadata functions ---
async function ensureGalaxyDirectory() {
  try {
    await Deno.mkdir(GALAXY_PATH, { recursive: true });
    console.log(`Ensured directory exists: ${GALAXY_PATH}`);
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      console.log(`Directory already exists: ${GALAXY_PATH}`);
    } else {
      console.error(`Error creating directory: ${error.message}`);
      throw error;
    }
  }
}

async function storeMetaData(date: string) {
  await Deno.writeTextFile(KV_PATH, JSON.stringify({ lastDownloadDate: date }));
  console.log(`Stored metadata with date: ${date}`);
}

async function getLastDownloadDate(): Promise<Date | null> {
  try {
    const kvContent = await Deno.readTextFile(KV_PATH);
    const data = JSON.parse(kvContent);
    console.log(`Last download date from metadata: ${data.lastDownloadDate}`);
    return new Date(data.lastDownloadDate);
  } catch (error) {
    console.log("No previous download date found.");
    return null;
  }
}

// --- GitHub related functions ---
async function getLastCommitDate(user: string, repo: string): Promise<Date> {
  const url = `https://api.github.com/repos/${user}/${repo}/commits/main`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  if (!response.ok) {
    console.error(`Failed to fetch last commit date: ${response.statusText}`);
    throw new Error(`Failed to fetch last commit date: ${response.statusText}`);
  }
  const data = await response.json();
  return new Date(data.commit.committer.date);
}

async function loadFilesFromGitHubDirs(user: string, repo: string, dirList: string[]): Promise<MemoryFiles> {
  const files = new Map();
  const baseURL = `https://api.github.com/repos/${user}/${repo}/contents/`;

  for (const dir of dirList) {
    // Fetch the directory listing using GitHub API
    const response = await fetch(baseURL + dir, {
      headers: {
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch directory ${dir}: ${response.statusText}`);
    }

    const contents: { name: string, download_url: string }[] = await response.json();

    const fetchPromises: Promise<void>[] = contents.map(async (content) => {
      if (content.download_url) { // Ensure it's a file, not another directory or other type
        const fileResponse = await fetch(content.download_url);
        if (!fileResponse.ok) {
          throw new Error(`Failed to fetch ${content.download_url}: ${fileResponse.statusText}`);
        }
        const fileContent = await fileResponse.arrayBuffer(); //.text();
        files.set(content.name, new Uint8Array(fileContent));
      }
    });

    await Promise.all(fetchPromises);
  }

  return files;
}

async function fetchFilesFromGitHub() {
  console.log("Fetching files from GitHub...");
  return await loadFilesFromGitHubDirs('7flash',
    'galaxy-dist',
    ['', 'assets', 'excalidraw-assets']);
}

type MemoryFiles =
  Map<string, Uint8Array>;

async function saveFilesToLocal(files: MemoryFiles) {
  await ensureGalaxyDirectory();
  for (const [filename, content] of files.entries()) {
    await Deno.writeFile(`${GALAXY_PATH}/${filename}`, content);
  }
  console.log(`Saved ${files.size} files to ${GALAXY_PATH}`);
}

// --- File handling functions ---
async function loadFilesFromLocalDirectory(): Promise<MemoryFiles> {
  console.log("Loading files from local directory...");
  return await loadFilesAsync([GALAXY_PATH]);
}

async function loadFilesAsync(pathList: string[]): Promise<MemoryFiles> {
  const files = new Map();
  for (const path of pathList) {
    for await (const entry of Deno.readDir(path)) {
      if (entry.isFile) {
        const fileContent = await Deno.readFile(`${path}/${entry.name}`);
        console.log(entry.name, fileContent.length);
        files.set(entry.name, fileContent);
      }
    }
  }
  return files;
}

// Main Execution
(async () => {
  const lastDownloadDate = await getLastDownloadDate();
  let lastCommitDate;
  try {
    lastCommitDate = await getLastCommitDate('7flash', 'galaxy-dist');
  } catch (err) {
    console.log('skip', err);
  }


  if (!lastDownloadDate || lastCommitDate > lastDownloadDate) {
    const filesFromGitHub = await fetchFilesFromGitHub();
    await saveFilesToLocal(filesFromGitHub);
    const currentDate = new Date().toISOString();
    await storeMetaData(currentDate);
  }

  async function getFiles(): Promise<Map<string, Uint8Array>> {
    if (DEBUG) {
      console.log("Debug mode: Loading local files only...");
      return await loadFilesAsync([
        '../dist', '../dist/assets', '../dist/excalidraw-assets'
      ]);
    } else {
      const lastDownloadDate = await getLastDownloadDate();
      let lastCommitDate;
      try {
        lastCommitDate = await getLastCommitDate('7flash', 'galaxy-dist');
      } catch (err) {
        console.error('skip update', err);
      }
      if (!lastDownloadDate || lastCommitDate > lastDownloadDate) {
        const filesFromGitHub = await fetchFilesFromGitHub();
        await saveFilesToLocal(filesFromGitHub);
        const currentDate = new Date().toISOString();
        await storeMetaData(currentDate);
      }

      return await loadFilesFromLocalDirectory();
    }
  }

  const files = await getFiles();
  console.log(`Loaded ${files.size} files.`);

  firstWindow.setFileHandler(({ pathname }) => {
    if (pathname.startsWith("/public")) {
      pathname = pathname.replace("/public", "");
    }

    const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
    if (files.has(filename)) {
      console.log('has ', filename, files.get(filename).length);
      return files.get(filename);
    } else {
      console.error(`Unknown file request: ${filename}`);
      if (filename.endsWith('.jpg') || filename.endsWith('.png')) {
        const engineId = 'stable-diffusion-xl-1024-v1-0'
        const apiHost = Deno.env.get('API_HOST') ?? 'https://api.stability.ai'
        const apiKey = Deno.env.get('STABILITY_API_KEY')

        if (!apiKey) throw new Error('Missing Stability API key.')

        async function anit() {
          const response = await fetch(
            `${apiHost}/v1/generation/${engineId}/text-to-image`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                text_prompts: [
                  {
                    text: `An image on website with name "${filename}"`,
                  },
                ],
                cfg_scale: 7,
                height: 1024,
                width: 1024,
                steps: 30,
                samples: 1,
              }),
            }
          )

          if (!response.ok) {
            throw new Error(`Non-200 response: ${await response.text()}`)
          }

          interface GenerationResponse {
            artifacts: Array<{
              base64: string
              seed: number
              finishReason: string
            }>
          }

          const responseJSON = (await response.json()) as GenerationResponse

          responseJSON.artifacts.forEach((image, index) => {
            // Deno.writeTextFile(filename, image.base64);
            // fs.writeFileSync(
            //   `./out/v1_txt2img_${index}.png`,
            //   Buffer.from(image.base64, 'base64')
            // )
            // Convert Base64 string to a Buffer
            // console.log('image', image.base64);

            // const buffer = Deno.Buffer.from(image.base64, 'base64');

            // Convert the Buffer to Uint8Array
            // const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length);
            // console.log(image.base64.substr(0, 10));
            const manit = decodeBase64(image.base64)

            // const mit = Buffer.from(image.base64, 'base64');
            files.set(filename, manit);

            console.log('generated ' + filename);
          })
        }
        anit().then(console.log).catch(console.error);

      }
      throw 'Unknown file ' + filename;
    }
  });

  firstWindow.bind('setMemoryFile', async (e: WebUI.Event) => {
    try {
      // const bit = e.arg.string(0);
      const cit = e.arg.string(0);
      const lit = e.arg.string(1);
      const rit = e.arg.string(2);

      const messageBuffer = new TextEncoder().encode(cit);
      const hashBuffer = await crypto.subtle.digest("SHA-256", messageBuffer);
      const bit = encodeHex(hashBuffer);

      const acit = new TextEncoder().encode(cit);
      // const hasher = createHash("md5");
      // hasher.update(cit);
      // const bit = hasher.toString();
      files.set(bit + '.' + lit, acit);

      console.log(new Date(), 'setMemoryFile', bit, cit.length, rit);

      await firstWindow.script(`return window.webuiCallbacks["${rit}"]("${bit}")`);
    } catch (err) {
      console.error('setMemoryFile', err);
      firstWindow.script(`ea.setToast({ message: "${err.toString()}" })`);
    }
  });

  firstWindow.bind('executeDeno', (e: WebUI.Event) => {
    async function nov16() {
      try {
        let rawCode = e.arg.string(0);
        // console.log('rawCode ', rawCode);
        const input = e.arg.string(1);
        // console.log('input ', input);
        const taskId = e.arg.string(2);
        console.log('taskId ', taskId);
        // Extract function details from the rawCode
        const functionNameMatch = rawCode.match(/(async\s*)?function (\w+)/);
        if (!functionNameMatch) {
          throw new Error('Invalid function format in rawCode.');
        }
        const asyncKeyword = functionNameMatch[1] || '';
        const functionName = functionNameMatch[2];

        rawCode = rawCode.replace(/\s+/g, ' ');
        // Modify rawCode
        rawCode = rawCode.replace(/(async\s*)?function \w+/, `${asyncKeyword}function ${functionName}`);
        rawCode = `export default ${rawCode}`;
        rawCode = rawCode.replace(/import\(/g, 'dynamicImport(');

        // Use importString to get the module, passing dynamicImport as a parameter
        const { default: fn } = await importString(rawCode, {
          parameters: {
            dynamicImport: (moduleName) => dynamicImport(moduleName, {
              force: true,
            }),
            input: JSON.parse(input),
            firstWindow,
            galaxyPath: GALAXY_PATH,
            modules: {},
            decodeBase64,
            encodeBase64,
            apiKey: OPENAI_KEY,
            encodeHex,
          }
        });

        console.log('begin execution', new Date())
        const result = await fn();
        console.log('completed execution', new Date());

        // console.log("result executeDeno", result);

        const response = { result };
        const serializedResponse = JSON.stringify(response)
          .replace(/\\/g, '\\\\') // Escape backslashes
          .replace(/'/g, "\\'")   // Escape single quotes
          .replace(/"/g, '\\"')   // Escape double quotes
          .replace(/`/g, '\\`')   // Escape backticks
          .replace(/\$/g, '\\$'); // Escape dollar signs (for template literals)

        await firstWindow.run(`return window.webuiCallbacks["${taskId}"]('${serializedResponse}')`);
      } catch (err) {
        console.error('executeDeno error', err);
        firstWindow.run(`ea.setToast({ message: "${err.toString()}" })`);
      }
    }
    nov16().catch(console.error);
    return 'ok';
  });

  // note, it's temporary binding until the issue resolved
  // https://github.com/webui-dev/webui/issues/231
  firstWindow.bind('saveScene', async (inputData) => {
    try {
      let { sceneName, sceneData } = JSON.parse(inputData.data);

      // console.log(sceneName, sceneData);

      const kvBlob = await import('https://deno.land/x/kv_toolbox@0.0.4/blob.ts');

      const kv = await Deno.openKv();
      const blob = new TextEncoder().encode(sceneData);
      // await kvBlob.set(kv, ["layers", sceneName], blob);
      // await kv.close();

      // await new Promise(resolve => setTimeout(resolve, 1000));
      // const blob = '';
      return { success: true, } // data: `saved size ${blob.length}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  firstWindow.bind('executePython', async (pythonCode: string) => {
    if (typeof pythonCode !== 'string') {
      return { success: false, error: 'Invalid Python code provided' };
    }

    const process = Deno.run({
      cmd: ["python", "-c", pythonCode],
      stdout: "piped",
      stderr: "piped"
    });

    try {
      const { code } = await process.status();
      const [rawOutput, rawError] = await Promise.all([process.output(), process.stderrOutput()]);

      const errorStr = new TextDecoder().decode(rawError);
      const outputStr = new TextDecoder().decode(rawOutput);

      if (code !== 0 || errorStr) {
        return {
          success: false,
          error: `Python process exited with code ${code}. Error: ${errorStr.trim()}`
        };
      }

      return { success: true, data: outputStr.trim() };

    } catch (error) {
      return { success: false, error: `Execution error: ${error.message}` };

    } finally {
      // Clean up resources
      process.stdout.close();
      process.stderr.close();
      process.close();
    }
  });

  try {
    await firstWindow.show('./dist/index.html');

    await firstWindow.script(`
async function waitForIt(selector) {
  while (true) {
    const it = document.querySelector(selector);
    if (it) {
        return it;
    } else {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

async function doIt() {
while (!window.ea) {
          await new Promise(resolve => setTimeout(resolve, 500));  
      }
      
      ea.updateScene({
    elements: [{...window.convertToExcalidrawElements([{ type: 'frame', name: 'now', x: 0, y: 0, width: 100, height: 100 }])[0], customData: { macros: { save: true, open: true, publish: true } }}]
})

ea.updateScene({ appState: { selectedElementIds: {[ea.getSceneElements()[0].id]: true} } })

await waitForIt('[data-testid="macro-button-open"]').then(it => it.click())

await waitForIt('[data-testid="modal-input"]').then(it => {
      it.value = 'now';
       it.dispatchEvent(new Event('change', { bubbles: true }));
})

await waitForIt('[data-testid="modal-button"]').then(it => it.click())

ea.scrollToContent();
}

doIt();
      `)
  } catch (err) {
    console.error('err', err);
  }

  console.assert(firstWindow.isShown, true)

  let mux = false;

  async function saveScene(sceneName) {
    if (mux) return;
    mux = true;
    try {
      //       const globalFrame = JSON.parse(await firstWindow.script(`return window.convertToExcalidrawElements([{ type: 'frame' }])[0]`));
      // await firstWindow.script(
      //         `ea.updateScene({ elements: [
      //     ...ea.getSceneElements().filter(it => it.id && it.id != globalFrame.id).map(it => {
      //         it.frameId = '${globalFrame.id}';
      //         return it;
      //     }), ${JSON.stringify(globalFrame)}]
      // })`
      //       )
      //       await firstWindow.script(`const globalFrame = ${JSON.stringify(globalFrame)};
      //         return ga.executeMacro('save', globalFrame, globalFrame)`)
      let bufferSize = await firstWindow.script('return JSON.stringify(window.ea.getSceneElements()).length.toString();');
      bufferSize *= 4;
      bufferSize += 4;
      const els = JSON.parse(await firstWindow.script(`return JSON.stringify(window.ea.getSceneElements());`, { bufferSize: Number.parseInt(bufferSize) + 1 }));
      const encoder = new TextEncoder();

      const fileIds = [...new Set(els.filter(function(it) { return it.type === 'image'; }).map(function(it) { return it.fileId; }))];

      for (var i = 0; i < fileIds.length; i++) {
        var fileId = fileIds[i];
        let existingOne = false;
        try {
          await Deno.stat(GALAXY_PATH + '/' + fileId + '.png');
          existingOne = true;
        } catch (_) { }
        if (existingOne) continue;
        try {
          let bufferSize = await firstWindow.script('return window.ea.getFiles()["' + fileId + '"].dataURL.length;');
          bufferSize *= 4;
          bufferSize += 4;

          var fileDataURL = await firstWindow.script('return window.ea.getFiles()["' + fileId + '"].dataURL;', { bufferSize: Number.parseInt(bufferSize) + 1 });

          var base64Index = fileDataURL.indexOf(';base64,');
          if (base64Index === -1) {
            throw new Error('Base64 data not found in data URL');
          }
          var base64Data = fileDataURL.substring(base64Index + 8);

          var decodedData = decodeBase64(base64Data);

          var fileType = fileDataURL.substring(11, base64Index);

          await Deno.writeFile(GALAXY_PATH + '/' + fileId + '.' + fileType, decodedData);

          console.log('auto save', fileId);
        } catch (error) {
          console.error('Error saving image with fileId:', fileId, error);
        }
      }

      var sceneData = JSON.stringify({ elements: els.filter(it => it.name != 'now') }, null, 2);
      await Deno.writeTextFile(GALAXY_PATH + '/' + sceneName + '.json', sceneData);
    } catch (err) {
      console.error('saveScene', err);
    }
    mux = false;
  }

  function decodeBase64(base64) {
    const binaryString = window.atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  setInterval(() => {
    saveScene('now')
      .catch(console.error);
  }, 60 * 1000);

  await WebUI.wait();
})();
