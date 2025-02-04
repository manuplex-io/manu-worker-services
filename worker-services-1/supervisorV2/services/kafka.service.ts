import { Kafka, Producer, ProducerRecord } from 'kafkajs';
import { OB1Global, OB1AgentService } from '../interfaces/ob1AgentService.interface';

export class KafkaService {
  private kafka: Kafka;
  private producer: Producer;
  private isConnected: boolean = false;

  constructor() {
    this.kafka = new Kafka({
        clientId: 'kafka-ob1-v2-client',
        brokers: ['kafka-server-1.manuplex-uswest-2.local:9092'],
        requestTimeout: 60000,
    });

    this.producer = this.kafka.producer();
  }

  async connect(): Promise<void> {
    try {
      await this.producer.connect();
      console.log('Successfully connected to Kafka');
    } catch (error) {
      console.error('Error connecting to Kafka:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.producer.disconnect();
      console.log('Successfully disconnected from Kafka');
    } catch (error) {
      console.error('Error disconnecting from Kafka:', error);
      throw error;
    }
  }

  async sendMessage(request: OB1AgentService.CRUDRequest): Promise<void> {
    try {
      if (!this.isConnected) {
        await this.connect();
        this.isConnected = true;
      }

      const messageHeader: OB1Global.MessageHeaderV2 = {
        schemaVersion: '0.1.6',
        sourceService: 'worker-service-1',
        sourceFunction: request.sourceFunction,
        userOrgId: request.userOrgId,
        destinationService: 'agent-services',
        sourceType: 'system',
        personId: request.personId,
        requestId: `RQ-${request.sourceFunction}-${Date.now()}`,
        personRole: request.personRole
      };

      const messageContent = {
        functionName: request.CRUDFunctionNameInput,
        functionInput: request.CRUDFunctionInput
      };

      const messageValue: OB1AgentService.MessageIncomingValueV2 = {
        messageContent,
        messageType: 'REQUEST'
      };

      const record: ProducerRecord = {
        topic: 'manuos-ob1-agentService',
        messages: [
          {
            key: request.messageKey || 'system',
            value: JSON.stringify(messageValue),
            headers: messageHeader as any
          },
        ],
      };

      await this.producer.send(record);
      console.log(`Message sent to topic ${request.CRUDFunctionNameInput} successfully`);
    } catch (error) {
      console.error('Error sending message:', error);
      this.isConnected = false;
      throw error;
    }
  }
}