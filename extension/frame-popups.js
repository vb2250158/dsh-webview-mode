/**
 * MAIN-world window.open routing is retired: site scripts can forge its messages.
 * This file is not injected. Real user anchor links use frame-links.js in the
 * isolated world and the worker's document-identity-checked runtime channel.
 * Script-created popups retain the iframe sandbox's native blocking behavior.
 */
