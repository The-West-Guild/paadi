export const redisKeys = {
  otp: (purpose: string, target: string): string => `otp:${purpose}:${target}`,
  otpAttempts: (purpose: string, target: string): string => `otp:attempts:${purpose}:${target}`,
  otpResend: (purpose: string, target: string): string => `otp:resend:${purpose}:${target}`,
  signup: (token: string): string => `signup:${token}`,
  sessionDenylist: (sid: string): string => `denylist:session:${sid}`,
  usernameTombstone: (normalized: string): string => `username:tombstone:${normalized}`,
  usernameRename: (userId: string): string => `username:rename:${userId}`
};
