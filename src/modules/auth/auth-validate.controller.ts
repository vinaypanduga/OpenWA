import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { CurrentApiKey, Public } from './decorators/auth.decorators';
import { ApiKey } from './entities/api-key.entity';
import { DashboardLoginDto, DashboardLoginResponseDto, ValidateApiKeyResponseDto } from './dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthValidateController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('dashboard/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in to the dashboard with operator-configured credentials' })
  @ApiResponse({ status: 200, description: 'Dashboard login succeeded', type: DashboardLoginResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  @ApiResponse({ status: 503, description: 'Dashboard login is not configured or its key cannot be persisted' })
  dashboardLogin(@Body() dto: DashboardLoginDto): Promise<DashboardLoginResponseDto> {
    return this.authService.authenticateDashboard(dto.email, dto.password);
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
