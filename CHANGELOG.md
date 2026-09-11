# Changelog

## Unreleased

- Add Agent snapshot, click, text, choose and scroll commands for the actual visible iframe, with document-scoped refs and bounded output.
- Replace the dedicated-tab/debugger worker with Chrome document-identity routing; remove debugger permission.
- Add configurable trusted DSH origins and an extension options page; extension manifest version is 0.2.0.
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
