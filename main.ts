import { WebUI } from "./deno-webui/mod.ts";
import { dynamicImport, importString } from './dynamic-import/mod.ts';

const DEBUG = Deno.env.get("DEV");

const firstWindow = new WebUI({
  'clearCache': DEBUG ? true : false,
  'libPath': DEBUG ? './webui/dist/webui-2.dylib' : undefined,
});

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
      throw 'Unknown file ' + filename;
    }
  });
  firstWindow.bind('executeDeno', async (inputData) => {
    // Defer the task execution to allow the binding to return immediately.
    setTimeout(async () => {
      let { code: rawCode, input, taskId } = JSON.parse(inputData.data);

      try {
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

        console.log('rawCode', rawCode);

        // Use importString to get the module, passing dynamicImport as a parameter
        const { default: fn } = await importString(rawCode, { parameters: {
          dynamicImport: (moduleName) => dynamicImport(moduleName, {
            force: true,
          }),
          input
        } });

        const result = await fn();
        const denoResult = { success: true, data: result };

        firstWindow.run(`window.ga.executeCallback('${taskId}', ${JSON.stringify(denoResult)})`);
      } catch (error) {
        const denoResult = { success: false, error: error.toString() };
        firstWindow.run(`window.ga.executeCallback('${taskId}', ${JSON.stringify(denoResult)})`);
      }
    }, 0);

    // Return true to indicate the task has been scheduled.
    return true;
  });
  // note, it's temporary binding until the issue resolved
  // https://github.com/webui-dev/webui/issues/231
  firstWindow.bind('saveScene', async (inputData) => {
    try {
      let { sceneName, sceneData } = JSON.parse(inputData.data);

      // const kv = await Deno.openKv();
      // const blob = new TextEncoder().encode(sceneData);
      // await set(kv, ["layers", sceneName], blob);
      // await kv.close();

      await new Promise(resolve => setTimeout(resolve, 1000));
      const blob = '';
      return { success: true, data: `saved size ${blob.length}` };
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
  } catch (err) {
    console.error('err', err);
  }

  console.assert(firstWindow.isShown, true)

  await WebUI.wait();
})();
