# Linux validation through WSL2

Normal use on Windows, Linux or macOS is `npm start`. The commands below are for reproducible Linux validation without mixing Windows and Linux dependencies.

This machine's only WSL distro is Docker Desktop's internal distro. Validation therefore uses a Debian Linux container on its WSL2 backend, with the repository mounted read-only and copied into `/work` inside Linux. No toolchain is installed into the internal Docker distro. No credentials or Windows `node_modules`/Rust target files are copied.

From the repository root:

```powershell
docker build -t aer-linux-validation -f scripts/linux.Dockerfile scripts
docker run --name aer-linux-check --init --shm-size=1g --mount "type=bind,source=C:\workspace\agent-expression-runtime,target=/source,readonly" aer-linux-validation sh /source/scripts/validate-linux.sh
```

The validation script installs the locked npm dependencies, builds the frontend and native Linux gateway, runs JavaScript/Rust tests and exercises the real gateway/browser/MCP bridge using system Chromium. `CHROME_PATH` selects that browser; Playwright browser downloads are unnecessary. The Linux binary is `/work/src-tauri/target/debug/agent-expression-runtime` inside the validation container. It requires the platform runtime libraries, including GTK/WebKit.

Successful validation writes `/work/docs/evidence/linux-validation.json`. Browser evidence generated inside the container stays separate from Windows evidence. This validates headless Linux rendering and the gateway; it does not certify a native WebView desktop window, macOS execution or human perception of effort parameters.
