import {
  Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Request,
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
}
