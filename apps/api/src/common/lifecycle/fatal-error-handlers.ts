import pino from 'pino';

/**
 * Last-resort handlers: log and exit non-zero so Docker's restart policy replaces the
 * container. Continuing after an unknown failure risks running with corrupted state.
 */
export function installFatalErrorHandlers(service: string): void {
  const logger = pino({ base: { service }, messageKey: 'message' });
  const die = (event: string) => (err: unknown) => {
    logger.fatal({ event, err }, 'Fatal error, exiting');
    process.exit(1);
  };
  process.on('uncaughtException', die('process.uncaught_exception'));
  process.on('unhandledRejection', die('process.unhandled_rejection'));
}
