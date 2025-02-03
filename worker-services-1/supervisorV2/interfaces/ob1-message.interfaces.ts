// import { plainToInstance } from 'class-transformer';
// import {
//     IsNotEmpty, IsOptional, IsString, IsNumber, Matches, validateOrReject, IsObject, Min, Max,
//     IsBoolean
// } from 'class-validator';
// import { Logger } from '@nestjs/common';
// import { KafkaContext } from '@nestjs/microservices';

// // Define current and compatible schema versions
// export const CURRENT_SCHEMA_VERSION = "0.1.6";
// export const MIN_COMPATIBLE_SCHEMA_VERSION = "0.1.6";
// export const MAX_COMPATIBLE_SCHEMA_VERSION = "0.1.6";

// // Define disallowed values for Header validation
// const disallowedValues = [null, undefined, ''];

// // Instantiate the NestJS Logger
// const logger = new Logger('OB1KafkaMessageValidator');

// // Namespace for Agent Service
// export namespace OB1AgentService {
//     export class MessageContentV1 {
//         @IsNotEmpty()
//         @IsString()
//         functionName: string;

//         @IsNotEmpty()
//         @IsObject()
//         functionInput: { [key: string]: any };
//     }
//     export class MessageIncomingValueV2 {
//         @IsNotEmpty()
//         @IsObject()
//         messageContent: OB1AgentService.MessageContentV1;

//         @IsNotEmpty()
//         @IsString()
//         messageType: string;

//         @IsOptional()
//         @IsString()
//         projectId?: string;

//         @IsOptional()
//         @IsString()
//         assetId?: string;

//         @IsOptional()
//         @IsString()
//         conversationId?: string;
//     }
// }

// export namespace OB1Global {
//     export class MessageResponseValueV2 {
//         messageContent: { [key: string]: any };

//         @IsNotEmpty()
//         @IsString()
//         messageType: string;

//         @IsOptional()
//         @IsString()
//         projectId?: string;

//         @IsOptional()
//         @IsString()
//         assetId?: string;

//         @IsOptional()
//         @IsString()
//         conversationId?: string;

//         @IsOptional()
//         @IsBoolean()
//         error: boolean;

//         //either error or response code is cumpulsory
//         @IsOptional()
//         @IsNumber()
//         errorCode?: number;

//         @IsOptional()
//         @IsNumber()
//         responseCode?: number;


//         @IsOptional()
//         @IsString()
//         errorMessage?: string;

//     }

//     export class MessageHeaderV2 {
//         @IsNotEmpty()
//         @IsString()
//         sourceService: string;

//         @IsNotEmpty()
//         @IsString()
//         @Matches(/^0\.\d+\.\d+$/, { message: 'schemaVersion must match the semantic versioning format (e.g., 0.1.6).' })
//         schemaVersion: string;

//         @IsNotEmpty()
//         @IsString()
//         personId: string;

//         @IsNotEmpty()
//         @IsString()
//         userOrgId: string;

//         @IsOptional()
//         @IsString()
//         destinationService?: string;

//         @IsOptional()
//         @IsString()
//         requestId?: string;

//         @IsOptional()
//         @IsString()
//         responseId?: string;

//         @IsOptional()
//         @IsString()
//         sourceFunction?: string;

//         @IsOptional()
//         @IsString()
//         sourceType?: string;

//         @IsOptional()
//         @IsNumber()
//         kafka_replyPartition?: number;

//         @IsOptional()
//         @IsString()
//         kafka_replyTopic?: string;

//         @IsOptional()
//         @IsString()
//         personRole?: string;

//         @IsOptional()
//         @IsString()
//         consultantOrgID?: string;

//         @IsOptional()
//         @IsString()
//         sourceServiceId?: string;
//     }
// }

// // Function to check schema version compliance
// export function validateSchemaVersion(header: OB1Global.MessageHeaderV2): { valid: boolean; errorMessage?: string } {
//     const incomingVersion = header.schemaVersion;

//     if (incomingVersion === CURRENT_SCHEMA_VERSION) {
//         return { valid: true }; // Valid schema version
//     }

//     if (incomingVersion >= MIN_COMPATIBLE_SCHEMA_VERSION && incomingVersion <= MAX_COMPATIBLE_SCHEMA_VERSION) {
//         logger.warn(
//             `Schema version mismatch: Expected ${CURRENT_SCHEMA_VERSION}, received ${incomingVersion}. ` +
//             `Proceeding with backward-compatible version.`,
//         );
//         return { valid: true }; // Backward-compatible schema version
//     }

