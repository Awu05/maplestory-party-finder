/** The slice of a logger the background workers and the event dispatcher use. */
export type Logger = { error(obj: object, msg: string): void };

/** Only the error's class name: messages (e.g. from fetch) can embed secrets such as webhook URLs. */
export const errName = (err: unknown): string => (err instanceof Error ? err.constructor.name : 'Error');
