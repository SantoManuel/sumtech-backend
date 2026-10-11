import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OltEntity } from '../entities/olt.entity';
import { ExportOltsDto, OLT_EXPORT_MAX_ROWS } from '../dto/export-olts.dto';
import { buildCsvBuffer, CsvColumn } from '../../../common/utils/csv-builder.util';

interface OltExportRow {
  nombre: string;
  fabricante: string;
  modelo: string;
  host: string;
  puerto: string;
  metodoConexion: string;
  viaRouter: string;
  estadoConexion: string;
  firmware: string;
  ultimaVerificacion: string;
  ultimaConexionExitosa: string;
  activo: string;
}

const COLUMNS: CsvColumn<OltExportRow>[] = [
  { key: 'nombre', header: 'Nombre' },
  { key: 'fabricante', header: 'Fabricante' },
  { key: 'modelo', header: 'Modelo' },
  { key: 'host', header: 'Host' },
  { key: 'puerto', header: 'Puerto' },
  { key: 'metodoConexion', header: 'Método de Conexión' },
  { key: 'viaRouter', header: 'Vía Router MikroTik' },
  { key: 'estadoConexion', header: 'Estado de Conexión' },
  { key: 'firmware', header: 'Firmware' },
  { key: 'ultimaVerificacion', header: 'Última Verificación' },
  { key: 'ultimaConexionExitosa', header: 'Última Conexión Exitosa' },
  { key: 'activo', header: 'Activo' },
];

function formatDateTime(value?: Date | null): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-DO');
}

@Injectable()
export class OltExportService {
  constructor(
    @InjectRepository(OltEntity)
    private readonly oltRepository: Repository<OltEntity>,
  ) {}

  async export(dto: ExportOltsDto): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const query = this.oltRepository
      .createQueryBuilder('olt')
      .leftJoinAndSelect('olt.viaNode', 'viaNode')
      .take(dto.limit || OLT_EXPORT_MAX_ROWS);

    if (dto.vendor) {
      query.andWhere('olt.vendor ILIKE :vendor', { vendor: dto.vendor });
    }

    if (dto.connectionStatus) {
      query.andWhere('olt.connectionStatus = :connectionStatus', { connectionStatus: dto.connectionStatus });
    }

    if (dto.search) {
      query.andWhere('(olt.name ILIKE :search OR olt.host ILIKE :search OR olt.model ILIKE :search)', {
        search: `%${dto.search}%`,
      });
    }

    const olts = await query.orderBy('olt.name', 'ASC').getMany();

    const rows: OltExportRow[] = olts.map((olt) => ({
      nombre: olt.name,
      fabricante: olt.vendor,
      modelo: olt.model,
      host: olt.host,
      puerto: String(olt.port),
      metodoConexion: olt.connectionMethod,
      viaRouter: olt.connectionMethod === 'VIA_MIKROTIK' ? olt.viaNode?.name || '' : '',
      estadoConexion: olt.connectionStatus || '',
      firmware: olt.firmwareVersion || '',
      ultimaVerificacion: formatDateTime(olt.lastCheckedAt),
      ultimaConexionExitosa: formatDateTime(olt.lastSuccessfulConnectionAt),
      activo: olt.isActive ? 'Sí' : 'No',
    }));

    const buffer = buildCsvBuffer(rows, COLUMNS);
    const filename = `cabeceras-olt_${this.timestampForFilename()}.csv`;

    return { buffer, filename, contentType: 'text/csv; charset=utf-8' };
  }

  private timestampForFilename(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  }
}