//     const errorMessage = `Unsupported schema version: ${incomingVersion}. Compatible versions are between ${MIN_COMPATIBLE_SCHEMA_VERSION} and ${MAX_COMPATIBLE_SCHEMA_VERSION}.`;
//     logger.error(errorMessage);

//     return { valid: false, errorMessage };
// }



// // Function to validate Kafka message fields Global Headers and Service specific message value
// export async function validateIncomingKafkaMessageFields(
//     context: KafkaContext,
// ): Promise<{ valid: boolean; errorMessage?: string }> {
//     const message = context.getMessage();
//     const SERVICE_NAME = process.env.SERVICE_NAME;

//     // Extract headers and value from the Kafka message
//     const headers = message.headers as unknown as OB1Global.MessageHeaderV2;
//     let messageValue: OB1AgentService.MessageIncomingValueV2;

//     try {
//         // Parse message value
//         if (Buffer.isBuffer(message.value)) {
//             messageValue = JSON.parse(message.value.toString()) as OB1AgentService.MessageIncomingValueV2;
//         } else {
//             messageValue = message.value as OB1AgentService.MessageIncomingValueV2;
//         }

//         // Validate schema version
//         const schemaValidation = validateSchemaVersion(headers);
//         if (!schemaValidation.valid) {
//             return { valid: false, errorMessage: schemaValidation.errorMessage };
//         }

//         // Check destinationService
//         if (headers.destinationService !== SERVICE_NAME) {
//             const errorMessage = `Message sent to the wrong service: Expected ${SERVICE_NAME}, but received ${headers.destinationService}.`;
//             logger.error(errorMessage);
//             return { valid: false, errorMessage };
//         }

//         // Validate headers and value using ValidationPipe-like logic
//         const headerInstance = plainToInstance(OB1Global.MessageHeaderV2, headers);
//         await validateOrReject(headerInstance);

//         const valueInstance = plainToInstance(OB1AgentService.MessageIncomingValueV2, messageValue);
//         await validateOrReject(valueInstance);

//         logger.log('Message validation completed successfully');
//         return { valid: true };
//     } catch (error) {
//         const errorMessage = `Message validation error: ${error.message}`;
//         logger.error(errorMessage);
//         return { valid: false, errorMessage };
//     }
// }


// /**
//  * Validates the outgoing message header for compliance with OB1Global.MessageHeaderV2
//  * @param messageHeader - The message header to validate
//  */
// export async function validateOutgoingMessageHeader(
//     messageHeader: OB1Global.MessageHeaderV2,
// ): Promise<void> {
//     // Step 1: Check for null or invalid values in required fields
//     for (const [key, value] of Object.entries(messageHeader)) {
//         if (disallowedValues.includes(value)) {
//             const errorMessage = `Validation failed for messageHeader: ${key} has an invalid value (${value}).`;
//             logger.error(errorMessage);
//             throw new Error(errorMessage); // Use a regular error
//         }
//     }

//     // Step 2: Additional checks for specific fields
//     if (!/^[A-Za-z0-9-_]+$/.test(messageHeader.sourceService)) {
//         const errorMessage = `Validation failed for messageHeader: sourceService contains invalid characters.`;
//         logger.error(errorMessage);
//         throw new Error(errorMessage); // Use a regular error
//     }

//     // Step 3: Validate using ValidationPipe-like logic
//     try {
//         const headerInstance = plainToInstance(OB1Global.MessageHeaderV2, messageHeader);
//         await validateOrReject(headerInstance);

//         logger.log('Outgoing message header validation completed successfully');
//     } catch (error) {
//         const errorMessage = `Outgoing message header validation error: ${error.message}`;
//         logger.error(errorMessage);
//         throw new Error(errorMessage); // Use a regular error
//     }
// }

// /**
//  * Generates a structured error response.
//  * @param errorCode - The error code (default: 400).
//  * @param errorMessage - The error message (default: 'Unknown error').
//  * @param messageDetails - Additional details about the error (default: 'No details available').
//  * @returns A structured error response.
//  */
// export function generateDefaultErrorMessageResponseValue(
//     errorCode: number = 400,
//     errorMessage: string = 'Unknown error',
//     messageDetails: any = 'No details available',
// ): { error: boolean; errorCode: number; errorMessage: string; messageContent: { errorDetails: any } } {
//     return {
//         error: true,
//         errorCode,
//         errorMessage,
//         messageContent: {
//             errorDetails: messageDetails,
//         },
//     };
// }




