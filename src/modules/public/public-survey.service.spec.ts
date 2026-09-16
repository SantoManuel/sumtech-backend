import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, GoneException, NotFoundException } from '@nestjs/common';
import { PublicSurveyService } from './public-survey.service';
import { SatisfactionSurveyEntity } from '../crm/entities/satisfaction-survey.entity';

describe('PublicSurveyService', () => {
  let service: PublicSurveyService;
  let surveyRepo: any;

  const validSurvey = (overrides: Partial<SatisfactionSurveyEntity> = {}): any => ({
    id: 'survey-1',
    opportunityId: 'opp-1',
    token: 'abc123',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ...overrides,
  });

  beforeEach(async () => {
    surveyRepo = {
      findOne: jest.fn(),
      save: jest.fn((entity: any) => Promise.resolve(entity)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PublicSurveyService, { provide: getRepositoryToken(SatisfactionSurveyEntity), useValue: surveyRepo }],
    }).compile();

    service = module.get<PublicSurveyService>(PublicSurveyService);
  });

  describe('checkToken', () => {
    it('lanza NotFoundException si el token no existe', async () => {
      surveyRepo.findOne.mockResolvedValue(null);

      await expect(service.checkToken('token-inexistente')).rejects.toThrow(NotFoundException);
    });

    it('devuelve valid=true, alreadySubmitted=false para un token PENDING vigente', async () => {
      surveyRepo.findOne.mockResolvedValue(validSurvey());

      const result = await service.checkToken('abc123');

      expect(result).toEqual({ valid: true, alreadySubmitted: false });
    });

    it('devuelve valid=true, alreadySubmitted=true para un token ya respondido', async () => {
      surveyRepo.findOne.mockResolvedValue(validSurvey({ status: 'SUBMITTED' }));

      const result = await service.checkToken('abc123');

      expect(result).toEqual({ valid: true, alreadySubmitted: true });
    });

    it('marca como EXPIRED y devuelve valid=false si la fecha de expiración ya pasó', async () => {
      const expiredSurvey = validSurvey({ expiresAt: new Date(Date.now() - 1000) });
      surveyRepo.findOne.mockResolvedValue(expiredSurvey);

      const result = await service.checkToken('abc123');

      expect(result).toEqual({ valid: false, alreadySubmitted: false });
      expect(surveyRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'EXPIRED' }));
    });
  });

  describe('submitSurvey', () => {
    it('lanza BadRequestException si rating está fuera de 1-5', async () => {
      await expect(service.submitSurvey('abc123', { rating: 0 })).rejects.toThrow(BadRequestException);
      await expect(service.submitSurvey('abc123', { rating: 6 })).rejects.toThrow(BadRequestException);
    });

    it('guarda rating/comment y marca la encuesta como SUBMITTED', async () => {
      surveyRepo.findOne.mockResolvedValue(validSurvey());

      const result = await service.submitSurvey('abc123', { rating: 5, comment: 'Excelente servicio' });

      expect(result).toEqual({ success: true });
      expect(surveyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SUBMITTED', rating: 5, comment: 'Excelente servicio' }),
      );
    });

    it('rechaza con GoneException (410) si el token ya fue usado', async () => {
      surveyRepo.findOne.mockResolvedValue(validSurvey({ status: 'SUBMITTED' }));

      await expect(service.submitSurvey('abc123', { rating: 4 })).rejects.toThrow(GoneException);
    });

    it('rechaza con GoneException (410) si el token ya venció', async () => {
      surveyRepo.findOne.mockResolvedValue(validSurvey({ expiresAt: new Date(Date.now() - 1000) }));

      await expect(service.submitSurvey('abc123', { rating: 4 })).rejects.toThrow(GoneException);
    });

    it('lanza NotFoundException si el token no existe', async () => {
      surveyRepo.findOne.mockResolvedValue(null);

      await expect(service.submitSurvey('token-inexistente', { rating: 4 })).rejects.toThrow(NotFoundException);
    });
  });
});
