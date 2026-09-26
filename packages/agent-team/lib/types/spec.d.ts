import { z } from 'zod';
import type { AgentTeamOperation, AgentTeamOperationId } from './types.ts';
/** Durable validator for the closed Agent Team operation union; ledgers written before message occurredAt existed normalize on load. */
export declare const agentTeamOperationSchema: z.ZodType<AgentTeamOperation>;
/** Versioned durable Agent Team declaration; v1 is the first public ledger format and older local media reject at open. */
export declare const agentTeamDomainSpec: {
    name: string;
    version: number;
    tables: {
        operations: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<AgentTeamOperationId, AgentTeamOperation>;
    };
};
//# sourceMappingURL=spec.d.ts.map