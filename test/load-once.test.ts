import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { claimExtension } from "../.pi/extensions/shared/load-once";

/** Minimal pi double: each extension gets its own `pi`, all sharing one bus (as in pi). */
const fakePi = (bus: ReturnType<typeof createEventBus>) =>
  ({ events: { emit: bus.emit, on: bus.on } }) as unknown as ExtensionAPI;

test("load-once: second copy on the same bus is skipped, per name", () => {
  const bus = createEventBus();
  assert.equal(claimExtension(fakePi(bus), "zen-process"), true); // project copy
  assert.equal(claimExtension(fakePi(bus), "zen-process"), false); // global copy
  assert.equal(claimExtension(fakePi(bus), "modes"), true);
  assert.equal(claimExtension(fakePi(bus), "modes"), false);
});

test("load-once: a fresh bus (new session / reload) loads again", () => {
  const first = createEventBus();
  assert.equal(claimExtension(fakePi(first), "zen-process"), true);
  first.clear();
  assert.equal(claimExtension(fakePi(first), "zen-process"), true);
  assert.equal(claimExtension(fakePi(createEventBus()), "zen-process"), true);
});

test("load-once: fails open without an event bus", () => {
  const noBus = {} as unknown as ExtensionAPI;
  assert.equal(claimExtension(noBus, "zen-process"), true);
  assert.equal(claimExtension(noBus, "zen-process"), true);
});
