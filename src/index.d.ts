export type EngineState = 'created' | 'initializing' | 'ready' | 'busy' | 'recovering' | 'failed' | 'disposed';
export type EngineErrorCode =
  | 'INVALID_REQUEST' | 'INPUT_LIMIT' | 'NOT_READY' | 'BUSY' | 'DISPOSED'
  | 'UNSUPPORTED_ENVIRONMENT' | 'INITIALIZATION_FAILED' | 'INITIALIZATION_TIMEOUT'
  | 'CANCELLED' | 'RESET' | 'EXECUTION_TIMEOUT' | 'RESOURCE_LIMIT'
  | 'WORKER_FAILURE' | 'RUNTIME_FAILURE' | 'PROTOCOL_ERROR'
  | 'RECOVERY_FAILED' | 'RECOVERY_TIMEOUT';
export type RunRequest = {source: string; filename?: string; timeoutMs?: number};
export type ProgramErrorData = {kind: 'program'; name: string; message: string; stack: string | null; filename: string};
export type EngineErrorData = {kind: 'engine'; code: EngineErrorCode; message: string};
export type ExecutionResult = {
  status: 'ok' | 'program-error' | 'engine-error';
  stdout: string; stderr: string; durationMs: number;
  error: ProgramErrorData | EngineErrorData | null; truncated: boolean;
};
export type RuntimeInfo = Readonly<{
  engineVersion: string; runtimeName: string; runtimeVersion: string;
  bindingVersion: string; variant: string; executionProfile: string;
  policyVersion: string; initialized: boolean;
  capabilities: Readonly<Record<string, boolean>>;
  limits: Readonly<Record<string, number>>;
}>;
export declare class EngineError extends Error {
  readonly name: 'EngineError'; readonly kind: 'engine'; readonly code: EngineErrorCode;
}
export declare class JavaScriptEngine {
  constructor();
  initialize(): Promise<void>;
  run(request: RunRequest): Promise<ExecutionResult>;
  cancel(): Promise<void>;
  reset(): Promise<void>;
  dispose(): void;
  isReady(): boolean;
  isBusy(): boolean;
  getState(): EngineState;
  getRuntimeInfo(): RuntimeInfo;
}
