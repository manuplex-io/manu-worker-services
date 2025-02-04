// /supervisor/supervisor.ts
import { RedisService } from './services/redis.service';
import { DynamicLoadingService } from './services/dynamicLoading.service';
import { WorkerManagementService } from './services/workerManagement.service';
import { Logger } from '@nestjs/common';
import { getTemporalConnection, getWorkflowClient } from './config/temporal.config';
import { KafkaService } from './services/kafka.service';
import { OB1AgentService } from './interfaces/ob1AgentService.interface';
import express, { Request, Response } from 'express';

const logger = new Logger('Supervisor');
const app = express();
const PORT = 3000;

// Add NestJS-style health check endpoint
app.get('/services/health', (req: Request, res: Response) => {
    const healthCheck = {
        status: 'ok',
        info: {
            supervisor: {
                status: 'up'
            }
        },
        error: {},
        details: {
            supervisor: {
                status: 'up'
            }
        }
    };

    try {
        res.status(200).json(healthCheck);
    } catch (e) {
        healthCheck.status = 'error';
        healthCheck.error = {
            supervisor: {
                status: 'down',
                message: e instanceof Error ? e.message : 'An error occurred'
            }
        };
        res.status(503).json(healthCheck);
    }
});

// Start express server
app.listen(PORT, () => {
    logger.log(`Health check endpoint listening on port ${PORT}`);
});

async function pollTemporalWorkflows(
    redisService: RedisService,
    kafkaService: KafkaService,
    workerManagementService: WorkerManagementService,
    dynamicLoadingService: DynamicLoadingService
) {
    const namespace = process.env.TEMPORAL_NAMESPACE || 'ob1-temporal-namespace';
    const taskQueue = process.env.AG_TEMPORAL_TASK_QUE_NAME || 'agentprocess_QUEUE';
    const WORKFLOW_LOCK_TIMEOUT = 960; // 16 mins // in seconds
    const SUPERVISOR_CHECK_INTERVAL = 15000; // 15 secs  //in milliseconds

    logger.log(`Starting supervisor for namespace: ${namespace}`);


    // Wait for workers to be created
    // Get Temporal connection
    const connection = await getTemporalConnection('Supervisor');
    if (!connection) {
        logger.error('Failed to establish Temporal connection. Supervisor exiting.');
        process.exit(1);
    }

    // Get Workflow Client
    const workflowClient = await getWorkflowClient(connection, 'Supervisor');
    if (!workflowClient) {
        logger.error('Failed to create WorkflowClient. Supervisor exiting.');
        process.exit(1);
    }

    setInterval(async () => {
        try {
            //logger.log(`Polling Temporal for running workflows in namespace: ${namespace}`);
            const workflows = await workflowClient.workflowService.listWorkflowExecutions({
                namespace,
                query: `ExecutionStatus="Running"`,
            });

            if (!workflows.executions || workflows.executions.length === 0) {
                logger.log('No running workflows found.');
                return;
            }

            logger.log(`Found ${workflows.executions.length} workflows.`);
            for (const workflow of workflows.executions) {
                const workflowType = workflow.type?.name;
                if (!workflowType) {
                    logger.warn('Workflow has no type. Skipping.');
                    continue;
                }

                const WorkflowRunId = workflow.execution?.runId;
                if (!WorkflowRunId) {
                    logger.warn('Workflow has no RunId. Skipping.');
                    continue;
                }

                const temporalWorkflowId = workflow.execution?.workflowId;
                if (!temporalWorkflowId) {
                    logger.warn('Workflow has no temporalWorkflowId. Skipping.');
                    continue;
                }

                // Check if the workflow code is available in Redis
                const isAvailable = await redisService.isWorkflowAvailable(workflowType);
                if (!isAvailable) {
                    const request : OB1AgentService.CRUDRequest = {
                        userOrgId: 'worker-service-1',
                        sourceFunction: 'loadWorkflow',
                        CRUDFunctionNameInput: 'workflowCRUD-V1',
                        CRUDFunctionInput: {
                            CRUDOperationName: 'GET',
                            CRUDRoute: 'workflows/getCode',
                            queryParams: {workflowExternalName: workflowType}
                        },
                        personRole: 'USER',
                        personId: 'worker-service-1'
                    };
                    await kafkaService.sendMessage(request);      
                    logger.warn(`Workflow code for '${workflowType}' is not available in Redis. Skipping.`);
                    continue;
                }

                const lockAcquired = await redisService.acquireLock(WorkflowRunId, WORKFLOW_LOCK_TIMEOUT);
                if (!lockAcquired) {
                    logger.log(` Workflow already Locked: ${WorkflowRunId}. Hence Skipping.`);
                    continue;
                }

                try {
                    const { workerId, status, loaded } = await workerManagementService.getAvailableAndAssignWorker(
                        WorkflowRunId,
                        workflowType,
                        temporalWorkflowId
                    );
                    if (!status || workerId === null) {
                        logger.warn('No workers currently. Hence Releasing lock.');
                        await redisService.releaseLock(WorkflowRunId);
                        continue;
                    }

                    logger.log(`Assigning workflow type ${workflowType} to worker ${workerId}`);
                    // const loaded = await dynamicLoadingService.loadWorker(workerId, workflowType);

                    if (!loaded) {
                        logger.error(`Failed to load worker ${workerId} for workflow ${workflowType} with WorkflowRunId ${WorkflowRunId}. Releasing lock & worker ${workerId} .`);
                        await redisService.releaseLock(WorkflowRunId);
                        await workerManagementService.releaseAndResetWorker(workerId);
                    } else {
                        logger.log(`Workflow type ${workflowType}with WorkflowRunId ${WorkflowRunId} successfully assigned to worker ${workerId}`);
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
                    logger.error(`Error processing workflow ${workflowType} with WorkflowRunId ${WorkflowRunId}: ${errorMessage}`);
                    await redisService.releaseLock(WorkflowRunId);
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
            logger.error(`Error polling workflows: ${errorMessage}`);
        }
    }, SUPERVISOR_CHECK_INTERVAL);
}

async function main() {
    const redisService = new RedisService();
    const kafkaService = new KafkaService();
    await kafkaService.connect();
    const dynamicLoadingService = new DynamicLoadingService(redisService, kafkaService);

    // Initialize WorkerManagementService asynchronously
    const workerManagementService = new WorkerManagementService(dynamicLoadingService, redisService);
    await workerManagementService.initializeWorkers();

    // Add a 5 second delay before starting workflow polling
    await new Promise(resolve => setTimeout(resolve, 5000));
    logger.log('Starting workflow polling after 5 second initialization delay...');
    await pollTemporalWorkflows(redisService, kafkaService, workerManagementService, dynamicLoadingService);

    // Add cleanup on process termination
    process.on('SIGTERM', async () => {
        await kafkaService.disconnect();
        process.exit(0);
    });
}


main().catch((err) => {
    logger.error(`Supervisor failed to start: ${err.message}`);
    process.exit(1);
});
