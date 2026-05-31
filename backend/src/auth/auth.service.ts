import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

export interface User {
  username: string;
  companyName: string;
  accountNames: string[];
  platforms: string[];
  isAdmin: boolean;
}

// Temporary hardcoded users — will be replaced with DB in future
const USERS: { username: string; passwordHash: string; user: User }[] = [
  {
    username: 'gdec_admin',
    passwordHash: bcrypt.hashSync('gdec2024!', 10),
    user: {
      username: 'gdec_admin',
      companyName: 'GDEC Admin',
      accountNames: [],
      platforms: [],
      isAdmin: true,
    },
  },
];

@Injectable()
export class AuthService {
  constructor(private jwt: JwtService) {}

  async login(username: string, password: string) {
    const record = USERS.find(u => u.username === username.toLowerCase());
    if (!record) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, record.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const payload = {
      username:     record.user.username,
      companyName:  record.user.companyName,
      accountNames: record.user.accountNames,
      platforms:    record.user.platforms,
      isAdmin:      record.user.isAdmin,
    };

    return {
      access_token: this.jwt.sign(payload),
      user: payload,
    };
  }
}
