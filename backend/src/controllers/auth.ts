import { Request, Response } from 'express';
import { prisma } from '../services/db';
import { hashPassword, verifyPassword, generateToken } from '../services/auth';

/**
 * Handle user registration
 */
export async function signup(req: Request, res: Response) {
  try {
    const { email, password, name, role } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required fields' });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email is already registered' });
    }

    // Hash password and assign valid role (default: PILOT)
    const assignedRole = role === 'ADMIN' ? 'ADMIN' : 'PILOT';
    const passwordHash = await hashPassword(password);

    // Save to DB
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role: assignedRole,
      },
    });

    // Generate JWT token
    const token = generateToken({ id: user.id, email: user.email, role: user.role });

    return res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ error: 'Internal server error during registration' });
  }
}

/**
 * Handle user login
 */
export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password hash
    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate token
    const token = generateToken({ id: user.id, email: user.email, role: user.role });

    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error during authentication' });
  }
}
