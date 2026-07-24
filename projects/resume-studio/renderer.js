import { $typst } from "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-all-in-one.ts@0.7.0/dist/esm/index.js";

export const BROWSER_RENDERER_VERSION = "typst.ts-web 0.7.0";

export class BrowserTypstRenderer {
  constructor() {
    this.queue = Promise.resolve();
  }

  async svg(template, resume, document) {
    return this.serial(() => this.render("svg", template, resume, document));
  }

  async pdf(template, resume, document) {
    return this.serial(() => this.render("pdf", template, resume, document));
  }

  async render(format, template, resume, document) {
    const payload = { ...resume, document };
    $typst.resetShadow();
    await $typst.addSource("/resume.json", JSON.stringify(payload));
    const options = { mainContent: template, inputs: { data: "/resume.json" } };
    if (format === "svg") return $typst.svg(options);
    return $typst.pdf(options);
  }

  serial(operation) {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

export function previewDocument(resume, overlay) {
  return {
    title: `${resume.profile.name} Resume`,
    description: `Preview built from overlay ${overlay}`,
    keywords: ["resume", "preview", overlay],
  };
}
