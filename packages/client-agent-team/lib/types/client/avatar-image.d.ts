/**
 * Whether one avatar URL actually draws.
 *
 * The Host accepts an avatar by declared media type — `sanitizeMediaType` only
 * checks the shape of `image/…` — so bytes the browser cannot decode are stored
 * and handed back as a data URL that renders nothing: a phone photo in HEIC, or
 * a payload damaged on the way in. The settings copy promises the initial back
 * in that case, so both avatar seats ask this hook instead of testing the URL
 * for `undefined`, which cannot tell a picture from a blank circle.
 *
 * The record is keyed by URL: bytes that already failed keep the fallback, and
 * a new upload retries on its own because its data URL differs.
 */
export interface AvatarImage {
    /** The URL to draw, or `undefined` when the seat must fall back to the initial. */
    readonly src: string | undefined;
    /** Attach to the `<img>`'s `onError`: these bytes do not decode. */
    readonly failed: () => void;
}
export declare function useAvatarImage(url: string | undefined): AvatarImage;
//# sourceMappingURL=avatar-image.d.ts.map