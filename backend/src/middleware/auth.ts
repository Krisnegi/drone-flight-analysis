import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../services/auth';

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

/**
 * Authenticate incoming requests by checking JWT token in Authorization header
 */
export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Extract token from "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required (Format: Bearer <JWT>)' });
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired authentication token' });
  }
}

/**
 * Enforce role-based access control (RBAC) on routes
 */
export function authorize(allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden: Access restricted. Required roles: [${allowedRoles.join(', ')}]` });
    }

    next();
  };
}
