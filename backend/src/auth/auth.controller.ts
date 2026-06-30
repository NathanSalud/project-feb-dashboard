import {
  Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Request,
  ForbiddenException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtGuard } from './jwt/jwt.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: { username: string; password: string }) {
    return this.authService.login(body.username, body.password);
  }

  @Post('change-password')
  @UseGuards(JwtGuard)
  @HttpCode(HttpStatus.OK)
  changePassword(
    @Request() req,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.authService.changePassword(
      req.user.username,
      body.currentPassword,
      body.newPassword,
    );
  }

  @Post('admin/reset-password')
  @UseGuards(JwtGuard)
  @HttpCode(HttpStatus.OK)
  adminResetPassword(@Request() req, @Body() body: { username: string }) {
    // Real access gate: block non-admins entirely before any work.
    if (!req.user.isAdmin) throw new ForbiddenException();
    return this.authService.adminResetPassword(req.user.username, body.username);
  }
}
