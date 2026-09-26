/**
 * Shared artwork lookup for the activity panel and the conversation card:
 * OC (original character) portraits per member role resolve first; legacy
 * whale role images act as a fallback bucket; the captain uses the OC lead.
 * @module dsh-agent-teams/client/artwork
 */
/** Legacy whale artwork route prefix served by the plugin host half. */
export declare const ART_BASE = "/plugins/dsh-sophia-entities/assets/";
/** OC portrait route prefix (512x512 WebP, flat slug directory). */
export declare const OC_ART_BASE = "/plugins/dsh-sophia-entities/sophia-assets/";
/** Captain artwork: the OC lead portrait (钦天监监正 · lead-ceo). */
export declare const LEAD_ART = "/plugins/dsh-sophia-entities/sophia-assets/lead-ceo.webp";
/** Status action artwork per member activity (kept on whale images). */
export declare const ACTION_ART: Record<'working' | 'idle' | 'unknown', string>;
/**
 * Member artwork URL, or null when no role matches (initial-letter fallback).
 * OC portraits win first (deterministic per post), then legacy whale buckets.
 * @param name - the member's display name.
 * @param role - the member's role text.
 * @returns the artwork URL, or null when unmatched.
 */
export declare function memberArtUrl(name: string, role: string): string | null;
//# sourceMappingURL=artwork.d.ts.map