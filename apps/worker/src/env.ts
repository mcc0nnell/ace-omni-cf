export interface Env {
  DB: D1Database;
  EVIDENCE: R2Bucket;
  CALL_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  SESSION_SECRET: string;
  INVITE_SECRET: string;
  TURN_SECRET?: string;
  TURN_HOST?: string;
}
