export const appPackage = {
  key: "terraform-runner",
  name: "Terraform Runner",
  description: "Build and run Terraform commands from a guided UI",
  version: "1.1.0",
  company: "Buildboard Labs",
  developerEmail: "infra@buildboard.example",
  artifacts: [
    "./infra/.terraform",
    "./infra/.terraform.lock.hcl",
    "./infra/terraform.tfstate",
    "./infra/terraform.tfstate.backup",
    "./infra/.terraform.tfstate.lock.info",
  ],
  async onDeregister() {
    const endpoint = "http://127.0.0.1:8787/terraform/cleanup";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artifacts: this.artifacts }),
    });

    const raw = await response.text();
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      // Keep body empty if response is not JSON.
    }

    if (!response.ok) {
      const detail = body.error || raw || "Cleanup endpoint failed.";
      throw new Error(detail);
    }

    const removed = Array.isArray(body.removed) ? body.removed.join(", ") : "";
    return removed
      ? `Removed artifacts: ${removed}`
      : "Cleanup completed.";
  },
  render(container) {
    container.innerHTML = `
      <section class="panel app-view">
        <header class="panel-header">
          <h2>Terraform Runner</h2>
          <p>Compose Terraform commands and run them locally or through a remote endpoint.</p>
        </header>
        <div class="placeholder-card">
          <h3>Run Terraform</h3>
          <p>Local mode uses a local bridge service on your machine.</p>
          <p>Start local bridge: <code>node tools/local-terraform-runner.js</code></p>

          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0.7rem;margin-top:0.75rem;">
            <label style="display:flex;flex-direction:column;gap:0.3rem;">
              Workspace Path
              <input id="tf-workdir" type="text" value="./infra" placeholder="./infra" />
            </label>
            <label style="display:flex;flex-direction:column;gap:0.3rem;">
              Action
              <select id="tf-action">
                <option value="init">init</option>
                <option value="plan" selected>plan</option>
                <option value="apply">apply</option>
                <option value="destroy">destroy</option>
              </select>
            </label>
            <label style="display:flex;flex-direction:column;gap:0.3rem;">
              Vars File (optional)
              <input id="tf-vars" type="text" placeholder="terraform.tfvars" />
            </label>
            <label style="display:flex;flex-direction:column;gap:0.3rem;">
              Extra Arguments (optional)
              <input id="tf-extra" type="text" placeholder="-lock-timeout=60s" />
            </label>
            <label style="display:flex;flex-direction:column;gap:0.3rem;">
              Local Bridge URL
              <input id="tf-local-url" type="text" value="http://127.0.0.1:8787/terraform/run" />
            </label>
            <label style="display:flex;flex-direction:column;gap:0.3rem;">
              Remote Endpoint URL
              <input id="tf-endpoint" type="text" value="/api/terraform/run" placeholder="/api/terraform/run" />
            </label>
          </div>

          <div style="display:flex;gap:0.6rem;flex-wrap:wrap;margin-top:0.75rem;">
            <button id="tf-build" class="action-btn" type="button">Build Command</button>
            <button id="tf-run-local" class="action-btn" type="button">Run Locally</button>
            <button id="tf-run-remote" class="action-btn" type="button">Run Via Endpoint</button>
          </div>

          <p style="margin-top:0.75rem;"><strong>Command Preview</strong></p>
          <pre id="tf-command" style="white-space:pre-wrap;background:#f7f9fd;border:1px solid #d7dfed;border-radius:8px;padding:0.6rem;">terraform -chdir=./infra plan</pre>

          <p style="margin-top:0.75rem;"><strong>Result</strong></p>
          <pre id="tf-output" style="white-space:pre-wrap;background:#f7f9fd;border:1px solid #d7dfed;border-radius:8px;padding:0.6rem;">Ready.</pre>
        </div>
      </section>
    `;

    const workdirInput = container.querySelector("#tf-workdir");
    const actionSelect = container.querySelector("#tf-action");
    const varsInput = container.querySelector("#tf-vars");
    const extraInput = container.querySelector("#tf-extra");
    const localUrlInput = container.querySelector("#tf-local-url");
    const endpointInput = container.querySelector("#tf-endpoint");
    const buildBtn = container.querySelector("#tf-build");
    const runLocalBtn = container.querySelector("#tf-run-local");
    const runRemoteBtn = container.querySelector("#tf-run-remote");
    const commandPreview = container.querySelector("#tf-command");
    const output = container.querySelector("#tf-output");

    function parseExtraArgs(extra) {
      return extra
        .split(" ")
        .map((part) => part.trim())
        .filter(Boolean);
    }

    function buildPayload() {
      const workdir = (workdirInput.value || "./infra").trim();
      const action = actionSelect.value;
      const vars = (varsInput.value || "").trim();
      const extra = (extraInput.value || "").trim();

      const args = [`-chdir=${workdir}`, action];

      if (vars && action !== "init") {
        args.push(`-var-file=${vars}`);
      }

      if (action === "apply" || action === "destroy") {
        args.push("-auto-approve");
      }

      args.push(...parseExtraArgs(extra));

      const command = `terraform ${args.join(" ")}`;
      commandPreview.textContent = command;
      return { command, workdir, action, vars, extra, args };
    }

    async function runAgainst(url, label) {
      const endpoint = (url || "").trim();
      const payload = buildPayload();

      if (!endpoint) {
        output.textContent = `No ${label} URL provided.`;
        return;
      }

      output.textContent = `Running via ${label}...`;

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const raw = await response.text();
          let detail = raw;
          try {
            const parsed = JSON.parse(raw);
            detail = parsed.error || parsed.output || raw;
          } catch {
            // Leave detail as raw text.
          }
          output.textContent = [
            `Endpoint error: ${response.status} ${response.statusText}`,
            detail ? `Details:\n${detail}` : "",
            `Command:\n${payload.command}`,
          ]
            .filter(Boolean)
            .join("\n\n");
          return;
        }

        const data = await response.json();
        const text = typeof data.output === "string" ? data.output : JSON.stringify(data, null, 2);
        output.textContent = text || "Command executed, but no output was returned.";
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        output.textContent = [
          `Could not reach ${label}.`,
          `Error: ${msg}`,
          "",
          "You can still run this command manually:",
          payload.command,
        ].join("\n");
      }
    }

    buildBtn.addEventListener("click", () => {
      buildPayload();
      output.textContent = "Command updated.";
    });

    runLocalBtn.addEventListener("click", () => {
      void runAgainst(localUrlInput.value, "local bridge");
    });

    runRemoteBtn.addEventListener("click", () => {
      void runAgainst(endpointInput.value, "remote endpoint");
    });

    buildPayload();
  },
};

export default appPackage;
