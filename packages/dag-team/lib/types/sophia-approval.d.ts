/**
 * Sophia approval-plane glue (P2 orchestration bridge).
 *
 * Wires the orchestration approval tools (`sophia_team_propose` / `_review` /
 * `_approve`, packages/orchestration) into the running dag-team plugin:
 *
 * - `dagBackend` materializes approved plans as DAG teams through the
 *   `AgentTeamsRuntime` (`sophiaDagBackendFor`).
 * - `persistentBackend` materializes them as persisted ledger channels via
 *   agent-team's `createSophiaPersistentBackend`, resolved lazily through the
 *   `agentTeam` host service at the first persistent materialization (a
 *   composition without the host still installs cleanly).
 * - the `OrchestrationHost` maps orchestration callers to dag identities and
 *   locates DAG captains for review adjudication.
 * - `resolveCaller` turns a `ToolRunContext` into a `CallerIdentity`
 *   (persistent ledger member → dag participant → human).
 *
 * The install is idempotent per context: the first call builds and registers
 * the plane, later calls return the same handle without re-registering.
 */
import type { Context } from '@deepseek-ai/cordis';
import { SophiaTeamFacade } from 'dsh-sophia-entities/orchestration/facade';
import type { TeamBackend } from 'dsh-sophia-entities/orchestration/types';
import type { AgentTeamsRuntime, ToolsConfig } from './tools.ts';
import { type WebRouteHost } from './web-routes.ts';
import { type ApprovalPlanAction } from 'dsh-sophia-entities/orchestration/routes';
/** Inputs shared by the glue and its host (index.ts `apply`). */
export interface SophiaApprovalPlaneOptions {
    /** The dag runtime returned by `registerAgentTeamsTools`. */
    readonly runtime: AgentTeamsRuntime;
    /** The resolved dag-team config (stateDir / memberMaxDepth / ...). */
    readonly resolved: ToolsConfig;
}
/**
 * Handle for later P3 route wiring. The facade is the approval engine: its
 * router and store expose the request list / activity / approvalsRoot
 * (`<workspace>/.sophia-entities/approvals/`).
 */
export interface ApprovalPlaneHandle {
    readonly facade: SophiaTeamFacade;
    readonly dagBackend: TeamBackend;
    readonly persistentBackend: TeamBackend;
    readonly workingDirectory: string;
    readonly maxTeamDepth: number;
}
/**
 * Idempotently bridge the orchestration approval plane into `ctx`. The first
 * call per context builds the facade, hosts and approval tools; later calls
 * return the existing handle without re-registering the tools.
 */
export declare function installSophiaApprovalPlane(ctx: Context, options: SophiaApprovalPlaneOptions): ApprovalPlaneHandle;
/**
 * P3 approval HTTP surface (design §4.9). Registers the two endpoints the
 * browser approval card and badge poll into the authenticated web server
 * (index.ts `registerWebSurface`):
 *
 *   GET  /plugins/dsh-sophia-entities/approvals       → pending queue snapshot
 *   POST /plugins/dsh-sophia-entities/approvals/plan  → set_mode / approve / reject / review
 *
 * The handlers mirror the neighbouring /state /halt /plan routes in index.ts
 * (method gate, `readJsonRequest`, JSON + cache-control:no-store, session
 * resolution through the live `agents` registry). The connection gate has
 * already authenticated the browser as the human operator, so every plan
 * caller is the Human owner; the human session id rides in the request body
 * exactly like the halt route's `sessionId` and is rejected with 409 when it
 * is not attached. Registering is idempotent per web server via `ctx.effect`.
 */
export declare function registerApprovalRoutes(ctx: Context, webServer: WebRouteHost, facade: SophiaTeamFacade): void;
/**
 * Reads the plan request body into an `ApprovalPlanAction`, rejecting unknown
 * actions and missing request ids with a descriptive message that the route
 * maps to 400 (mirrors the `/plan` route's per-field validation).
 */
export declare function parseApprovalPlanAction(payload: Record<string, unknown>): ApprovalPlanAction;
//# sourceMappingURL=sophia-approval.d.ts.map