import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const userIdentifier = dto.identifier || dto.username;
    if (!userIdentifier) {
      throw new BadRequestException('El usuario o correo es requerido');
    }

    const user = await this.usersService.findByUsernameOrEmail(userIdentifier);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      roles: user.roles ? user.roles.map((r) => r.name) : [],
      employeeId: user.employee?.id,
      clientId: user.client?.id,
    };

    const secret = this.configService.get<string>('JWT_SECRET') || 'default_jwt_secret_sumtech_2026';
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET') || 'default_refresh_secret_sumtech_2026';

    const accessToken = this.jwtService.sign(payload, {
      secret,
      expiresIn: this.configService.get<string>('JWT_EXPIRATION_TIME') || '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: refreshSecret,
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION_TIME') || '7d',
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        roles: payload.roles,
        employee: user.employee ? {
          id: user.employee.id,
          cedula: user.employee.cedula,
          jobTitle: user.employee.jobTitle,
          photoUrl: user.employee.photoUrl,
        } : undefined,
        client: user.client ? {
          id: user.client.id,
          name: user.client.name,
          docNumber: user.client.docNumber,
          email: user.client.email,
          phone: user.client.phone,
        } : undefined,
      },
    };
  }

  async refreshToken(refreshToken: string) {
    try {
      const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET') || 'default_refresh_secret_sumtech_2026';
      const decoded: JwtPayload = this.jwtService.verify(refreshToken, { secret: refreshSecret });

      const user = await this.usersService.findById(decoded.sub);
      if (!user || !user.isActive) {
        throw new UnauthorizedException('Sesión no válida o expirada');
      }

      const payload: JwtPayload = {
        sub: user.id,
        username: user.username,
        email: user.email,
        roles: user.roles ? user.roles.map((r) => r.name) : [],
        employeeId: user.employee?.id,
      };

      const secret = this.configService.get<string>('JWT_SECRET') || 'default_jwt_secret_sumtech_2026';
      const newAccessToken = this.jwtService.sign(payload, {
        secret,
        expiresIn: this.configService.get<string>('JWT_EXPIRATION_TIME') || '15m',
      });

      return { accessToken: newAccessToken };
    } catch {
      throw new UnauthorizedException('Token de refresco inválido o expirado');
    }
  }
}
