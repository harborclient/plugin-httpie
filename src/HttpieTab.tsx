import { useEffect, useMemo, useRef, useState } from '@harborclient/sdk/react';
import type { PluginContext, RequestTabContext } from '@harborclient/sdk';
import { copyToClipboard } from '@harborclient/sdk/clipboard';
import { Button, CodeEditor, FieldError } from '@harborclient/sdk/components';
import { buildHttpieCommand } from './buildHttpie';
import { HttpieParseError, parseHttpie } from './parseHttpie';

interface Props {
  /**
   * Read-only request tab context from HarborClient.
   */
  context: RequestTabContext;

  /**
   * Renderer plugin context for clipboard, toast, and draft updates.
   */
  hc: PluginContext;
}

/**
 * Displays an editable HTTPie command for the active request with copy and update actions.
 *
 * The editor stays in sync when the request changes elsewhere. Clicking Update (or blurring
 * the editor while dirty) parses the edited command and applies it to the active request via
 * `hc.host.applyRequestDraft`.
 */
export function HttpieTab({ context, hc }: Props) {
  /**
   * Equivalent HTTPie command derived from the active request context.
   */
  const command = useMemo(() => buildHttpieCommand(context), [context]);

  const [draftText, setDraftText] = useState(command);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const updatingRef = useRef(false);

  /**
   * Resyncs the editor when the generated command changes (request edited in other tabs).
   */
  useEffect(() => {
    setDraftText(command);
    setUpdateError(null);
  }, [command]);

  /**
   * Copies the current editor contents to the clipboard.
   */
  const handleCopy = async (): Promise<void> => {
    setCopyError(null);
    try {
      await copyToClipboard(hc, draftText, { toast: 'Copied to clipboard' });
    } catch {
      setCopyError('Failed to copy');
    }
  };

  /**
   * Parses the edited HTTPie command and applies it to the active request draft.
   */
  const handleUpdate = async (): Promise<void> => {
    if (updatingRef.current) {
      return;
    }
    setUpdateError(null);
    setUpdating(true);
    updatingRef.current = true;
    try {
      const payload = parseHttpie(draftText);
      await hc.host.applyRequestDraft(payload);
      hc.ui.showToast('Request updated from HTTPie');
    } catch (error) {
      const message =
        error instanceof HttpieParseError
          ? error.message
          : error instanceof Error
          ? error.message
          : 'Failed to update request from HTTPie';
      setUpdateError(message);
    } finally {
      setUpdating(false);
      updatingRef.current = false;
    }
  };

  /**
   * Applies the edited command when the editor loses focus and the text differs from the
   * generated command, so blur does not re-apply an unchanged value.
   */
  const handleBlur = (): void => {
    if (draftText === command || updatingRef.current) {
      return;
    }
    void handleUpdate();
  };

  const dirty = draftText !== command;
  const errorMessage = updateError ?? copyError;
  const errorId = updateError ? 'httpie-update-error' : 'httpie-copy-error';

  return (
    <div className="flex flex-col gap-2" style={{ minHeight: '320px' }}>
      <div className="flex shrink-0 items-center justify-end gap-2">
        <Button
          variant="secondary"
          aria-label="Update request from HTTPie command"
          disabled={updating || !dirty}
          onClick={() => {
            void handleUpdate();
          }}
        >
          {updating ? 'Updating…' : 'Update'}
        </Button>
        <Button
          variant="secondary"
          aria-label="Copy HTTPie command"
          onClick={() => {
            void handleCopy();
          }}
        >
          Copy
        </Button>
      </div>
      <CodeEditor
        value={draftText}
        onChange={setDraftText}
        onBlur={handleBlur}
        language="shell"
        minHeight="280px"
        className="flex-1"
        aria-label="HTTPie command"
        aria-invalid={Boolean(updateError)}
        aria-describedby={errorMessage ? errorId : undefined}
      />
      <FieldError id={errorId} roleAlert>
        {errorMessage}
      </FieldError>
    </div>
  );
}
