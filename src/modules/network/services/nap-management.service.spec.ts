import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { NapManagementService } from './nap-management.service';
import { NapBoxEntity } from '../entities/nap-box.entity';
import { NapPortEntity } from '../entities/nap-port.entity';
import { OnuEntity } from '../../olt/entities/onu.entity';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';

describe('NapManagementService', () => {
  let service: NapManagementService;
  let napRepo: any;
  let portRepo: any;
  let onuRepo: any;
  let deviceOperationLogger: any;

  const mockNapBox = {
    id: 'nap-1',
    name: 'NAP-TOROS-01',
    oltId: 'olt-1',
    ponInterface: 'gpon-olt_1/1/1',
    splitterRatio: '1:16',
    totalPorts: 16,
    latitude: 18.4861,
    longitude: -69.9312,
    status: 'ACTIVO',
    ports: [
      { id: 'port-1', portNumber: 1, status: 'OCUPADO', onuId: 'onu-1' },
      { id: 'port-2', portNumber: 2, status: 'DISPONIBLE', onuId: null },
      { id: 'port-3', portNumber: 3, status: 'DANADO', onuId: null },
      { id: 'port-4', portNumber: 4, status: 'DISPONIBLE', onuId: null },
    ],
  };

  beforeEach(async () => {
    napRepo = {
      findOne: jest.fn().mockResolvedValue(mockNapBox),
      findOneBy: jest.fn().mockResolvedValue(mockNapBox),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => Promise.resolve({ id: 'nap-1', ...entity })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[mockNapBox], 1]),
        getMany: jest.fn().mockResolvedValue([mockNapBox]),
      }),
    };

    portRepo = {
      findOne: jest.fn().mockResolvedValue(mockNapBox.ports[1]), // port-2
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    onuRepo = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'onu-2', serialNumber: 'ZTEGC1234567' }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    deviceOperationLogger = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NapManagementService,
        { provide: getRepositoryToken(NapBoxEntity), useValue: napRepo },
        { provide: getRepositoryToken(NapPortEntity), useValue: portRepo },
        { provide: getRepositoryToken(OnuEntity), useValue: onuRepo },
        { provide: DeviceOperationLogger, useValue: deviceOperationLogger },
      ],
    }).compile();

    service = module.get(NapManagementService);
  });

  describe('create', () => {
    it('crea la caja NAP y genera automáticamente los N puertos en estado DISPONIBLE', async () => {
      const result = await service.create(
        {
          name: 'NAP-NUEVA-01',
          totalPorts: 8,
          splitterRatio: '1:8',
        },
        'user-1',
      );

      expect(napRepo.create).toHaveBeenCalled();
      expect(napRepo.save).toHaveBeenCalled();
      expect(portRepo.create).toHaveBeenCalledTimes(8);
      expect(portRepo.save).toHaveBeenCalled();
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'PROVISION',
          status: 'SUCCESS',
        }),
      );
    });
  });

  describe('findAll', () => {
    it('calcula métricas de puertos ocupados, libres y porcentaje de ocupación', async () => {
      const result = await service.findAll();

      expect(result.data).toHaveLength(1);
      const box = result.data[0];
      expect(box.portsOccupied).toBe(1);
      expect(box.portsAvailable).toBe(2);
      expect(box.portsDamaged).toBe(1);
      expect(box.occupancyPercent).toBe(6); // 1 / 16 = 6.25% -> 6%
    });
  });

  describe('findById', () => {
    it('devuelve la caja con sus puertos ordenados', async () => {
      const box = await service.findById('nap-1');
      expect(box.id).toBe('nap-1');
      expect(box.ports).toBeDefined();
    });

    it('lanza NotFoundException si la caja no existe', async () => {
      napRepo.findOne.mockResolvedValue(null);
      await expect(service.findById('nap-inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updatePort', () => {
    it('asocia una ONU al puerto, lo marca como OCUPADO y sincroniza onu.napPortId', async () => {
      const port = await service.updatePort('nap-1', 2, { onuId: 'onu-2' });

      expect(port.onuId).toBe('onu-2');
      expect(port.status).toBe('OCUPADO');
      expect(onuRepo.update).toHaveBeenCalledWith('onu-2', { napPortId: 'port-2' });
      expect(portRepo.save).toHaveBeenCalled();
    });

    it('desasocia la ONU si se envía onuId como null y limpia onu.napPortId', async () => {
      portRepo.findOne.mockResolvedValue({ id: 'port-1', portNumber: 1, onuId: 'onu-1', status: 'OCUPADO' });

      const port = await service.updatePort('nap-1', 1, { onuId: null });

      expect(port.onuId).toBeNull();
      expect(port.status).toBe('DISPONIBLE');
      expect(onuRepo.update).toHaveBeenCalledWith('onu-1', { napPortId: null });
    });
  });

  describe('delete', () => {
    it('rechaza con BadRequestException si hay puertos con ONUs asignadas', async () => {
      napRepo.findOne.mockResolvedValue(mockNapBox); // tiene port-1 con onu-1
      await expect(service.delete('nap-1')).rejects.toThrow(BadRequestException);
    });

    it('elimina la caja si todos los puertos están libres', async () => {
      napRepo.findOne.mockResolvedValue({
        id: 'nap-libre',
        name: 'NAP Libre',
        ports: [{ portNumber: 1, status: 'DISPONIBLE', onuId: null }],
      });

      const res = await service.delete('nap-libre');
      expect(res.ok).toBe(true);
      expect(napRepo.delete).toHaveBeenCalledWith('nap-libre');
    });
  });

  describe('getGisPoints', () => {
    it('retorna puntos para visualización geográfica GIS', async () => {
      const points = await service.getGisPoints();
      expect(points).toHaveLength(1);
      expect(points[0].latitude).toBe(18.4861);
      expect(points[0].longitude).toBe(-69.9312);
    });
  });
});
