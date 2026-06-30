import { buildRenderer } from '@harborclient/sdk/build';

await buildRenderer({
  jsxRuntime: 'host',
  watch: process.argv.includes('--watch')
});
