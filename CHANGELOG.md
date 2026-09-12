# Changelog

## 0.2.1

- Add read-only status with archived tab provenance and an actual extension protocol/version handshake; status does not open the panel.
- Expose associated form labels and bounded non-sensitive control values/states so snapshots can verify edits; reject refs when resolved destinations or option definitions change.
- Route user links and metadata through isolated extension messages with Chrome document verification; retire unauthenticated page messages and MAIN window.open interception.
- Allow revoking all trusted origins; remove deployment-specific origin constants. Companion extension version is 0.2.1.
- Reload only the selected iframe and preserve background form state.
- Add configurable connection handshake timeout and sandboxed real-extension regression evidence.

- Add Agent snapshot, click, text, choose and scroll commands for the actual visible iframe, with document-scoped refs and bounded output.
- Replace the dedicated-tab/debugger worker with Chrome document-identity routing; remove debugger permission.
- Add configurable trusted DSH origins and an extension options page; extension manifest version is 0.2.1.
- Add DOM, message-isolation, options and real Chromium extension integration tests, including cancellation before dispatch and settings revocation during binding. Cancellation remains best effort after dispatch.
- Reject snapshot refs when a recycled DOM element's label, role or link has changed.

- Open ordinary HTTP(S) chat-link clicks in the current conversation browser, reusing existing tabs.
- Preserve modified clicks, downloads, internal navigation and the explicit external-browser action.
- Add link-routing and listener-disposal regression coverage.

## 0.1.1 - 2026-09-09

- Publish the existing local plugin as an independent MIT Git repository.
- Add repository metadata and portable installation instructions.
- Preserve existing runtime behavior and documented limitations.
- Replace local source dependencies with published exact DSH versions.
