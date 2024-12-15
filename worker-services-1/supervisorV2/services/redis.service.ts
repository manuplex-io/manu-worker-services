import { createClient } from 'redis';
import { Logger } from '@nestjs/common';


const RedisHost = process.env.REDIS_STACK_HOST || 'redis-stack-server-1.manuplex-uswest-2.local';
const RedisPort = parseInt(process.env.REDIS_STACK_PORT || '6379', 10);
const RedisPassword = process.env.REDIS_STACK_PASSWORD || 'notdefined';

export class RedisService {
    private logger = new Logger(RedisService.name);
    private client = createClient({
        socket: {
            host: RedisHost,
            port: RedisPort,
        },
        password: RedisPassword,
    });

    constructor() {
        this.client.on('error', (err) => console.error('Redis Client Error:', err));
        this.client.connect();
    }

    /**
     * Check if a workflow exists in Redis.
     * @param workflowName Name of the workflow to check.
     * @returns True if the workflow exists, otherwise false.
     */
    async isWorkflowAvailable(workflowName: string): Promise<boolean> {
        const key = `agentService:workerService:workflows:${workflowName}`;
        return (await this.client.exists(key)) === 1;
    }

    //make a new function to retrieve a json object from redis at agentService:workerService:workflows:${temporalWorkflowId}:ENV
    async getWorkflowENVVariables(temporalWorkflowId: string): Promise<Record<string, any>> {
        const key = `agentService:workerService:ENVVaribales:${temporalWorkflowId}`;
        const data = await this.client.get(key);
        return data ? JSON.parse(data) : {};
    }


    /**
     * Fetch workflow details: workflow code, activity code, and imports.
     * @param workflowName Name of the workflow.
     * @returns An object with workflowCode, activityCode, and imports.
     */
    async getWorkflowDetails(workflowName: string): Promise<{
        workflowCode: string | null;
        activityCode: string | null;
        imports: string[] | null;
    }> {
        this.logger.debug(`Fetching workflow details for: ${workflowName}`);

        const workflowKey = `agentService:workerService:workflows:${workflowName}`;
        const activityKey = `agentService:workerService:workflows:${workflowName}:activityCode`;
        const importsKey = `agentService:workerService:workflows:${workflowName}:imports`;

        this.logger.debug(`Using Redis keys:
        Workflow: ${workflowKey}
        Activity: ${activityKey}
        Imports: ${importsKey}`);

        try {
            // Verify key types before fetching
            const [workflowType, activityType, importsType] = await Promise.all([
                this.client.type(workflowKey),
                this.client.type(activityKey),
                this.client.type(importsKey),
            ]);

            this.logger.debug(`Redis key types:
            Workflow key type: ${workflowType}
            Activity key type: ${activityType}
            Imports key type: ${importsType}`);

            // Fetch workflow and activity code
            const [workflowCode, activityCode] = await Promise.all([
                this.client.get(workflowKey),
                this.client.get(activityKey),
            ]);

            // Handle imports based on type
            let imports: string[] | null = null;
            if (importsType === 'list') {
                imports = await this.client.lRange(importsKey, 0, -1);
            } else if (importsType === 'set') {
                imports = await this.client.sMembers(importsKey);
            } else if (importsType !== 'none') {
                this.logger.warn(`Imports key ${importsKey} has unexpected type: ${importsType}`);
            }

            // Log retrieved data
            this.logger.debug(`Retrieved data:
            Workflow code exists: ${Boolean(workflowCode)}
            Activity code exists: ${Boolean(activityCode)}
            Number of imports: ${imports?.length ?? 0}`);

            if (!workflowCode) {
                this.logger.warn(`No workflow code found for key: ${workflowKey}`);
            }
            if (!activityCode) {
                this.logger.warn(`No activity code found for key: ${activityKey}`);
            }

            const result = {
                workflowCode,
                activityCode,
                imports: imports && imports.length > 0 ? imports : null,
            };

            this.logger.debug(`Returning workflow details structure: ${JSON.stringify({
                hasWorkflowCode: Boolean(result.workflowCode),
                hasActivityCode: Boolean(result.activityCode),
                importsCount: result.imports?.length ?? 0,
            })}`);

            return result;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
            this.logger.error(`Error fetching workflow details for ${workflowName}: ${errorMessage}`, {
                error,
                workflowName,
                workflowKey,
                activityKey,
                importsKey,
            });

            // Return a structured error response instead of throwing
            return {
                workflowCode: null,
                activityCode: null,
                imports: null,
            };
        }
    }

    //     /**
    //  * Fetch imports for a given workflow from a Redis set.
    //  * @param workflowName Name of the workflow.
    //  * @returns An array of imports or an empty array if no imports exist.
    //  */
    //     async getWorkflowImports(workflowName: string): Promise<string[]> {
    //         const importsKey = `agentService:workerService:${workflowName}:imports`;
    //         const imports = await this.client.sMembers(importsKey); // Fetch all members of the set
    //         return imports || [];
    //     }

    /**
     * Acquire a lock for a specific workflow.
     * @param workflowName Name of the workflow to lock.
     * @param ttl Time-to-live for the lock in seconds.
     * @returns True if the lock was successfully acquired, otherwise false.
     */
    async acquireLock(workflowName: string, ttl: number): Promise<boolean> {
        const lockKey = `agentService:workerService:locks:${workflowName}`;
        const result = await this.client.set(lockKey, 'locked', { NX: true, EX: ttl });
        return result === 'OK';
    }

    /**
     * Release a lock for a specific workflow.
     * @param workflowName Name of the workflow to release the lock for.
     */
    async releaseLock(workflowName: string): Promise<void> {
        const lockKey = `agentService:workerService:locks:${workflowName}`;
        await this.client.del(lockKey);
    }

    /**
     * Check if a lock exists for a specific workflow.
     * @param workflowName Name of the workflow to check.
     * @returns True if the lock exists, otherwise false.
     */
    async isLockExists(workflowName: string): Promise<boolean> {
        const lockKey = `agentService:workerService:locks:${workflowName}`;
        return (await this.client.exists(lockKey)) === 1;
    }

    /**
        * Store the entire worker map as a JSON object in Redis.
        * @param workerMap The worker map to store.
        */
    async storeWorkerMap(workerMap: Map<number, object>): Promise<void> {
        const workersObject = Object.fromEntries(workerMap);
        const key = 'agentService:workerService:workers';

        try {
            const jsonObject = JSON.stringify(workersObject);
            await this.client.set(key, jsonObject);
            //console.log(`Worker map successfully stored in Redis under key: ${key}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
            console.error(`Failed to store worker map in Redis: ${errorMessage}`);
        }
    }

    async debugWorkflowKey(workflowName: string) {
        try {
            const type = await this.client.type(workflowName);
            const data = await this.client.get(workflowName);
            return {
                keyType: type,
                rawData: data,
                parsedData: data ? JSON.parse(data) : null
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
            return {

                error: errorMessage,
                keyType: await this.client.type(workflowName),
                rawData: await this.client.get(workflowName)
            };
        }
    }

    async close() {
        await this.client.quit();
    }
}
