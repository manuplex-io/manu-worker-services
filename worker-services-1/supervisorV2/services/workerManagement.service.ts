// /workerManagement.service.ts

import { DynamicLoadingService } from "./dynamicLoading.service";
import { getTemporalConnection, getWorkflowClient } from '../config/temporal.config';
import { Logger } from '@nestjs/common';
import { RedisService } from './redis.service';
import { WorkflowClient } from "@temporalio/client";

const logger = new Logger('WorkerManagementService');

export class WorkerManagementService {
    private workers: Map<number, {
        isAvailable: boolean;
        workflowRunId: string | null;
        workflowType: string | null;
        workerReportedState: string;
        healthChecksMissed: number;
        timeWhenAssigned: number;
        unsuccesfulShutDownAttempts?: number;
    }>;

    private readonly WS_WORKER_COUNT: number;
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private HEALTHCHECK_INTERVAL = parseInt(process.env.WS_HEALTHCHECK_INTERVAL || "30000", 10); // 30 seconds
    private HEALTHCHECK_TIMEOUT = parseInt(process.env.WS_HEALTHCHECK_TIMEOUT || "2000", 10); // 2 seconds
    private WAIT_SHUTDOWN_TIME = parseInt(process.env.WS_WAIT_SHUTDOWN_TIME || "15000", 10); // 15 seconds
    private MAX_SHUTDOWN_ATTEMPTS = parseInt(process.env.WS_MAX_SHUTDOWN_ATTEMPTS || "3", 10);
    private MAX_HEALTHCHECK_MISSED = parseInt(process.env.WS_MAX_HEALTHCHECK_MISSED || "9", 10);
    private MAX_EXECUTION_TIME = parseInt(process.env.WS_MAX_EXECUTION_TIME || (15 * 60 * 1000).toString(), 10); // 15 minutes
    private temporalNamespace = process.env.TEMPORAL_NAMESPACE || 'ob1-temporal-namespace';
    private workflowClientForWMS: WorkflowClient | null = null; // Global client for Temporal Worker Management Service


    constructor(
        private dynamicLoadingService: DynamicLoadingService,
        private redisService: RedisService

    ) {
        this.WS_WORKER_COUNT = parseInt(process.env.WS_WS_WORKER_COUNT || "5", 10);
        this.workers = new Map();

    }

    public async initializeWorkers(): Promise<void> {
        logger.log('Initializing workers...');
        for (let i = 0; i < this.WS_WORKER_COUNT; i++) {
            this.workers.set(i, {
                isAvailable: false,
                workflowRunId: null,
                workflowType: "Default",
                workerReportedState: "INITIAL-BY-SUPERVISOR",
                healthChecksMissed: 0,
                timeWhenAssigned: 0,
                unsuccesfulShutDownAttempts: 0
            });
        }

        for (let i = 0; i < this.WS_WORKER_COUNT; i++) {
            const success = await this.dynamicLoadingService.loadDefaultWorker(`worker${i}`);
            if (success) {
                const worker = this.workers.get(i);
                if (worker) {
                    worker.isAvailable = true;
                }
            }
        }
        logger.log('Workers initialized.');
        await this.initializeWorkflowClient();
        this.redisService.storeWorkerMap(this.workers);
        this.startHealthCheckService();
    }

    public async initializeWorkflowClient(): Promise<void> {
        const connectionWMS = await getTemporalConnection('Worker Management Service');
        if (!connectionWMS) {
            logger.error('Failed to establish Temporal connection for Worker Management Service. Exiting.');
            process.exit(1);
        }

        this.workflowClientForWMS = await getWorkflowClient(connectionWMS, 'Worker Management Service');
        if (!this.workflowClientForWMS) {
            logger.error('Failed to create WorkflowClient. Supervisor exiting.');
            process.exit(1);
        }
    }

