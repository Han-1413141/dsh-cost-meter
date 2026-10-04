import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
assert.ok(process.env.DSH_TEST_NODE_MODULES, "Set DSH_TEST_NODE_MODULES to host test dependencies with react, react-dom and jsdom");
const fromHost = createRequire(resolve(process.env.DSH_TEST_NODE_MODULES, "__credential_test.cjs"));
const { JSDOM } = await import(pathToFileURL(fromHost.resolve("jsdom")).href);
const dom = new JSDOM('<!doctype html><html><head></head><body><input id="host-search" type="text" value="existing-session-search"><div id="root"></div></body></html>', { url: "https://example.test" });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import(pathToFileURL(fromHost.resolve("react")).href);
const { act: legacyAct } = await import(pathToFileURL(fromHost.resolve("react-dom/test-utils")).href);
const act = React.act ?? legacyAct;
const { createRoot } = await import(pathToFileURL(fromHost.resolve("react-dom/client")).href);
const rootDir = fileURLToPath(new URL("../", import.meta.url));
const source = readdirSync(rootDir + "/src/client").filter((n) => n.endsWith(".js")).sort().map((n) => readFileSync(rootDir + "/src/client/" + n, "utf8")).join("");
let factory;
window.__ModuleLoader__ = { load: (v) => factory = v.factory };
vm.runInNewContext(source.replace("exports.apply = apply", "exports.audit = { CredentialField }; exports.apply = apply"), { window, document, navigator, console, setTimeout, clearTimeout, Date, AbortController });
const { CredentialField } = factory((n) => n === "react" ? React : { Tooltip: ({ children }) => children }).audit;
const root = createRoot(document.querySelector("#root"));
const checks = [];
const ok = (value, name) => {
  assert.ok(value, name);
  checks.push(name);
};
let setCalls = [], clearCalls = [], resolveSave, rejectSave;
const api = { setCredential: async (target, value) => {
  setCalls.push({ target, value });
  return new Promise((resolve2, reject) => {
    resolveSave = resolve2;
    rejectSave = reject;
  });
}, clearCredential: async (target) => {
  clearCalls.push(target);
  return { message: "cleared" };
} };
const t = (k) => k;
let props = { target: "balance", configured: false, source: "none", t, api, placeholder: "sk-\u2026" };
const render = async (next) => {
  props = { ...props, ...next };
  await act(async () => root.render(React.createElement(CredentialField, props)));
};
const button = (label) => [...document.querySelectorAll("#root button")].find((b) => b.textContent === label);
const click = async (label) => {
  await act(async () => button(label).click());
};
const type = async (text) => {
  const input2 = document.querySelector("#root input");
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input2, text);
    input2.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
};
const submit = async (n = 1) => {
  await act(async () => {
    for (let i = 0; i < n; i++) document.querySelector("#root form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  });
};
const untouched = () => document.querySelector("#host-search").value === "existing-session-search" && document.querySelector("#host-search").closest("form") === null;
// An explicit model of a saved-login filler: unowned password fields can borrow
// the preceding unowned text field as username. This is not native Chromium
// autofill evidence. The actual host query transition is tested separately.
function modeledSavedLogin() {
  let paired = false;
  for (const password of document.querySelectorAll('input[type="password"]')) {
    const fields = [...(password.form ?? document).querySelectorAll("input")];
    const prior = fields.slice(0, fields.indexOf(password)).reverse()
      .find(field => field.type === "text" && field.form === password.form && !field.disabled);
    if (!prior) continue;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(prior, "synthetic-unmatched-login");
    prior.dispatchEvent(new window.Event("input", { bubbles: true }));
    paired = true;
  }
  return paired;
}
const baselineIndex = process.argv.indexOf("--baseline");
if (baselineIndex >= 0) {
  const baseline = process.argv[baselineIndex + 1];
  assert.ok(baseline, "Pass a known git ref after --baseline");
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", baseline, "src/client"], { cwd: rootDir, encoding: "utf8" })
    .trim().split("\n").filter(file => file.endsWith(".js")).sort();
  const oldSource = files.map(file => execFileSync("git", ["show", `${baseline}:${file}`], { cwd: rootDir, encoding: "utf8" })).join("");
  vm.runInNewContext(oldSource.replace("exports.apply = apply", "exports.audit = { CredentialField }; exports.apply = apply"), { window, document, navigator, console, setTimeout, clearTimeout, Date, AbortController });
  const oldField = factory(name => name === "react" ? React : { Tooltip: ({ children }) => children }).audit.CredentialField;
  await act(async () => root.render(React.createElement(oldField, props)));
  ok(document.querySelector('#root input[type="password"]')?.form === null, "v1.8.6 mounts an unowned password field on view open");
  await act(async () => { ok(modeledSavedLogin(), "Modeled saved-login pairing reaches host text input in v1.8.6"); });
  ok(document.querySelector("#host-search").value === "synthetic-unmatched-login", "Modeled baseline can populate the collapsed search");
  ok(setCalls.length === 0 && clearCalls.length === 0, "Modeled autofill does not itself save credentials");
  document.querySelector("#host-search").value = "existing-session-search";
}
await render();
ok(!document.querySelector("#root input[type=password]"), "Unconfigured initial view mounts no password field");
ok(!modeledSavedLogin() && untouched(), "Opening fixed credential view cannot trigger the modeled username pairing");
ok(setCalls.length === 0 && clearCalls.length === 0, "Mount makes no credential RPC calls");
await render({ configured: true, source: "synthetic" });
ok(!document.querySelector("#root input[type=password]"), "Configured initial view also mounts no password field");
await click("credentialEdit");
let input = document.querySelector("#root input");
ok(input?.type === "password" && input.form === document.querySelector("#root form"), "Edit explicitly mounts masked password inside its own form");
ok(input.form.className === "cm-field", "Scoped form keeps the field's flex/stretch/gap layout");
ok(document.activeElement === input, "Explicit Edit moves keyboard focus to its scoped credential input");
ok(input.name === "cm-credential-balance" && input.autocomplete === "new-password", "Editor has scoped name and new-password autocomplete");
ok(!modeledSavedLogin() && untouched(), "Explicit editor form does not borrow the host search as username");
ok(button("credentialSave").type === "submit" && button("cancel").type === "button" && button("credentialClear").type === "button", "Save/Cancel/Clear carry explicit safe button types");
ok(untouched(), "Edit leaves existing host search value and form ownership unchanged");
await type("synthetic-audit-key");
await click("cancel");
ok(!document.querySelector("#root input[type=password]"), "Cancel removes secret editor");
await click("credentialEdit");
ok(document.querySelector("#root input").value === "", "Reopening after Cancel has no previous secret");
ok(setCalls.length === 0, "Edit/type/Cancel never submit credential");
await type("  synthetic-save-key  ");
await submit(2);
ok(setCalls.length === 1 && setCalls[0].target === "balance" && setCalls[0].value === "synthetic-save-key", "Same-tick duplicate explicit submits invoke exact target once with trimmed synthetic value");
ok(button("credentialSaving").disabled && button("cancel").disabled && button("credentialClear").disabled && document.querySelector("#root input").disabled, "Pending write blocks duplicate submit, Cancel, Clear and edits");
await submit();
ok(setCalls.length === 1, "Repeated submit during pending save does not duplicate RPC");
await act(async () => resolveSave({ message: "saved" }));
ok(!document.querySelector("#root input[type=password]"), "Successful save removes password editor");
await click("credentialEdit");
ok(document.querySelector("#root input").value === "", "Reopening after successful save has no cached secret");
await type("synthetic-failed-key");
await submit();
await act(async () => rejectSave(new Error("synthetic RPC unavailable")));
ok(document.querySelector("#root input").value === "synthetic-failed-key" && !document.querySelector("#root input").disabled, "Failed explicit save keeps editable draft for retry");
await click("cancel");
ok(!document.querySelector("#root input[type=password]"), "Cancel after failure removes secret editor");
await click("credentialEdit");
await type("synthetic-to-clear");
await act(async () => {
  button("credentialClear").click();
  button("credentialClear").click();
});
ok(!document.querySelector("#root input[type=password]"), "Successful Clear removes edited secret field");
ok(clearCalls.length === 1 && clearCalls[0] === "balance" && setCalls.length === 2, "Same-tick duplicate Clear calls only exact requested credential target once");
ok(untouched(), "All credential flows preserve existing host search and form ownership");
await render({ disabled: true });
ok(button("credentialEdit").disabled && button("credentialClear").disabled, "Disabled credential field prevents opening or clearing");
await click("credentialEdit");
ok(!document.querySelector("#root input"), "Disabled Edit does not mount password field");
await act(async () => root.unmount());
console.log(JSON.stringify({ verification: "React + jsdom DOM lifecycle; no native browser autofill or real credentials", reactVersion: React.version, sourceSha256: createHash("sha256").update(source).digest("hex"), checks }, null, 2));
