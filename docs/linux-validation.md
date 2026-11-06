# Linux validation through WSL2

Normal use on Windows, Linux or macOS is `fisch run`. The commands below are for reproducible Linux validation without mixing Windows and Linux dependencies.

This machine's only WSL distro is Docker Desktop's internal distro. Validation therefore uses a Debian Linux container on its WSL2 backend, with the repository mounted read-only and copied into `/work` inside Linux. No toolchain is installed into the internal Docker distro. No credentials or Windows `node_modules`/Rust target files are copied.

From the repository root:

```powershell
docker build -t aer-linux-validation -f scripts/linux.Dockerfile scripts
docker run --name aer-linux-check --init --shm-size=1g --mount "type=bind,source=C:\workspace\agent-expression-runtime,target=/source,readonly" aer-linux-validation sh /source/scripts/validate-linux.sh
```

The validation script installs the locked npm dependencies, links the Fisch CLI, runs `fisch build` and `fisch test` and exercises the real gateway/browser/MCP bridge using system Chromium. `CHROME_PATH` selects that browser; Playwright browser downloads are unnecessary. The Linux binary is `/work/src-tauri/target/debug/agent-expression-runtime` inside the validation container. It requires the platform runtime libraries, including GTK/WebKit.

Successful validation writes `/work/docs/evidence/linux-validation.json`. Browser evidence is generated inside the container before selected results are exported to the repository. This validates headless Linux rendering and the gateway; it does not certify a native WebView desktop window, macOS execution or human perception of effort parameters.

Recorded validation: Fisch 0.1.0, Node 22.23.4, Cargo 1.99.1, Debian x86_64 on WSL2 kernel 5.15.167.4. `fisch build`, `fisch test`, 83 JavaScript tests, 11 Rust tests and the real browser/gateway/MCP smoke passed. The exported Linux ELF engine is `.runtime/linux/fisch-engine`; its hash and build evidence are in [the validation report](evidence/linux-validation.json). Current browser screenshots were refreshed from this Linux run. Windows also passed `fisch build` and `fisch test` with the same test counts. Codex model authentication and a real-model conversation are not part of this automated validation.
