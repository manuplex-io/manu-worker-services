// worker.ts

import express, { Request, Response } from 'express';
import { NativeConnection, Worker, WorkerStatus, State } from '@temporalio/worker';
import * as activities from './myActivity';
import { CustomLogger } from './customLogger';

const workerId = process.env.TEMPORAL_WORKER_ID || 'default-worker-id';
const logger = new CustomLogger('Worker', workerId);
const app = express();
const port = process.env.TEMPORAL_WORKER_PORT || 6000;

let worker: Worker | undefined;

function isShutdownState(state: State): boolean {
    // States considered effectively shutdown
    return ['STOPPED', 'DRAINED', 'FAILED'].includes(state);
}

async function createAndRunWorker() {
    const workflowExternalName = process.env.WORKFLOW_EXTERNAL_NAME || 'myWorkflow';
    const temporalAddress = process.env.TEMPORAL_ADDRESS || 'temporal-server-1.orangebox-uswest-2.local:7233';
    const taskQueue = process.env.AG_TEMPORAL_TASK_QUE_NAME || 'agentprocess_QUEUE';
    const namespace = process.env.TEMPORAL_NAMESPACE || 'ob1-temporal-namespace';

    logger.log('Initializing Purpose Build Dynamic Temporal worker...');
    logger.log(`Using Temporal server address: ${temporalAddress}`);
    logger.log(`Task queue: ${taskQueue}`);
    logger.log(`Namespace: ${namespace}`);
    logger.log(`Worker identity: ${workerId}`);

    logger.log('Connecting to Temporal server...');
    const connection = await NativeConnection.connect({ address: temporalAddress });
    logger.log('Connected to Temporal server successfully.');

    logger.log(`Workflow external name: ${workflowExternalName}`);
    logger.log('Creating Temporal worker...');
    worker = await Worker.create({
        connection,
        workflowsPath: require.resolve(`./${workflowExternalName}`),
        activities,
        taskQueue: workflowExternalName,
        namespace,
        identity: workerId,
    });
    logger.log('Temporal worker created successfully.');

    logger.log('Starting Temporal worker...');
    worker.run().catch((err) => {
        logger.error('Worker run failed:', err);
        process.exit(1);
    });
    logger.log('Temporal worker is now running.');
}

// Health endpoint
app.get('/health', (req: Request, res: Response) => {


    if (!worker) {
        logger.log('HealthCheck : Worker not initialized yet.');
        // Worker not initialized yet
        res.status(200).json({ status: 'healthy', state: 'NOT-INITIALIZED' });
        return;
    }

    const { runState } = worker.getStatus() as WorkerStatus;
    if (isShutdownState(runState)) {
        logger.log('HealthCheck : Worker is effectively shutdown.');
        // Worker is effectively shutdown
        res.status(200).json({ status: 'ok', state: 'shutdown' });
    } else {
        // logger.log(`HealthCheck : Assigned Worker is Healthy and in ${runState}.`);
        // Worker is running or in a transitional state
        res.status(200).json({ status: 'healthy', state: runState });
    }
});

// Shutdown endpoint
app.get('/shutdown', async (req: Request, res: Response) => {
    logger.log('Shutdown requested.');

    if (!worker) {
        // Worker not initialized
        res.status(400).json({ error: 'Worker is not initialized.' });
        return;
    }

    const { runState } = worker.getStatus() as WorkerStatus;

    if (runState === 'RUNNING' || runState === 'INITIALIZED') {
        logger.log('Worker is RUNNING, proceeding to shutdown...');
        await worker.shutdown();
        logger.log('Worker has shut down successfully.');
        res.status(200).json({ status: 'shutdown' });
    } else if (isShutdownState(runState)) {
        // Already shut down
        logger.log(`Worker is already in state: ${runState}, considered shutdown.`);
        res.status(200).json({ status: 'shutdown' });
    } else {
        // Other states like STOPPING, DRAINING not allowed for immediate shutdown
        logger.warn(`Cannot shutdown worker in state: ${runState}`);
        res.status(400).json({ error: `Worker cannot be shutdown in state: ${runState}` });
    }
});

// Start the server and the worker
app.listen(port, async () => {
    logger.log(`Health and state service running on port ${port}`);
    await createAndRunWorker();
    logger.log('Health and State Service (and Worker) started successfully.');
});
