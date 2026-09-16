import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

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
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly mailerService: MailerService) {}

  async sendTemplatedMail(input: SendTemplatedMailInput): Promise<boolean> {
    try {
      await this.mailerService.sendMail({
        to: input.to,
        subject: input.subject,
        template: input.template,
        context: input.context,
      });
      return true;
    } catch (err) {
      this.logger.warn(`No se pudo enviar el correo "${input.subject}" a ${input.to}: ${(err as Error).message}`);
      return false;
    }
  }
}
