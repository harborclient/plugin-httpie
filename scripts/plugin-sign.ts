import { runSignCli } from '@harborclient/sdk/signing';

/**
 * Delegates to the SDK signing CLI.
 */
const exitCode = await runSignCli(process.argv);
process.exit(exitCode);
