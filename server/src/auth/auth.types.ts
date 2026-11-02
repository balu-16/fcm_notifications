import type { Request } from 'express';
export type Role = 'user' | 'admin';
export interface Principal {
  sub: string;
  email: string;
  role: Role;
}
export interface AuthenticatedRequest extends Request {
  user: Principal;
  requestId: string;
}
