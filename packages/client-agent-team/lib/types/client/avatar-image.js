import { useState } from 'react';
export function useAvatarImage(url) {
    const [broken, setBroken] = useState(undefined);
    return {
        src: url === undefined || url === broken ? undefined : url,
        failed: () => { if (url !== undefined)
            setBroken(url); },
    };
}
