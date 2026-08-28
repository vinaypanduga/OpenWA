import { Body, Controller, Headers, Post, HttpCode, HttpStatus, Res, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentApiKey, Public } from './decorators/auth.decorators';
import { ApiKey } from './entities/api-key.entity';
import { DashboardLoginDto, DashboardLoginResponseDto, ValidateApiKeyResponseDto } from './dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthValidateController {
  private static readonly DASHBOARD_COOKIE = 'openwa_dashboard_session';
  private static readonly DASHBOARD_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('dashboard/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in to the dashboard with operator-configured credentials' })
  @ApiResponse({ status: 200, description: 'Dashboard login succeeded', type: DashboardLoginResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  @ApiResponse({ status: 503, description: 'Dashboard login is not configured or its key cannot be persisted' })
  async dashboardLogin(
    @Body() dto: DashboardLoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DashboardLoginResponseDto> {
    const result = await this.authService.authenticateDashboard(dto.email, dto.password);
    response.cookie(
      AuthValidateController.DASHBOARD_COOKIE,
      this.authService.createDashboardSessionToken(result.apiKey),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: AuthValidateController.DASHBOARD_COOKIE_MAX_AGE_MS,
      },
    );
    return result;
  }

  @Public()
  @Post('dashboard/session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a persistent dashboard browser login' })
  @ApiResponse({ status: 200, description: 'Dashboard session restored', type: DashboardLoginResponseDto })
  @ApiResponse({ status: 401, description: 'Dashboard session cookie is missing, invalid, or expired' })
  restoreDashboardLogin(@Headers('cookie') cookieHeader?: string): Promise<DashboardLoginResponseDto> {
    const token = this.readCookie(cookieHeader, AuthValidateController.DASHBOARD_COOKIE);
    if (!token) return Promise.reject(new UnauthorizedException('Dashboard login session is missing'));
    return this.authService.restoreDashboardSession(token);
  }

  @Public()
  @Post('dashboard/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear the persistent dashboard browser login' })
  @ApiResponse({ status: 204, description: 'Dashboard session cleared' })
  dashboardLogout(@Res({ passthrough: true }) response: Response): void {
    response.clearCookie(AuthValidateController.DASHBOARD_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });
  }

  private readCookie(header: string | undefined, name: string): string | null {
    for (const entry of header?.split(';') ?? []) {
      const separator = entry.indexOf('=');
      if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
      try {
        return decodeURIComponent(entry.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
    return null;
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate an API key' })
  @ApiHeader({ name: 'X-API-Key', description: 'API key to validate' })
  @ApiResponse({ status: 200, description: 'API key is valid', type: ValidateApiKeyResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  validate(@CurrentApiKey() apiKey?: ApiKey): { valid: boolean; role?: string } {
    // This route is behind the global API-key guard, so only a validated key reaches this handler
    // (a missing/invalid key 401s first). The guard has already verified the key — including its
    // client-IP and session-scope restrictions — and attached it to the request. Re-validating here
    // would repeat that work without the client IP, double-counting usage and, for an IP-restricted
    // key, failing closed (no IP) and wrongly reporting valid:false. So we trust the guard's result.
    // The valid:false branch is unreachable in normal operation; it's retained as defense-in-depth in
    // case the guard config ever changes, keeping the endpoint safe to expose directly.
    if (!apiKey) {
      return { valid: false };
    }
    return { valid: true, role: apiKey.role };
  }
}
