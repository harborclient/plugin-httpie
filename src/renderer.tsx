import type { PluginContext } from '@harborclient/sdk';
import { HttpieTab } from './HttpieTab';

/**
 * Registers the HTTPie request editor tab when the plugin activates.
 *
 * @param hc - SDK surface from HarborClient.
 */
export function activate(hc: PluginContext): void {
  hc.subscriptions.push(
    hc.ui.registerRequestTab({
      id: 'httpie',
      title: 'HTTPie',
      order: 46,
      Component: ({ context }) => <HttpieTab context={context} hc={hc} />
    })
  );
}