    public async getAvailableAndAssignWorker(workflowRunId: string, workflowType: string, temporalWorkflowId: string): Promise<{ workerId: number, status: boolean, loaded: boolean } | { workerId: null, status: boolean, loaded: boolean }> {
        logger.log('Getting available worker...');
        // Worker type comparison: if worker type is same as workflow type, then we will assign that worker
        for (const [workerId, worker] of this.workers.entries()) {
            if (worker.isAvailable && worker.workflowType === workflowType) {

                worker.isAvailable = false;
                worker.workflowRunId = workflowRunId;
                worker.healthChecksMissed = 0;
                worker.unsuccesfulShutDownAttempts = 0;
                worker.workerReportedState = "ASSIGNING-BY-SUPERVISOR";
                worker.timeWhenAssigned = Date.now();
                worker.workflowType = workflowType;
                // logger.log(`Returning workerId: ${workerId}`);
                logger.log(`WORKER ${workerId} is available and already loaded with same workflow type ${workflowType} hence skipping reloading.`);
                this.redisService.storeWorkerMap(this.workers);
                return { workerId, status: true, loaded: true };
            }
        }
        for (const [workerId, worker] of this.workers.entries()) {
            if (worker.isAvailable) {
                const loaded = await this.dynamicLoadingService.loadWorker(workerId, workflowType, temporalWorkflowId);
                if (loaded) {
                    worker.isAvailable = false;
                    worker.workflowRunId = workflowRunId;
                    worker.healthChecksMissed = 0;
                    worker.unsuccesfulShutDownAttempts = 0;
                    worker.workerReportedState = "ASSIGNING-BY-SUPERVISOR";
                    worker.timeWhenAssigned = Date.now();
                    worker.workflowType = workflowType;
                    // logger.log(`Returning workerId: ${workerId}`);
                    logger.log(`Assigning workflow type ${workflowType} to worker ${workerId}`);
                    this.redisService.storeWorkerMap(this.workers);
                    return { workerId, status: true, loaded: loaded };
                } else {
                    // since we are not able to load the worker, we will not try to assign another worker but will let the supervisor know that a worker was available but loading failed 
                    return { workerId, status: true, loaded: false };
                }
            }
        }
        logger.log(`PRINT workers: ${JSON.stringify(this.workers, null, 2)}`);
        return { workerId: null, status: false, loaded: false }; // No workers available
    }

