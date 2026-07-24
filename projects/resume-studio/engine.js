export class ResumeEngine {
  constructor(repository) {
    this.repository = repository;
    this.worker = new Worker(new URL("./engine-worker.js", import.meta.url), { type: "module" });
    this.nextId = 1;
    this.pending = new Map();
    this.worker.onmessage = (event) => {
      const { id, ok, result, error } = event.data;
      const request = this.pending.get(id);
      if (!request) return;
      this.pending.delete(id);
      if (ok) request.resolve(result);
      else request.reject(new Error(error));
    };
  }

  async inspect(overlay = null) {
    return JSON.parse(await this.call("inspect", { overlay }));
  }

  async resolve(overlay) {
    return JSON.parse(await this.call("resolve", { overlay }));
  }

  async createRelease(args) {
    return this.call("createRelease", args);
  }

  async createSubmission(args) {
    return this.call("createSubmission", args);
  }

  async call(type, args) {
    const id = this.nextId++;
    const files = await this.repository.engineSnapshot();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, files, args });
    });
  }
}
