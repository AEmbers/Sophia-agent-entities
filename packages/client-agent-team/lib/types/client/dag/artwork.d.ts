/**
 * Shared artwork lookup for the activity panel and the conversation card:
 * OC (original character) portraits per member role resolve first — by post
 * title, then by a plainer role word — the legacy whale role images act as a
 * fallback bucket, and the captain uses the OC lead.
 * @module dsh-agent-teams/client/artwork
 */
/** Legacy whale artwork route prefix served by the plugin host half. */
export declare const ART_BASE = "/plugins/dsh-sophia-entities/assets/";
/** OC portrait route prefix (512x512 WebP, flat slug directory). */
export declare const OC_ART_BASE = "/plugins/dsh-sophia-entities/sophia-assets/";
/** Captain artwork: the OC lead portrait (监正 · lead-ceo). */
export declare const LEAD_ART = "/plugins/dsh-sophia-entities/sophia-assets/lead-ceo.webp";
/** Status action artwork per member activity (kept on whale images). */
export declare const ACTION_ART: Record<'working' | 'idle' | 'unknown', string>;
/**
 * Member artwork URL, or null when no role matches (initial-letter fallback).
 * The OC portraits win first — the exact post title, then a plainer role word —
 * and the legacy whale buckets only catch what is left.
 * @param name - the member's display name.
 * @param role - the member's role text.
 * @returns the artwork URL, or null when unmatched.
 */
export declare function memberArtUrl(name: string, role: string): string | null;
//# sourceMappingURL=artwork.d.ts.map