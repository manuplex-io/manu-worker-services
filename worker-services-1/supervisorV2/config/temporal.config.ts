// src/config/temporal.config.ts
import { Logger } from '@nestjs/common';
import { Worker, NativeConnection } from '@temporalio/worker';
import { Connection, WorkflowClient } from '@temporalio/client';

const Namespace = process.env.TEMPORAL_NAMESPACE || 'ob1-temporal-namespace';
const TemporalAddress = process.env.TEMPORAL_ADDRESS || 'temporal-server-1.manuplex-uswest-2.local:7233';

const logger = new Logger('TemporalConfig');

export const getTemporalConnection = async (name: string): Promise<Connection | null> => {
    try {
        const connection = await Connection.connect({ address: TemporalAddress });
        logger.log(`Successfully connected to Temporal server at ${TemporalAddress} for ${name}`);
        return connection;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        logger.error(`Failed to connect to Temporal server at ${TemporalAddress}: ${errorMessage} for ${name}`);
        return null;
    }
};

// export const getTemporalNativeConnection = async (): Promise<NativeConnection | null> => {
//     try {
//         const nativeConnection = await NativeConnection.connect({ address: TemporalAddress });
//         logger.log(`Successfully created a native connection to Temporal server at ${TemporalAddress}`);
//         return nativeConnection;
//     } catch (error) {
//         const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
//         logger.error(`Failed to create a native connection to Temporal server at ${TemporalAddress}: ${error.message}`);
//         return null;
//     }
// };

export const getWorkflowClient = async (connection: Connection, name: string): Promise<WorkflowClient | null> => {
    try {
        const workflowClient = new WorkflowClient({ connection, namespace: Namespace });
        logger.log(`Successfully created WorkflowClient for namespace ${Namespace} for ${name}`);
        return workflowClient;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        logger.error(`Failed to create WorkflowClient for namespace ${Namespace}: ${errorMessage} for ${name}`);
        return null;
    }
};
