import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pyodide.mjs";

const PYODIDE_INDEX = "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/";
const MODULES = [
  ["package.py", "__init__.py"],
  ["browser_api.py", "browser_api.py"],
  ["errors.py", "errors.py"],
  ["history.py", "history.py"],
  ["linting.py", "linting.py"],
  ["models.py", "models.py"],
  ["provenance.py", "provenance.py"],
  ["repository.py", "repository.py"],
  ["resolver.py", "resolver.py"],
];

let runtimePromise;

self.onmessage = async (event) => {
  const { id, type, files = {}, args = {} } = event.data;
  try {
    const pyodide = await boot();
    await syncProject(pyodide, files);
    const result = await invoke(pyodide, type, args);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: normalizeError(error) });
  }
};

async function boot() {
  if (!runtimePromise) runtimePromise = initialize();
  return runtimePromise;
}

async function initialize() {
  const pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX });
  await pyodide.loadPackage("pyyaml");

  const sources = {};
  await Promise.all(MODULES.map(async ([sourceName, runtimeName]) => {
    const response = await fetch(`./python/resume_tool/${sourceName}`);
    if (!response.ok) throw new Error(`Could not load browser Python module ${sourceName}.`);
    sources[`resume_tool/${runtimeName}`] = await response.text();
  }));

  pyodide.globals.set("runtime_sources_json", JSON.stringify(sources));
  await pyodide.runPythonAsync(`
import json
import pathlib
import sys
runtime = pathlib.Path('/runtime')
runtime.mkdir(parents=True, exist_ok=True)
for relative, text in json.loads(runtime_sources_json).items():
    path = runtime / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')
if str(runtime) not in sys.path:
    sys.path.insert(0, str(runtime))
from resume_tool import browser_api
`);
  return pyodide;
}

async function syncProject(pyodide, files) {
  pyodide.globals.set("project_files_json", JSON.stringify(files));
  await pyodide.runPythonAsync(`
import json
import pathlib
import shutil
project = pathlib.Path('/project')
if project.exists():
    shutil.rmtree(project)
project.mkdir(parents=True)
for relative, text in json.loads(project_files_json).items():
    path = project / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')
`);
}

async function invoke(pyodide, type, args) {
  pyodide.globals.set("browser_args_json", JSON.stringify(args));
  const expressions = {
    inspect: `
import json
_args = json.loads(browser_args_json)
browser_api.inspect_project('/project', _args.get('overlay'))
`,
    resolve: `
import json
_args = json.loads(browser_args_json)
browser_api.resolve_project('/project', _args['overlay'])
`,
    createRelease: `
import json
_args = json.loads(browser_args_json)
browser_api.create_browser_release(
    '/project',
    _args['overlay'],
    _args['releaseId'],
    _args['description'],
    _args['createdAt'],
    _args['sourceCommit'],
    _args['rendererVersion'],
    _args['pdfSha256'],
)
`,
    createSubmission: `
import json
_args = json.loads(browser_args_json)
browser_api.create_submission_yaml(
    _args['submissionId'],
    _args['releaseId'],
    _args['submittedAt'],
    _args['destination'],
    _args['purpose'],
    _args.get('context'),
    _args.get('url'),
    _args.get('note'),
)
`,
  };
  const expression = expressions[type];
  if (!expression) throw new Error(`Unknown engine operation: ${type}`);
  return pyodide.runPythonAsync(expression);
}

function normalizeError(error) {
  const text = error?.message || String(error);
  const lines = text.split("\n").filter(Boolean);
  return lines.at(-1)?.replace(/^resume_tool\.errors\.ResumeError:\s*/, "") || text;
}
