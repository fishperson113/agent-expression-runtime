# Codex Desktop capability host

This host gives the existing Native conversation access to Fisch's expression engine and prepares the same default Codex observer as `fisch live`. Camera remains off until the user enables it and grants browser permission. It does not launch a private coding TUI, project Desktop transcripts or provide speech recognition. Existing explicit observer-off/provider/budget settings and usage history remain authoritative.

1. Run `fisch desktop` in a terminal. This prepares the normal Live browser and loopback gateway. Keep it running.
2. On first use, review the token-free `[mcp_servers.fisch]` configuration printed by that command and add it using Codex's supported MCP configuration workflow. Fisch does not edit application configuration or folder trust. `fisch desktop --mcp-config` can print the same configuration without starting a body.
3. Connect the configured MCP server from Codex Desktop. Its `fisch mcp` process connects only to the already-running body; it never bootstraps or reopens the browser.

The MCP launcher requires host-provided thread binding before mutation (`FISCH_MCP_REQUIRE_THREAD=1`). The binding contract must be installed alongside this host. A shared session identifier is not a conversation identifier. Desktop dictation must submit into the actual connected conversation; this increment does not establish that workflow or claim Windows microphone acceptance.

The printed `env_vars` allowlist preserves the non-secret user-data location through Codex's restricted STDIO child environment. The host and Native application must receive the same `XDG_DATA_HOME` on Linux (or `LOCALAPPDATA` on Windows); forwarding a name cannot supply a value missing from the Native process. A terminal-only custom override is not automatically inherited by an already-running Desktop app. No credential variables are forwarded by this configuration.

## Runtime capability and lifecycle

The camera/perception/render loop and one-flight observer scheduler run independently of Native MCP calls. Structured geometric events can trigger an observer reply and bounded expression; replies appear in Fisch's observation log, not as forged messages in the Native conversation. Quotas, cooldown, stale-result checks, protected user geometry, public-context quiet TTL and one-use handoff remain in effect. No second gateway controller is created for the observer.

Mutating MCP operations pass an authenticated bounded begin/end fence. The begin acknowledgement follows renderer revocation before the MCP operation is forwarded. Pending observer output loses both caption and motion when the intent changes. Unknown fence settlement pauses the observer conservatively; it does not claim a canonical Native terminal cancellation. Read-only status and foreign/unbound calls do not acquire mutation leases.

Native owns record → review transcript → send. The recognized text is consumed once by that Native conversation. Fisch neither records audio nor resubmits the transcript. MCP exposes tools and thread routing, not every user/speech event: priority starts at the known MCP boundary, not speech-start or the earlier send click. Native may publish an explicitly bounded `observerContext` public brief/quiet request through existing expression tools, and `observe` can read browser-confirmed observer replies. That brief is not a transcript or inferred private task context.

The host keeps an ephemeral loopback pairing capability in `fisch/desktop-live` under the OS user-data directory (Linux XDG data/home fallback, macOS Application Support, Windows LocalAppData). This is an engine-local token, not Codex authentication. Unlike the memory-only Tauri pairing path, this CLI handoff uses a private runtime file so separately started MCP children can connect. It is passed to the server only in its child environment, never printed or included in configuration.

On POSIX, the runtime directory/lock are owner-private mode 0700 and files 0600; ownership, file types and symlinks are checked. Windows uses the user's standard data location; POSIX mode checks do not establish Windows ACL isolation. No Windows hardware or Desktop integration acceptance is implied.

An exclusive lock prevents another host from taking over. Missing host fails `desktop_host_not_running`; malformed, unsafe or unowned state fails closed. Abnormal exits may leave a lock: inspect the owning process before manually removing stale state. There is no automatic takeover, ledger reset or credential migration.

Closing the browser, pressing its Stop control, or stopping the host closes the gateway and removes only that instance's runtime record. MCP EOF/signals close the child server. Stopping the body does not claim to cancel inference already running inside Codex Desktop. A later MCP invocation cannot restart a stopped host.

Reloading or leaving the browser page also stops this host. Run `fisch desktop` deliberately to start a new body, then reconnect the Desktop MCP server; refresh never silently resumes an old controller or expression. A refresh may show a browser navigation-aborted message because the host closes its owned browser.

## Validation boundary

Unit tests cover private registry ownership, corruption, symlinks, no-clobber publication, process liveness, host cleanup and raw stdio forwarding. CLI tests cover static configuration and missing-host failure without dependency/bootstrap output. The earlier one-turn Native capability control on `0aa25d6` verified binding, model-authored rendering and Stop; it did not run the unified observer or Desktop application/Dictate. Unified deterministic and actual-model results must be reported separately. Windows, speech recognition and natural UX remain unverified.

## Frozen unified control plan (not an executed result)

After exact-head CI passes, run one session in the existing authenticated writable-home Cloud with at most one external Native turn and one observer reservation, 180 seconds total, zero outcome retries, camera/microphone off. Use production `runDesktopHost`, actual stdio MCP and generated environment allowlist; use a synthetic source through production ingestion. Preserve all existing ledgers and record exact source/policy/catalog/schema hashes.

The external Native prompt is: “Mình muốn cùng Fisch nghĩ một câu chuyện ngắn về một hòn đảo biết bay. Hãy dùng body để góp một ý hình ảnh tự chọn, chia sẻ một public brief ngắn cho observer và cho phép nó góp một hình một lần trong 60 giây nếu thích. Đừng nhận diện cảm xúc hoặc bịa dữ liệu camera; không dùng âm thanh.” This is an elicited setup, not spontaneous behavior acceptance. Do not prescribe a shape, color, caption or gesture mapping. Wait for its terminal and bounded user lease, then ingest one stable synthetic arrival. Keep the source stable until observer settles; record retain as valid rather than retrying for art.

Check model-free races separately: delay observer output, acquire an MCP mutation fence before forwarding, verify neither stale caption nor motion publishes after the acknowledged barrier. Check protected geometry, public quiet/expiry, Stop, ledger preservation and no transcript `turn/start` duplication. Actual-model evidence must distinguish both Native thread IDs, model-authored payloads, reservation/dispatch counts, rendered phases, caption history and unknown receipts. This control cannot establish actual Desktop Dictate or full repository coding MAIN.
