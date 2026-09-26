import { useRef, useState } from 'react';
/**
 * Shared edit-dialog save lifecycle: one in-flight durable update, the dialog
 * held disabled while it runs, a refusal reported in place, and a close only
 * after the parent has re-read the committed state. Callers keep their own
 * payload and request reuse, and hold `pendingRequest` so that editing a field
 * drops a request the Host may already have committed.
 */
export function useEditDialogSave({ save, onCommitted, onClose }) {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState();
    const pendingRequest = useRef();
    const submit = async (request) => {
        pendingRequest.current = request;
        setSaving(true);
        setError(undefined);
        try {
            const result = await save(request);
            if (result.ok) {
                pendingRequest.current = undefined;
                await onCommitted();
                onClose();
            }
            else {
                setError(result.error.message);
            }
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setSaving(false);
        }
    };
    return { saving, error, pendingRequest, save: submit };
}
