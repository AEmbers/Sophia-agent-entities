/**
 * Sophia Entities — orchestration layer (P2).
 *
 * The approval plane above the two team backends: durable approval queue,
 * captain/owner state machine with timeouts, the three approval tools, and the
 * facade that dispatches materialization to the dag / persistent backends.
 * Dependency-free by design (§4.1.2): the plugin host wires the backends.
 */
export * from './types.ts';
export * from './store.ts';
export * from './router.ts';
export * from './facade.ts';
export * from './tools.ts';
export * from './notifier.ts';
export * from './routes.ts';
//# sourceMappingURL=index.d.ts.map