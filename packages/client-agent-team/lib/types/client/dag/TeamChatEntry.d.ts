import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type AgentTeamsCardInjected } from './AgentTeamsCard.tsx';
export declare function TeamChatEntry({ sessionId, t }: PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'sophiaEntities'>): import("react").JSX.Element | null;
export declare function TeamTurnCard({ sessionId, turn, useChat, t, openMember }: PropsRuntime<'conversation.chat.turnTail'> & PropsLocale<'sophiaEntities'> & AgentTeamsCardInjected): import("react").JSX.Element | null;
//# sourceMappingURL=TeamChatEntry.d.ts.map