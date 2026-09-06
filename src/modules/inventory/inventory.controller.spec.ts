import { ForbiddenException } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { Role } from '../../common/enums/role.enum';

/**
 * Cubre solo la lógica de propiedad ("un técnico jamás ve el inventario de otro
 * técnico") agregada directamente en el controller — vive aquí porque depende de
 * comparar el :employeeId de la ruta contra el employeeId del JWT del llamante,
 * algo naturalmente propio de esta capa, no de los servicios.
 */
describe('InventoryController — control de acceso por propiedad', () => {
  let equipmentMovementService: any;
  let consumableStockService: any;
  let dispatchService: any;
  let controller: InventoryController;

  beforeEach(() => {
    equipmentMovementService = {
      getTechnicianEquipment: jest.fn().mockResolvedValue(['equipo']),
      getTechnicianTools: jest.fn().mockResolvedValue(['herramienta']),
      findEquipment: jest.fn().mockResolvedValue(['todo']),
    };
    consumableStockService = { getTechnicianStock: jest.fn().mockResolvedValue(['stock']) };
    dispatchService = { findAll: jest.fn().mockResolvedValue(['despacho']) };
    controller = new InventoryController(
      {} as any,
      equipmentMovementService,
      consumableStockService,
      dispatchService,
    );
  });

  describe('getTechnicianEquipment', () => {
    it('rechaza si un técnico consulta el inventario de otro empleado', async () => {
      await expect(
        controller.getTechnicianEquipment('tech-B', 'tech-A', [Role.TECNICO]),
      ).rejects.toThrow(ForbiddenException);
      expect(equipmentMovementService.getTechnicianEquipment).not.toHaveBeenCalled();
    });

    it('permite a un técnico consultar su propio inventario', async () => {
      const result = await controller.getTechnicianEquipment('tech-A', 'tech-A', [Role.TECNICO]);
      expect(result).toEqual(['equipo']);
    });

    it('permite a un admin consultar el inventario de cualquier técnico', async () => {
      const result = await controller.getTechnicianEquipment('tech-B', 'admin-1', [Role.ADMIN]);
      expect(result).toEqual(['equipo']);
    });
  });

  describe('findEquipment', () => {
    it('fuerza employeeId al del llamante cuando no es admin, sin importar lo enviado', async () => {
      const filterDto: any = { employeeId: 'tech-B' };
      await controller.findEquipment(filterDto, 'tech-A', [Role.TECNICO]);
      expect(filterDto.employeeId).toBe('tech-A');
      expect(equipmentMovementService.findEquipment).toHaveBeenCalledWith(filterDto);
    });

    it('respeta el filtro enviado cuando el llamante es admin', async () => {
      const filterDto: any = { employeeId: 'tech-B' };
      await controller.findEquipment(filterDto, 'admin-1', [Role.ADMIN]);
      expect(filterDto.employeeId).toBe('tech-B');
    });
  });

  describe('findAllDispatches', () => {
    it('fuerza technicianId al del llamante cuando no es admin', async () => {
      const filterDto: any = { technicianId: 'tech-B' };
      await controller.findAllDispatches(filterDto, 'tech-A', [Role.TECNICO]);
      expect(filterDto.technicianId).toBe('tech-A');
    });

    it('respeta el filtro enviado cuando el llamante es admin', async () => {
      const filterDto: any = { technicianId: 'tech-B' };
      await controller.findAllDispatches(filterDto, 'admin-1', [Role.GERENTE]);
      expect(filterDto.technicianId).toBe('tech-B');
    });
  });
});
