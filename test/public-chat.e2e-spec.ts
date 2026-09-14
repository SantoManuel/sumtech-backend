import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as request from 'supertest';
import { PublicController } from '../src/modules/public/public.controller';
import { PublicService } from '../src/modules/public/public.service';
import { PublicChatService } from '../src/modules/public/public-chat.service';
import { AiChatbotClientService } from '../src/modules/ai-chatbot/ai-chatbot-client.service';
import { LeadEntity } from '../src/modules/crm/entities/lead.entity';
import { PlansService } from '../src/modules/plans/plans.service';
import { CrmService } from '../src/modules/crm/crm.service';

/**
 * E2E del chat público del landing (/public/chat/*). Se bootstrapea una app
 * Nest real (guards, ValidationPipe, throttling) pero sin conexión a
 * Postgres — el repositorio de LeadEntity y AiChatbotClientService se
 * sustituyen por dobles de prueba, ya que la lógica de negocio en sí ya está
 * cubierta por public-chat.service.spec.ts. Lo que este suite valida es la
 * capa HTTP: validación de DTOs, códigos de estado, y rate limiting real.
 */
describe('PublicController — /public/chat (e2e)', () => {
  let app: INestApplication;
  let leadRepo: any;
  let aiChatbotClient: any;

  beforeEach(async () => {
    leadRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findOneBy: jest.fn(),
      create: jest.fn((dto: any) => ({ ...dto })),
      save: jest.fn((entity: any) => Promise.resolve({ id: entity.id ?? 'lead-e2e-1', ...entity })),
    };
    aiChatbotClient = {
      sendMessage: jest.fn().mockResolvedValue({
        conversationId: 'conv-e2e',
        response: 'Respuesta de prueba del asistente.',
        intent: 'saludo',
        status: 'ACTIVE',
        escalated: false,
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])],
      controllers: [PublicController],
      providers: [
        PublicService,
        PublicChatService,
        { provide: PlansService, useValue: { findAll: jest.fn(), findFeatured: jest.fn() } },
        { provide: CrmService, useValue: { createLead: jest.fn() } },
        { provide: getRepositoryToken(LeadEntity), useValue: leadRepo },
        { provide: AiChatbotClientService, useValue: aiChatbotClient },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /public/chat/start', () => {
    it('rechaza con 400 si falta el nombre', async () => {
      await request(app.getHttpServer())
        .post('/public/chat/start')
        .send({ phone: '8095210288' })
        .expect(400);
    });

    it('rechaza con 400 si el teléfono tiene formato inválido', async () => {
      await request(app.getHttpServer())
        .post('/public/chat/start')
        .send({ name: 'Carlos', phone: 'abc' })
        .expect(400);
    });

    it('acepta una solicitud válida y devuelve un sessionId', async () => {
      const res = await request(app.getHttpServer())
        .post('/public/chat/start')
        .send({ name: 'Carlos Mendoza', phone: '809-521-0288' })
        .expect(201);

      expect(res.body.sessionId).toBeDefined();
      expect(res.body.isReturning).toBe(false);
    });

    it('devuelve 429 al superar el límite de 3 solicitudes/hora desde el mismo origen (en producción)', async () => {
      // SpanishThrottlerGuard omite el límite fuera de producción (ver su
      // propio comentario) — se simula NODE_ENV=production para validar que
      // el límite sí se aplica donde realmente importa.
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        for (let i = 0; i < 3; i++) {
          await request(app.getHttpServer())
            .post('/public/chat/start')
            .send({ name: 'Carlos', phone: '8095210288' })
            .expect(201);
        }

        await request(app.getHttpServer())
          .post('/public/chat/start')
          .send({ name: 'Carlos', phone: '8095210288' })
          .expect(429);
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('fuera de producción, NO aplica el límite de solicitudes (prioriza no bloquear el uso normal en desarrollo)', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/public/chat/start')
          .send({ name: 'Carlos', phone: '8095210288' })
          .expect(201);
      }
    });

    it('con el honeypot lleno, responde 201 con un sessionId pero nunca llama a leadRepository.save', async () => {
      const res = await request(app.getHttpServer())
        .post('/public/chat/start')
        .send({ name: 'Bot', phone: '8095210288', website: 'http://spam.example' })
        .expect(201);

      expect(res.body.sessionId).toBeDefined();
      expect(leadRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('POST /public/chat/message', () => {
    it('rechaza con 400 si sessionId no es un UUID válido', async () => {
      await request(app.getHttpServer())
        .post('/public/chat/message')
        .send({ sessionId: 'no-es-uuid', message: 'hola' })
        .expect(400);
    });

    it('rechaza con 400 si el mensaje está vacío', async () => {
      await request(app.getHttpServer())
        .post('/public/chat/message')
        .send({ sessionId: '11111111-1111-4111-8111-111111111111', message: '' })
        .expect(400);
    });

    it('rechaza con 400 si el mensaje excede 1000 caracteres', async () => {
      await request(app.getHttpServer())
        .post('/public/chat/message')
        .send({ sessionId: '11111111-1111-4111-8111-111111111111', message: 'a'.repeat(1001) })
        .expect(400);
    });

    it('devuelve 404 si el sessionId es un UUID válido pero no existe ningún lead con ese id', async () => {
      leadRepo.findOneBy.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/public/chat/message')
        .send({ sessionId: '11111111-1111-4111-8111-111111111111', message: 'hola' })
        .expect(404);
    });

    it('flujo feliz: responde 201 con el mensaje de la IA cuando el lead existe', async () => {
      leadRepo.findOneBy.mockResolvedValue({ id: 'lead-e2e-1', name: 'Carlos', notes: '', status: 'NEW' });

      const res = await request(app.getHttpServer())
        .post('/public/chat/message')
        .send({ sessionId: '11111111-1111-4111-8111-111111111111', message: 'hola' })
        .expect(201);

      expect(res.body.message).toBe('Respuesta de prueba del asistente.');
    });

    it('devuelve 429 al superar el límite de 10 mensajes/5min desde el mismo origen (en producción)', async () => {
      leadRepo.findOneBy.mockResolvedValue({ id: 'lead-e2e-1', name: 'Carlos', notes: '', status: 'NEW' });

      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        for (let i = 0; i < 10; i++) {
          await request(app.getHttpServer())
            .post('/public/chat/message')
            .send({ sessionId: '11111111-1111-4111-8111-111111111111', message: `mensaje ${i}` })
            .expect(201);
        }

        await request(app.getHttpServer())
          .post('/public/chat/message')
          .send({ sessionId: '11111111-1111-4111-8111-111111111111', message: 'uno más' })
          .expect(429);
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });
  });
});
