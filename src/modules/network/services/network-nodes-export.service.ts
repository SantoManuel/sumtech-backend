import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkNodeEntity } from '../entities/network-node.entity';
import { ExportNetworkNodesDto, NETWORK_NODES_EXPORT_MAX_ROWS } from '../dto/export-network-nodes.dto';
import { buildCsvBuffer, CsvColumn } from '../../../common/utils/csv-builder.util';

interface NetworkNodeExportRow {
  nombre: string;
  modelo: string;
  zona: string;
  metodoConexion: string;
  estado: string;
  endpoint: string;
  versionRouterOS: string;
  cpuPorcentaje: string;
  uptimeSegundos: string;
  ultimaVezVisto: string;
  activo: string;
}

const COLUMNS: CsvColumn<NetworkNodeExportRow>[] = [
  { key: 'nombre', header: 'Nombre' },
  { key: 'modelo', header: 'Modelo' },
  { key: 'zona', header: 'Zona' },
  { key: 'metodoConexion', header: 'Método de Conexión' },
  { key: 'estado', header: 'Estado' },
  { key: 'endpoint', header: 'IP / Endpoint' },
  { key: 'versionRouterOS', header: 'Versión RouterOS' },
  { key: 'cpuPorcentaje', header: 'CPU %' },
  { key: 'uptimeSegundos', header: 'Uptime (segundos)' },
  { key: 'ultimaVezVisto', header: 'Última vez visto' },
  { key: 'activo', header: 'Activo' },
];

function resolveEndpoint(node: NetworkNodeEntity): string {
  if (node.connectionMethod === 'wireguard') return node.wireguardIp || '';
  if (node.connectionMethod === 'ddns') return node.ddnsHostname || '';
  return node.managementIp || '';
}

function formatDateTime(value?: Date | null): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-DO');
}

@Injectable()
export class NetworkNodesExportService {
  constructor(
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
  ) {}

  async export(dto: ExportNetworkNodesDto): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const query = this.nodeRepository
      .createQueryBuilder('node')
      .leftJoinAndSelect('node.zone', 'zone')
      .where('node.deletedAt IS NULL')
      .take(dto.limit || NETWORK_NODES_EXPORT_MAX_ROWS);

    if (dto.status) {
      query.andWhere('node.status = :status', { status: dto.status });
    }

    if (dto.connectionMethod) {
      query.andWhere('node.connectionMethod = :method', { method: dto.connectionMethod });
    }

    if (dto.search) {
      query.andWhere('(node.name ILIKE :search OR node.managementIp ILIKE :search OR node.wireguardIp ILIKE :search)', {
        search: `%${dto.search}%`,
      });
    }

    const nodes = await query.orderBy('node.name', 'ASC').getMany();

    const rows: NetworkNodeExportRow[] = nodes.map((node) => ({
      nombre: node.name,
      modelo: node.model || '',
      zona: node.zone?.name || '',
      metodoConexion: node.connectionMethod || '',
      estado: node.status || '',
      endpoint: resolveEndpoint(node),
      versionRouterOS: node.routerosVersion || '',
      cpuPorcentaje: node.cpuUsage !== undefined && node.cpuUsage !== null ? String(node.cpuUsage) : '',
      uptimeSegundos: node.uptimeSeconds !== undefined && node.uptimeSeconds !== null ? String(node.uptimeSeconds) : '',
      ultimaVezVisto: formatDateTime(node.lastHeartbeatAt),
      activo: node.isActive ? 'Sí' : 'No',
    }));

    const buffer = buildCsvBuffer(rows, COLUMNS);
    const filename = `routers-mikrotik_${this.timestampForFilename()}.csv`;

    return { buffer, filename, contentType: 'text/csv; charset=utf-8' };
  }

  private timestampForFilename(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  }
}
