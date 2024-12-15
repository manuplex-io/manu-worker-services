import { Worker } from 'worker_threads';
import { Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { RedisService } from './redis.service';


export class DynamicLoadingService {
    private logger = new Logger(DynamicLoadingService.name);
    private workerThreads = new Map<number, Worker>();

    constructor(private redisService: RedisService) { }

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
            if (!workflowCode || !activityCode) {
                this.logger.error(`Workflow or activity code missing for '${workflowName}'.`);
                return false;
            }

            if (imports && imports.length > 0) {
                for (const moduleName of imports) {
                    try {
                        require.resolve(moduleName);
                        this.logger.log(`Module '${moduleName}' is already installed.`);
                    } catch {
                        this.logger.log(`Installing module '${moduleName}' globally.`);
                        await this.installModuleGlobally(moduleName);
                    }
                }
            }

            const workerFolder = path.join(process.cwd(), 'workerFolder', workerName);
            await fs.mkdir(workerFolder, { recursive: true });


            //Destination Paths
            const activityFilePath = path.join(workerFolder, 'myActivity.ts');
            const workflowFilePath = path.join(workerFolder, 'myWorkflow.ts');
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
            await fs.writeFile(activityFilePath, activityCode, 'utf8');
            await fs.writeFile(workflowFilePath, workflowCode, 'utf8');
            await fs.writeFile(tsconfigFilePath, tsconfigContent, 'utf8');
            await fs.writeFile(customLoggerFilePath, customLoggerContent, 'utf8');
            await fs.writeFile(workerFilePath, workerTemplateContent, 'utf8');

            // Create dist directory
            // const distFolder = path.join(workerFolder, 'dist');
            // await fs.mkdir(distFolder, { recursive: true });

            if (!fsSync.existsSync(tsconfigFilePath)) {
                this.logger.error(`TSCONFIG FILE PATH: ${tsconfigFilePath} does not exist.`);
            }

            await this.compileTypeScript(workerFolder);

            const jsWorkerPath = path.join(workerFolder, 'worker.js');
            if (!await fs.access(jsWorkerPath).then(() => true).catch(() => false)) {
                throw new Error('Compilation failed: JavaScript file not created');
            }

            this.startWorkerThread(workerId, jsWorkerPath, temporalWorkflowId);

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

    private startWorkerThread(workerId: number, workerPath: string, temporalWorkflowId: string): void {
        // first delete the existing worker thread if it exists
        const existingWorker = this.workerThreads.get(workerId);
        if (existingWorker) {
            existingWorker.terminate();
            this.workerThreads.delete(workerId);
            this.logger.log(`Worker${workerId} thread terminated.`);
        }

        const ENVVariables: Record<string, any> = this.redisService.getWorkflowENVVariables(temporalWorkflowId);

        this.logger.log(`ENV Variables for Worker${workerId}, for temporalWorkflowId ${temporalWorkflowId}  are: ${JSON.stringify(ENVVariables)}`);
        const worker = new Worker(workerPath, {
            env: {
                ...ENVVariables,
                TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS || 'temporal-server-1.manuplex-uswest-2.local:7233',
                TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE || 'ob1-temporal-namespace',
                AG_TEMPORAL_QUE_NAME: process.env.AG_TEMPORAL_QUE_NAME || 'agentprocess_QUEUE',
                TEMPORAL_WORKER_ID: `worker${workerId}`,
                TEMPORAL_WORKER_PORT: (5001 + workerId).toString(),

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

    private installModuleGlobally(moduleName: string): Promise<void> {
        return new Promise((resolve, reject) => {
            exec(`npm install -g ${moduleName}`, (error, stdout, stderr) => {
                if (error) {
                    this.logger.error(`Error installing module '${moduleName}': ${stderr}`);
                    reject(error);
                } else {
                    this.logger.log(`Module '${moduleName}' installed globally: ${stdout}`);
                    resolve();
                }
            });
        });
    }

}
