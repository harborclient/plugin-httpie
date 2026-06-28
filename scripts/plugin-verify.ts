import { runVerifyCli } from '@harborclient/sdk/signing';

/**
 * Delegates to the SDK verification CLI.
 */
const exitCode = await runVerifyCli(process.argv);
process.exit(exitCode);