    private startHealthCheckService(): void {
        logger.log('Starting health check service...');
        this.healthCheckInterval = setInterval(async () => {
            for (let i = 0; i < this.WS_WORKER_COUNT; i++) {
                const worker = this.workers.get(i);
                if (!worker) continue;

                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), this.HEALTHCHECK_TIMEOUT);

                    const response = await fetch(`http://localhost:${5001 + i}/health`, {
                        signal: controller.signal
                    });
                    clearTimeout(timeout);


                    const data = await response.json();
                    //logger.log(`Health check for worker${i}:  ${response.status}  & ${data.status} - ${data.state}`);
                    if (response.status === 200 && data.status === "healthy") {
                        worker.workerReportedState = data.state;
                        worker.healthChecksMissed = 0;
                    } else {
                        worker.healthChecksMissed++;
                    }
                } catch (error) {
                    worker.healthChecksMissed++;
                    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
                    logger.warn(`Health check failed for worker${i}: ${errorMessage}`);
                }

                if (!worker.isAvailable) {
                    const currentTime = Date.now();

                    try {
                        const namespace = this.temporalNamespace;
                        const listWorkflows = await this.workflowClientForWMS?.workflowService.listWorkflowExecutions({
                            namespace,
                            query: `ExecutionStatus="Running" AND RunId="${worker.workflowRunId}"`,
                        });

                        const workflowStillRunning = listWorkflows?.executions && listWorkflows.executions.length > 0;

                        if (!workflowStillRunning) {
                            worker.isAvailable = true;
                            worker.workflowRunId = null;
                            worker.workerReportedState = "ASSIGNED-TO-PREVIOUSLY-COMPLETED-WORKFLOWTYPE";
                            // worker.healthChecksMissed = 0;
                            worker.timeWhenAssigned = 0;
                            // worker.unsuccesfulShutDownAttempts = 0;
                        }
                        // Checking for time when assigned is not 0 because when workflow is not running, we reassigned time when assigned to 0
                        if (worker.timeWhenAssigned != 0 && (currentTime - worker.timeWhenAssigned) > this.MAX_EXECUTION_TIME) {
                            logger.log(`Current time: ${currentTime}`);
                            logger.log(`Worker time when assigned: ${worker.timeWhenAssigned}`);
                            logger.log(`Execution time: ${currentTime - worker?.timeWhenAssigned}`);
                            logger.log(`WORKER ${i} is not running or has been running for more than ${this.MAX_EXECUTION_TIME}ms. Attempting shutdown...`);

                            const shutdownSuccessful = await this.attemptWorkerShutdown(i, this.WAIT_SHUTDOWN_TIME);

                            if (!shutdownSuccessful) {
                                worker.unsuccesfulShutDownAttempts!++;
                                logger.warn(`Shutdown attempt failed for worker${i}. Attempt ${worker.unsuccesfulShutDownAttempts}`);

                                if (worker.unsuccesfulShutDownAttempts! >= this.MAX_SHUTDOWN_ATTEMPTS) {
                                    logger.error(`Max shutdown attempts reached for worker${i}. Forcing reset.`);
                                    await this.dynamicLoadingService.loadDefaultWorker(`worker${i}`);
                                    worker.unsuccesfulShutDownAttempts = 0;
                                    worker.isAvailable = true;
                                    worker.workflowRunId = null;
                                    worker.workerReportedState = "RELEASED-BY-OVERTIME";
                                }
                            } else {
                                logger.log(`Shutdown and reset successful for worker${i}.`);
                                await this.dynamicLoadingService.loadDefaultWorker(`worker${i}`);
                                worker.unsuccesfulShutDownAttempts = 0;
                                worker.isAvailable = true;
                            }
                        }
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
                        logger.error(`Error querying Temporal for worker${i}: ${errorMessage}`);
                    }
                }

                if (worker.healthChecksMissed >= this.MAX_HEALTHCHECK_MISSED) {
                    logger.error(`Worker${i} missed ${this.MAX_HEALTHCHECK_MISSED} health checks. Forcing reset.`);
                    await this.dynamicLoadingService.loadDefaultWorker(`worker${i}`);
                    worker.isAvailable = true;
                    worker.workflowRunId = null;
                    worker.workerReportedState = "RELEASED-BECOZ-HEALTHCHECK-MISSED";
                    worker.healthChecksMissed = 0;
                }
            }
            // Store the updated worker map in Redis
            this.redisService.storeWorkerMap(this.workers);
        }, this.HEALTHCHECK_INTERVAL);


    }

    private async attemptWorkerShutdown(workerId: number, waitTime: number): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), waitTime);

            const response = await fetch(`http://localhost:${5001 + workerId}/shutdown`, {
                method: 'GET',
                signal: controller.signal,
            });

            clearTimeout(timeout);

            if (response.status === 200) {
                logger.log(`Shutdown successful for worker${workerId}`);
                return true;
            } else {
                logger.warn(`Shutdown returned non-200 status for worker${workerId}: ${response.status}`);
                return false;
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
            logger.error(`Shutdown failed for worker${workerId}: ${errorMessage}`);
            return false;
        }
    }

    public releaseAndResetWorker(workerId: number): void | null {
        const worker = this.workers.get(workerId);
        if (!worker) return;

        this.dynamicLoadingService.loadDefaultWorker(`worker${workerId}`);

        worker.isAvailable = true;
        worker.workflowRunId = null;
        worker.workerReportedState = "RELEASED-BY-SUPERVISOR";
        worker.healthChecksMissed = 0;
        worker.timeWhenAssigned = 0;
    }


    public stopHealthCheckService(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }
}
