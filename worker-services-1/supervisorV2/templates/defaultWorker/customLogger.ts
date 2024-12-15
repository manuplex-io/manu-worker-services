// customLogger.ts
import { Logger } from '@nestjs/common';

export class CustomLogger extends Logger {
    private workerId: string;

    constructor(context: string, workerId: string) {
        super(context);
        this.workerId = workerId;
    }

    log(message: string) {
        super.log(`[WORKER_ID=${this.workerId}] ${message}`);
    }

    error(message: string, trace?: string) {
        super.error(`[WORKER_ID=${this.workerId}] ${message}`, trace);
    }

    warn(message: string) {
        super.warn(`[WORKER_ID=${this.workerId}] ${message}`);
    }

    debug(message: string) {
        super.debug(`[WORKER_ID=${this.workerId}] ${message}`);
    }

    verbose(message: string) {
        super.verbose(`[WORKER_ID=${this.workerId}] ${message}`);
    }
}
