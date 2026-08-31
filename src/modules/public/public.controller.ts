import { Controller, Get, Post, Body } from '@nestjs/common';
import { PublicService } from './public.service';
import { RequestLeadDto } from './dto/request-lead.dto';
import { Public } from '../../common/decorators/public.decorator';

@Controller('public')
@Public()
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('plans')
  async getPlans() {
    return this.publicService.getPublicPlans();
  }

  @Get('plans/featured')
  async getFeatured() {
    return this.publicService.getFeaturedPlans();
  }

  @Post('leads')
  async createLead(@Body() dto: RequestLeadDto) {
    return this.publicService.createLead(dto);
  }
}
