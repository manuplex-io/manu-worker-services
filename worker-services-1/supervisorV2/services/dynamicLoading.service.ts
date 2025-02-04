import { Worker } from 'worker_threads';
import { Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { RedisService } from './redis.service';
import { KafkaService } from './kafka.service';
import { OB1AgentService } from '../interfaces/ob1AgentService.interface';
export class DynamicLoadingService {
    private logger = new Logger(DynamicLoadingService.name);
    private workerThreads = new Map<number, Worker>();

    constructor(private redisService: RedisService, private kafkaService: KafkaService) { }

    async loadWorker(workerId: number, workflowName: string, temporalWorkflowId: string): Promise<boolean> {

        const existingWorker = this.workerThreads.get(workerId);
        if (existingWorker) {
            existingWorker.terminate();
            this.workerThreads.delete(workerId);
            this.logger.log(`Worker${workerId} thread terminated.`);
        }
        const workerName = `worker${workerId}`;
        this.logger.log(`Starting to load workflow '${workflowName}' for worker '${workerName}'.`);

        try {
            const { workflowCode, activityCode, imports } = await this.redisService.getWorkflowDetails(workflowName);
            // const subWorkflowDetails = await this.redisService.getSubworkflowDetails(workflowName);

            if (!workflowCode) {
                this.logger.error(`Workflow or activity code missing for '${workflowName}'.`);
                // Kafka call to get the workflow code
                const request : OB1AgentService.CRUDRequest = {
                    userOrgId: 'worker-service-1',
                    sourceFunction: 'loadWorkflow',
                    CRUDFunctionNameInput: 'workflowCRUD-V1',
                    CRUDFunctionInput: {
                        CRUDOperationName: 'GET',
                        CRUDRoute: 'workflows/getCodeV2',
                        queryParams: {workflowExternalName: workflowName}
                    },
                    personRole: 'USER',
                    personId: 'worker-service-1'
                };
                await this.kafkaService.sendMessage(request);                
                return false;
            }

            const workerFolder = path.join(process.cwd(), 'workerFolder', workerName);
            // try deleting the existing worker folder if it exists
            try {
                await fs.rm(workerFolder, { recursive: true, force: true });
            } catch (error) {
                this.logger.warn(`Worker folder '${workerFolder}' does not exist.`);
            }

            await fs.mkdir(workerFolder, { recursive: true });

            if (imports && imports.length > 0) {
                for (const moduleName of imports) {
                    try {
                        require.resolve(moduleName);
                        this.logger.log(`Module '${moduleName}' is already installed.`);
                    } catch {
                        this.logger.log(`Installing module '${moduleName}' globally.`);
                        await this.installModuleGlobally(moduleName, workerFolder);
                    }
                }
            }

            //Destination Paths
            const activityFilePath = path.join(workerFolder, 'myActivity.ts');
            const workflowFilename = `${workflowName}.ts`;
            const workflowFilePath = path.join(workerFolder, workflowFilename);            
            const tsconfigFilePath = path.join(workerFolder, 'tsconfig.json');
            const customLoggerFilePath = path.join(workerFolder, 'customLogger.ts');
            const workerFilePath = path.join(workerFolder, 'worker.ts');

            this.logger.log(`WORKER FOLDER: ${workerFolder}`);
            this.logger.log(`ACTIVITY FILE PATH: ${activityFilePath}`);
            //Source Paths
            // const workerTemplatePath = path.join(process.cwd(), 'supervisorV2', 'templates', 'workerTemplateV1.ts');

            const tsconfigContent = await fs.readFile(path.join(process.cwd(), 'supervisorV2', 'templates', 'tsconfig.json'), 'utf8');
            const customLoggerContent = await fs.readFile(path.join(process.cwd(), 'supervisorV2', 'templates', 'customLogger.ts'), 'utf8');
            const workerTemplateContent = await fs.readFile(path.join(process.cwd(), 'supervisorV2', 'templates', 'workerTemplateV1.ts'), 'utf8');

            //Write to files
            await fs.writeFile(activityFilePath, activityCode || 'export {};', 'utf8');
            await fs.writeFile(workflowFilePath, workflowCode, 'utf8');
            await fs.writeFile(tsconfigFilePath, tsconfigContent, 'utf8');
            await fs.writeFile(customLoggerFilePath, customLoggerContent, 'utf8');
            await fs.writeFile(workerFilePath, workerTemplateContent, 'utf8');

            // // Handle subworkflows - EXPERIMENTAL
            // if (Object.keys(subWorkflowDetails).length > 0) {
            //     this.logger.log(`Creating ${Object.keys(subWorkflowDetails).length} subworkflow files`);
                
            //     for (const [key, code] of Object.entries(subWorkflowDetails)) {
            //         const subworkflowPath = path.join(workerFolder, `${key}.ts`);
            //         await fs.writeFile(subworkflowPath, code, 'utf8');
            //         this.logger.log(`Created subworkflow file: ${subworkflowPath}`);
            //     }
            // }

            if (!fsSync.existsSync(tsconfigFilePath)) {
                this.logger.error(`TSCONFIG FILE PATH: ${tsconfigFilePath} does not exist.`);
            }

            await this.compileTypeScript(workerFolder);

            const jsWorkerPath = path.join(workerFolder, 'worker.js');
            if (!await fs.access(jsWorkerPath).then(() => true).catch(() => false)) {
                throw new Error('Compilation failed: JavaScript file not created');
            }

            this.startWorkerThread(workerId, jsWorkerPath, temporalWorkflowId, workflowName);

            this.logger.log(`Successfully loaded workflow '${workflowName}' for worker '${workerName}'.`);
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
            this.logger.error(`Error loading worker '${workerId}': ${errorMessage}`);
            return false;
        }
    }

    async loadDefaultWorker(workerName: string): Promise<boolean> {
        const workerFolder = path.join(process.cwd(), 'workerFolder', workerName);

        const defaultWorkerPath = path.join(process.cwd(), 'supervisorV2', 'templates', 'defaultWorker');

        this.logger.log(`loading default worker '${workerName}'...`);

        try {

            //try deleteing the existing worker folder if it exists
            try {
                await fs.rm(workerFolder, { recursive: true, force: true });
            } catch (error) {
                this.logger.warn(`Worker folder '${workerFolder}' does not exist.`);
            }
            //await fs.rm(workerFolder, { recursive: true, force: true });
            await fs.mkdir(workerFolder, { recursive: true });
            await fs.cp(defaultWorkerPath, workerFolder, { recursive: true });
            //await this.compileTypeScript(workerFolder);

            const jsWorkerPath = path.join(workerFolder, 'worker.js');
            const workerId = parseInt(workerName.replace('worker', ''), 10);
            this.startWorkerThread(workerId, jsWorkerPath, 'commonWorker');  // we can load ENV variables against the commonWorker if needed

            this.logger.log(`Worker '${workerName}' reset successfully.`);
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
            this.logger.error(`Error resetting worker '${workerName}': ${errorMessage}`);
            return false;
        }
    }

    private async compileTypeScript(folderPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!fsSync.existsSync(folderPath)) {
                fsSync.mkdirSync(folderPath, { recursive: true });
            }

            // Add this logging
            this.logger.log(`Folder contents before compilation:`);
            const files = fsSync.readdirSync(folderPath);
            files.forEach(file => this.logger.log(`- ${file}`));

            exec(`npx tsc --project ${folderPath}`, (error, stdout, stderr) => {
                if (error) {
                    this.logger.error(`TypeScript compilation failed:`);
                    this.logger.error(`Error: ${error.message}`);
                    this.logger.error(`Stderr: ${stderr}`);
                    this.logger.error(`Stdout: ${stdout}`);
                    reject(error);
                } else {
                    this.logger.log(`TypeScript compilation successful: ${stdout}`);
                    resolve();
                }
            });
        });
    }

    private async startWorkerThread(workerId: number, workerPath: string, temporalWorkflowId: string, workflowName: string = 'myWorkflow'): Promise<void> {
        // first delete the existing worker thread if it exists
        const existingWorker = this.workerThreads.get(workerId);
        if (existingWorker) {
            existingWorker.terminate();
            this.workerThreads.delete(workerId);
            this.logger.log(`Worker${workerId} thread terminated.`);
        }

        const ENVVariables: Record<string, any> = await this.redisService.getWorkflowENVVariables(temporalWorkflowId);

        this.logger.log(`ENV Variables for Worker${workerId}, for temporalWorkflowId ${temporalWorkflowId}  are: ${JSON.stringify(ENVVariables)}`);
        const worker = new Worker(workerPath, {
            env: {
                ...ENVVariables,
                TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS || 'temporal-server-1.manuplex-uswest-2.local:7233',
                TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE || 'ob1-temporal-namespace',
                AG_TEMPORAL_QUE_NAME: process.env.AG_TEMPORAL_QUE_NAME || 'agentprocess_QUEUE',
                OPENAI_API_KEY: process.env.OPENAI_API_KEY,
                PORTKEY_API_KEY: process.env.PORTKEY_API_KEY,
                AWS_REGION: process.env.AWS_REGION,
                AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
                AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
                LAMBDA_ROLE_ARN: process.env.LAMBDA_ROLE_ARN,
                ENV: process.env.ENV,
                TEMPORAL_WORKER_ID: `worker${workerId}`,
                TEMPORAL_WORKER_PORT: (5001 + workerId).toString(),
                WORKFLOW_EXTERNAL_NAME: workflowName
            },
        });

        worker.on('message', (msg) => {
            this.logger.log(`Worker${workerId} message: ${msg}`);
        });

        worker.on('error', (err) => {
            this.logger.error(`Worker${workerId} error: ${err.message}`);
        });

        worker.on('exit', (code) => {
            this.logger.log(`Worker${workerId} exited with code ${code}`);
            this.workerThreads.delete(workerId);
        });

        this.workerThreads.set(workerId, worker);
        this.logger.log(`Worker${workerId} thread started.`);
    }

    private async installModuleGlobally(moduleName: string, workerFolder: string): Promise<void> {
        // const workerFolder = path.join(process.cwd(), 'workerFolder');
        
        return new Promise(async (resolve, reject) => {
            try {
                // First try to install the main package
                await new Promise((res, rej) => {
                    exec(`cd ${workerFolder} && npm install ${moduleName}`, (error, stdout, stderr) => {
                        if (error) {
                            this.logger.error(`Error installing module '${moduleName}': ${stderr}`);
                            rej(error);
                        } else {
                            this.logger.log(`Module '${moduleName}' installed: ${stdout}`);
                            res(stdout);
                        }
                    });
                });
    
                try {
                    await new Promise((res, rej) => {
                        exec(`cd ${workerFolder} && npm install --save-dev @types/${moduleName}`, (error) => {
                            if (error) {
                                this.logger.warn(`No @types/${moduleName} available - skipping`);
                            } else {
                                this.logger.log(`Types for ${moduleName} installed`);
                            }
                            res(null); // Always resolve, we don't want this to fail the main installation
                        });
                    });
                } catch {
                    // Ignore errors from types installation for now
                }
    
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

}
