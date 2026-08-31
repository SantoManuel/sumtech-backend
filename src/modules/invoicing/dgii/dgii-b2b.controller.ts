import { 
  Controller, 
  Post, 
  Get, 
  UseInterceptors, 
  UploadedFile, 
  Header, 
  Res, 
  HttpStatus, 
  Body, 
  Query, 
  UseGuards, 
  Logger 
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { DgiiB2bService } from './dgii-b2b.service';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';

// Controlador público de Recepción de e-CF (B2B oficial DGII)
@Controller('fe/recepcion/api')
export class DgiiRecepcionB2bController {
  private readonly logger = new Logger(DgiiRecepcionB2bController.name);

  constructor(private readonly b2bService: DgiiB2bService) {}

  @Post('ecf')
  @Header('Content-Type', 'text/xml; charset=utf-8')
  @UseInterceptors(FileInterceptor('xml'))
  async recibirEcf(
    @UploadedFile() file: Express.Multer.File,
    @Body('xml') xmlBodyParam: string,
    @Res() res: Response,
  ) {
    let xmlContent = '';

    if (file && file.buffer) {
      xmlContent = file.buffer.toString('utf8');
    } else if (xmlBodyParam) {
      xmlContent = xmlBodyParam;
    }

    if (!xmlContent || xmlContent.trim().length === 0) {
      return res.status(HttpStatus.BAD_REQUEST).send(
        `<?xml version="1.0" encoding="utf-8"?><Error>El parámetro multipart/form-data 'xml' es requerido y no fue recibido.</Error>`,
      );
    }

    const xmlArecfSigned = await this.b2bService.procesarEcfRecibido(xmlContent);
    return res.status(HttpStatus.OK).send(xmlArecfSigned);
  }
}

// Controlador público de Autenticación B2B (DGII)
@Controller('fe/autenticacion/api')
export class DgiiAutenticacionB2bController {
  constructor(private readonly b2bService: DgiiB2bService) {}

  @Get('semilla')
  obtenerSemilla(@Res() res: Response) {
    const isJson = res.req.headers.accept?.includes('application/json');
    if (isJson) {
      const { json } = this.b2bService.generarSemilla('json');
      return res.status(HttpStatus.OK).json(json);
    }

    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    const { xml } = this.b2bService.generarSemilla('xml');
    return res.status(HttpStatus.OK).send(xml);
  }

  @Post(['validacioncertificado', 'ValidacionCertificado'])
  @UseInterceptors(FileInterceptor('xml'))
  validarCertificado(
    @UploadedFile() file: Express.Multer.File,
    @Body('xml') xmlBodyParam: string,
    @Res() res: Response,
  ) {
    let xmlContent = '';
    if (file && file.buffer) {
      xmlContent = file.buffer.toString('utf8');
    } else if (xmlBodyParam) {
      xmlContent = xmlBodyParam;
    }

    const tokenData = this.b2bService.validarCertificado(xmlContent);

    const acceptHeader = res.req.headers.accept || '';
    if (acceptHeader.includes('application/xml') || acceptHeader.includes('text/xml')) {
      res.setHeader('Content-Type', 'text/xml; charset=utf-8');
      const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<RespuestaAutenticacion>
  <token>${tokenData.token}</token>
  <expira>${tokenData.expira}</expira>
  <expedido>${tokenData.expedido}</expedido>
</RespuestaAutenticacion>`;
      return res.status(HttpStatus.OK).send(xmlResponse);
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(HttpStatus.OK).json(tokenData);
  }
}

// Controlador público de Recepción de Aprobación Comercial (ACECF)
@Controller('fe/aprobacioncomercial/api')
export class DgiiAprobacionComercialB2bController {
  constructor(private readonly b2bService: DgiiB2bService) {}

  @Post('ecf')
  @Header('Content-Type', 'text/xml; charset=utf-8')
  @UseInterceptors(FileInterceptor('xml'))
  async recibirAprobacionComercial(
    @UploadedFile() file: Express.Multer.File,
    @Body('xml') xmlBodyParam: string,
    @Res() res: Response,
  ) {
    let xmlContent = '';
    if (file && file.buffer) {
      xmlContent = file.buffer.toString('utf8');
    } else if (xmlBodyParam) {
      xmlContent = xmlBodyParam;
    }

    if (!xmlContent || xmlContent.trim().length === 0) {
      return res.status(HttpStatus.BAD_REQUEST).send(
        `<?xml version="1.0" encoding="utf-8"?><Error>El parámetro multipart/form-data 'xml' es requerido y no fue recibido.</Error>`,
      );
    }

    const xmlResponse = await this.b2bService.procesarAcecfRecibido(xmlContent);
    return res.status(HttpStatus.OK).send(xmlResponse);
  }
}

// Controlador administrativo interno para consultar facturas B2B recibidas
@Controller('invoicing/dgii/b2b')
@UseGuards(AuthGuard, RolesGuard)
export class DgiiAdminB2bController {
  constructor(private readonly b2bService: DgiiB2bService) {}

  @Get('invoices')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getReceivedInvoices(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    return this.b2bService.getReceivedInvoices(parseInt(page, 10) || 1, parseInt(limit, 10) || 20);
  }
}
