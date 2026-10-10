import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { join } from 'path';
import { MailService } from './mail.service';
import { MailSettingsService } from './mail-settings.service';
import { MailSettingsController } from './mail-settings.controller';
import { MailSettingsEntity } from './entities/mail-settings.entity';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { JwtModule } from '@nestjs/jwt';

/**
 * Módulo de correo saliente reutilizable (Gmail SMTP + Nodemailer vía
 * @nestjs-modules/mailer) — el primer consumidor es el CRM (recordatorios,
 * alertas de SLA, encuesta de satisfacción), pero cualquier otro módulo puede
 * inyectar `MailService` después (ej. notificaciones de facturación, portal
 * de clientes) sin duplicar esta configuración.
 *
 * Sin SMTP_HOST/SMTP_USER/SMTP_PASS configurados en el .env, la conexión SMTP
 * fallará solo al intentar enviar (nodemailer no valida credenciales al
 * crear el transporte) — MailService.sendMail() captura ese error y lo
 * loguea en vez de propagarlo, para que ningún flujo del ERP dependa de que
 * el correo esté configurado.
 */
@Module({
  imports: [
    TenantTypeOrmModule.forFeature([MailSettingsEntity]),
    JwtModule,
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get<string>('SMTP_HOST') || 'smtp.gmail.com',
          port: parseInt(config.get<string>('SMTP_PORT') || '587', 10),
          secure: false,
          auth: {
            user: config.get<string>('SMTP_USER'),
            pass: config.get<string>('SMTP_PASS'),
          },
        },
        defaults: {
          from: config.get<string>('SMTP_FROM') || '"Sumtech Telecomunicaciones" <no-reply@sumtech.do>',
        },
        template: {
          dir: join(__dirname, 'templates'),
          adapter: new HandlebarsAdapter(),
          options: { strict: false },
        },
      }),
    }),
  ],
  controllers: [MailSettingsController],
  providers: [MailService, MailSettingsService],
  exports: [MailService, MailSettingsService],
})
export class MailModule {}
