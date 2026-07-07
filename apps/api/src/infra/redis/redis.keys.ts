export const redisKeys = {
  otp: (purpose: string, target: string): string => `otp:${purpose}:${target}`,
  otpAttempts: (purpose: string, target: string): string => `otp:attempts:${purpose}:${target}`,
  otpResend: (purpose: string, target: string): string => `otp:resend:${purpose}:${target}`,
  signup: (token: string): string => `signup:${token}`,
  sessionDenylist: (sid: string): string => `denylist:session:${sid}`,
  usernameTombstone: (normalized: string): string => `username:tombstone:${normalized}`,
  usernameRename: (userId: string): string => `username:rename:${userId}`,
  apiKeyPrincipal: (keyHash: string): string => `apikey:principal:${keyHash}`,
  apiKeyTouch: (keyId: string): string => `apikey:touch:${keyId}`,
  rateLimit: (tracker: string, window: number): string => `ratelimit:${tracker}:${window}`
};
