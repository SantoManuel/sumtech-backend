import { Injectable, NotFoundException, GoneException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SatisfactionSurveyEntity } from '../crm/entities/satisfaction-survey.entity';

export interface SubmitSurveyInput {
  rating: number;
  comment?: string;
}

/**
 * Backend de la página pública /encuesta/[token] — mismo patrón de token de
 * un solo uso que PublicGpsService (/ubicacion/[token]). Nunca expone datos
 * del cliente ni de la oportunidad en el enlace público.
 */
@Injectable()
export class PublicSurveyService {
  constructor(
    @InjectRepository(SatisfactionSurveyEntity)
    private readonly surveyRepository: Repository<SatisfactionSurveyEntity>,
  ) {}

  private async findValidOrThrow(token: string): Promise<SatisfactionSurveyEntity> {
    const survey = await this.surveyRepository.findOne({ where: { token } });
    if (!survey) {
      throw new NotFoundException('Enlace de encuesta no válido');
    }
    if (survey.status === 'PENDING' && survey.expiresAt.getTime() < Date.now()) {
      survey.status = 'EXPIRED';
      await this.surveyRepository.save(survey);
    }
    return survey;
  }

  async checkToken(token: string): Promise<{ valid: boolean; alreadySubmitted: boolean }> {
    const survey = await this.findValidOrThrow(token);
    if (survey.status === 'EXPIRED') {
      return { valid: false, alreadySubmitted: false };
    }
    return { valid: true, alreadySubmitted: survey.status === 'SUBMITTED' };
  }

  async submitSurvey(token: string, input: SubmitSurveyInput): Promise<{ success: true }> {
    if (input.rating < 1 || input.rating > 5) {
      throw new BadRequestException('La calificación debe estar entre 1 y 5');
    }

    const survey = await this.findValidOrThrow(token);
    if (survey.status === 'EXPIRED') {
      throw new GoneException('Este enlace de encuesta ya venció');
    }
    if (survey.status === 'SUBMITTED') {
      throw new GoneException('Esta encuesta ya fue respondida');
    }

    survey.status = 'SUBMITTED';
    survey.submittedAt = new Date();
    survey.rating = input.rating;
    survey.comment = input.comment;
    await this.surveyRepository.save(survey);

    return { success: true };
  }
}
