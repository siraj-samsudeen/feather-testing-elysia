// Make happy-dom unloadable, as in a project that never installed it.
import { mock } from "bun:test";

mock.module("happy-dom", () => {
  throw new Error("Cannot find package 'happy-dom' (removed for this check)");
});
