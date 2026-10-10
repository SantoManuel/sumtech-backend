import { Controller, Get, Put, Post, Body, UseGuards } from '@nestjs/common';
import { MailSettingsService } from './mail-settings.service';
import { MailService } from './mail.service';
import { UpdateMailSettingsDto } from './dto/update-mail-settings.dto';
import { TestMailSettingsDto } from './dto/test-mail-settings.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { TenantContextService } from '../../common/tenancy/tenant-context.service';

@Controller('mail-settings')
@UseGuards(AuthGuard, RolesGuard)
export class MailSettingsController {
  constructor(
    private readonly mailSettingsService: MailSettingsService,
    private readonly mailService: MailService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * `smtpPass` nunca sale al navegador en claro — el frontend solo necesita
   * saber SI hay una contraseña guardada para decidir qué placeholder
   * mostrar, no su valor (mismo criterio ya usado en CompanyController.getConfig
   * para dgiiCertPassword).
   */
  @Get()
  @Roles(Role.ADMIN, Role.GERENTE)
  async getSettings() {
    const settings = await this.mailSettingsService.getSettings();
    const { smtpPass, ...safeSettings } = settings as any;
    return { ...safeSettings, hasSmtpPass: !!smtpPass };
  }

  @Put()
  @Roles(Role.ADMIN)
  async updateSettings(@Body() dto: UpdateMailSettingsDto) {
    const settings = await this.mailSettingsService.update(dto);
    const { smtpPass, ...safeSettings } = settings as any;
    return { ...safeSettings, hasSmtpPass: !!smtpPass };
  }

  /**
   * Envía un correo de prueba usando la configuración YA GUARDADA (no la del
   * formulario sin guardar) — evita probar algo que nunca llegó a persistir,
   * y confirma de verdad si el SMTP propio del tenant funciona (a diferencia
   * del .env global, donde un error de configuración se loguea en silencio y
   * nunca rompe el flujo de negocio — acá sí queremos que el usuario se
   * entere si falló).
   */
  @Post('test')
  @Roles(Role.ADMIN)
  async sendTest(@Body() dto: TestMailSettingsDto) {
    const tenantName = this.tenantContext.hasContext() ? this.tenantContext.getSlug() : 'Sumtech';
    const sent = await this.mailService.sendTemplatedMail({
      to: dto.to,
      subject: `Correo de prueba SMTP — ${tenantName}`,
      template: 'smtp-test',
      context: {
        tenantName,
        sentAt: new Date().toLocaleString('es-DO'),
      },
    });
    return {
      success: sent,
      message: sent
        ? `Correo de prueba enviado a ${dto.to}.`
        : 'No se pudo enviar el correo de prueba — revisa el host, puerto, usuario y contraseña configurados.',
    };
  }
}
