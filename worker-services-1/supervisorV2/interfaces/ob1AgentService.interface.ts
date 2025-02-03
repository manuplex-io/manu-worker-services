export namespace OB1Global {
    export interface MessageHeaderV2 {
      schemaVersion: string;
      sourceService: string;
      sourceFunction: string;
      personId: string;
      userOrgId: string;
      destinationService?: string;
      requestId?: string;
      responseId?: string;
      sourceType?: string;
      kafka_replyPartition?: number;
      kafka_replyTopic?: string;
      personRole?: string;
      consultantOrgID?: string;
      sourceServiceId?: string;
    }
  }
  
export namespace OB1AgentService {
    export interface MessageContentV1 {
      functionName: string;
      functionInput: any;
    }
  
    export interface MessageIncomingValueV2 {
      messageContent: MessageContentV1;
      messageType: string;
      projectId?: string;
      assetId?: string;
      conversationId?: string;
    }
    
    export interface CRUDRequest {
      messageKey?: string;
      userOrgId: string;
      sourceFunction: string;
      CRUDFunctionNameInput: string;
      CRUDFunctionInput: {
        CRUDOperationName: string;
        CRUDRoute: string;
        CRUDBody?: any;
        queryParams?: Record<string, any>;
      };
      personRole: string;
      personId: string;
    }
}