/**
 * Sophia Entities — orchestration layer (P2).
 *
 * The approval plane above the two team backends: durable approval queue,
 * captain/owner state machine with timeouts, the three approval tools, and the
 * facade that dispatches materialization to the dag / persistent backends.
 * Dependency-free by design (§4.1.2): the plugin host wires the backends.
 */
export * from "./types.js";
export * from "./store.js";
export * from "./router.js";
export * from "./facade.js";
export * from "./tools.js";
export * from "./notifier.js";
export * from "./routes.js";
