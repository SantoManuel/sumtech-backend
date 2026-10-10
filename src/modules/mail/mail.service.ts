import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { TenantContextService } from '../../common/tenancy/tenant-context.service';
import { MailSettingsService } from './mail-settings.service';

export interface SendTemplatedMailInput {
  to: string;
  subject: string;
  template: string;
  context: Record<string, unknown>;
}

/**
 * Envoltorio delgado sobre MailerService — nunca lanza. Si el envío falla
 * (SMTP sin configurar, credenciales inválidas, red caída), lo loguea y
 * devuelve `false` en vez de propagar el error, para que ningún flujo de
 * negocio (recordatorios de CRM, alertas de SLA, encuestas) dependa de que
 * el correo esté disponible en este momento.
 *
 * Resolución de transporte (SaaS multi-tenant): si hay contexto de tenant
 * activo y ese tenant configuró su propio SMTP (sec.mail_settings,
 * enabled=true), se registra un transporter nombrado con el slug del tenant
 * vía MailerService.addTransporter() — API nativa de @nestjs-modules/mailer,
 * ver executeSend() en su código fuente — y se envía con ese
 * `transporterName`. Se re-registra en cada envío (no se cachea): el costo es
 * mínimo (arma el objeto transporter, no abre conexión hasta el envío real) y
 * evita servir una configuración vieja en caché cuando el tenant la cambia.
 * Si no hay tenant activo (ej. tenant-provisioning.service.ts al crear un
 * tenant nuevo) o el tenant no configuró SMTP propio, se usa el transporte
 * global de MailModule (variables de entorno) sin pasar `transporterName`.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly mailerService: MailerService,
    private readonly tenantContext: TenantContextService,
    private readonly mailSettingsService: MailSettingsService,
  ) {}

  /**
   * Resuelve el transporter + remitente a usar para este envío: el propio del
   * tenant si lo configuró y lo habilitó, o `{}` (usa el transporte/remitente
   * global de MailModule) en cualquier otro caso — sin contexto de tenant, sin
   * fila de configuración, deshabilitado, o si falta el host.
   */
  private async resolveTenantTransport(): Promise<{ transporterName?: string; from?: string }> {
    if (!this.tenantContext.hasContext()) {
      return {};
    }

    let settings;
    try {
      settings = await this.mailSettingsService.getSettingsForSending();
    } catch (err) {
      this.logger.warn(`No se pudo resolver la configuración SMTP del tenant, usando el SMTP global: ${(err as Error).message}`);
      return {};
    }

    if (!settings.enabled || !settings.smtpHost) {
      return {};
    }

    const slug = this.tenantContext.getSlug();
    this.mailerService.addTransporter(slug, {
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.smtpSecure,
      auth: {
        user: settings.smtpUser,
        pass: settings.smtpPass,
      },
    } as any);

    return { transporterName: slug, from: settings.fromAddress };
  }

  async sendTemplatedMail(input: SendTemplatedMailInput): Promise<boolean> {
    try {
      const { transporterName, from } = await this.resolveTenantTransport();

      await this.mailerService.sendMail({
        to: input.to,
        subject: input.subject,
        template: input.template,
        context: input.context,
        ...(transporterName ? { transporterName } : {}),
        ...(from ? { from } : {}),
      });
      return true;
    } catch (err) {
      this.logger.warn(`No se pudo enviar el correo "${input.subject}" a ${input.to}: ${(err as Error).message}`);
      return false;
    }
  }
}
