import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { ConflictError, NotFoundError, UnauthorizedError } from '../domain/errors.js';
import type { AuthUser, Role, User } from '../domain/types.js';
import type { UsersRepo } from '../repositories/users.js';

const BCRYPT_ROUNDS = 12;
// Constant-time-ish path for unknown emails so timing does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 4);

export interface NewUser { email: string; password: string; name: string; role: Role }

export class AuthService {
  constructor(
    private readonly users: UsersRepo,
    private readonly secret: string,
    private readonly expiresIn: string,
    private readonly rounds: number = BCRYPT_ROUNDS,
  ) {}

  async createUser(input: NewUser): Promise<User> {
    const email = input.email.trim().toLowerCase();
    if (await this.users.findByEmailWithHash(email)) throw new ConflictError('Email is already registered');
    const passwordHash = await bcrypt.hash(input.password, this.rounds);
    return this.users.create({ email, passwordHash, name: input.name.trim(), role: input.role });
  }

  async updateUser(id: string, patch: { name?: string; role?: Role; password?: string }): Promise<User> {
    const passwordHash = patch.password ? await bcrypt.hash(patch.password, this.rounds) : undefined;
    const user = await this.users.update(id, { name: patch.name, role: patch.role, passwordHash });
    if (!user) throw new NotFoundError('User');
    return user;
  }

  async changePassword(email: string, currentPassword: string, newPassword: string): Promise<void> {
    const found = await this.users.findByEmailWithHash(email);
    if (!found || !(await bcrypt.compare(currentPassword, found.passwordHash))) throw new UnauthorizedError('Current password is incorrect');
    await this.users.update(found.id, { passwordHash: await bcrypt.hash(newPassword, this.rounds) });
  }

  async bootstrapAdmin(email: string | undefined, password: string | undefined): Promise<User | undefined> {
    if (!email || !password) return undefined;
    if ((await this.users.count()) > 0) return undefined;
    return this.createUser({ email, password, name: 'Administrator', role: 'admin' });
  }

  async login(email: string, password: string): Promise<{ token: string; user: User }> {
    const found = await this.users.findByEmailWithHash(email.trim().toLowerCase());
    const ok = await bcrypt.compare(password, found?.passwordHash ?? DUMMY_HASH);
    if (!found || !ok) throw new UnauthorizedError('Invalid email or password');
    const { passwordHash: _omit, ...user } = found;
    const token = jwt.sign({ email: user.email, role: user.role }, this.secret, {
      subject: user.id,
      expiresIn: this.expiresIn as SignOptions['expiresIn'],
      algorithm: 'HS256',
    });
    return { token, user };
  }

  /** Verifies the token AND that the user still exists, using the current role from the DB. */
  async authenticate(token: string): Promise<AuthUser> {
    let sub: string | undefined;
    try {
      const payload = jwt.verify(token, this.secret, { algorithms: ['HS256'] });
      sub = typeof payload === 'object' ? payload.sub : undefined;
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
    if (!sub) throw new UnauthorizedError('Invalid or expired token');
    const user = await this.users.findById(sub);
    if (!user) throw new UnauthorizedError('Invalid or expired token');
    return { id: user.id, email: user.email, role: user.role };
  }
}
