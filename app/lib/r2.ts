type R2Like = {
  put?: (...args: any[]) => Promise<unknown>;
  get?: (...args: any[]) => Promise<unknown>;
  createMultipartUpload?: (...args: any[]) => Promise<unknown>;
  resumeMultipartUpload?: (...args: any[]) => unknown;
};

export function r2Bucket(env: Record<string, unknown>): R2Like | undefined {
  return (env.BUCKET || env.delta_auto_lot_walks) as R2Like | undefined;
}
