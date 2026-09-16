import * as bcrypt from 'bcrypt';
import { AppDataSource } from '../../config/database.config';
import { RoleEntity } from '../../modules/users/entities/role.entity';
import { UserEntity } from '../../modules/users/entities/user.entity';
import { AuditLogEntity } from '../../modules/users/entities/audit-log.entity';
import { EmployeeEntity } from '../../modules/employees/entities/employee.entity';
import { PlanEntity } from '../../modules/plans/entities/plan.entity';
import { ClientEntity } from '../../modules/clients/entities/client.entity';
import { AddressEntity } from '../../modules/clients/entities/address.entity';
import { ContractEntity } from '../../modules/clients/entities/contract.entity';
import { ProductEntity } from '../../modules/inventory/entities/product.entity';
import { CategoryEntity } from '../../modules/inventory/entities/category.entity';
import { SerialNumberEntity } from '../../modules/inventory/entities/serial-number.entity';
import { StockMovementEntity } from '../../modules/inventory/entities/stock-movement.entity';
import { WarehouseEntity } from '../../modules/inventory/entities/warehouse.entity';
import { EquipmentMovementEntity } from '../../modules/inventory/entities/equipment-movement.entity';
import { StockItemEntity } from '../../modules/inventory/entities/stock-item.entity';
import { EquipmentLocationType, EquipmentCondition, EquipmentMovementType } from '../../modules/inventory/enums/equipment.enums';
import { CashRegisterEntity } from '../../modules/pos/entities/cash-register.entity';
import { SaleEntity } from '../../modules/pos/entities/sale.entity';
import { SaleDetailEntity } from '../../modules/pos/entities/sale-detail.entity';
import { InvoiceEntity } from '../../modules/invoicing/entities/invoice.entity';
import { SlaPolicyEntity } from '../../modules/tickets/entities/sla-policy.entity';
import { TicketEntity } from '../../modules/tickets/entities/ticket.entity';
import { TicketHistoryEntity } from '../../modules/tickets/entities/ticket-history.entity';
import { TicketRepairEntity } from '../../modules/tickets/entities/ticket-repair.entity';
import { ScheduleEventEntity } from '../../modules/tickets/entities/schedule-event.entity';
import { OpportunityEntity } from '../../modules/crm/entities/opportunity.entity';
import { SubscriptionStatusEntity, SUBSCRIPTION_STATUS_CODE } from '../../modules/crm/entities/subscription-status.entity';
import { InteractionEntity } from '../../modules/crm/entities/interaction.entity';

export async function runInitialSeed() {
  console.log('🌱 ==============================================================================');
  console.log('🌱 INICIANDO SEMILLERO DE DATOS EMPRESARIAL SUMTECH (5 REGISTROS POR ENTIDAD 3NF)');
  console.log('🌱 ==============================================================================');

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  // 1. Crear esquemas multi-tenant / multi-esquema si no existen
  console.log('📦 Verificando y creando esquemas PostgreSQL (sec, com, pos, inv, tickets, crm)...');
  await AppDataSource.query(`
    CREATE SCHEMA IF NOT EXISTS sec;
    CREATE SCHEMA IF NOT EXISTS com;
    CREATE SCHEMA IF NOT EXISTS pos;
    CREATE SCHEMA IF NOT EXISTS inv;
    CREATE SCHEMA IF NOT EXISTS tickets;
    CREATE SCHEMA IF NOT EXISTS crm;
  `);

  // 2. Sincronizar automáticamente la estructura de tablas TypeORM
  console.log('⚙️  Sincronizando estructura relacional 3NF de tablas y claves foráneas...');
  await AppDataSource.synchronize();
  console.log('✅ Esquemas y tablas sincronizados exitosamente.');

  const roleRepo = AppDataSource.getRepository(RoleEntity);
  const userRepo = AppDataSource.getRepository(UserEntity);
  const auditRepo = AppDataSource.getRepository(AuditLogEntity);
  const employeeRepo = AppDataSource.getRepository(EmployeeEntity);
  const planRepo = AppDataSource.getRepository(PlanEntity);
  const clientRepo = AppDataSource.getRepository(ClientEntity);
  const addressRepo = AppDataSource.getRepository(AddressEntity);
  const contractRepo = AppDataSource.getRepository(ContractEntity);
  const productRepo = AppDataSource.getRepository(ProductEntity);
  const serialRepo = AppDataSource.getRepository(SerialNumberEntity);
  const movementRepo = AppDataSource.getRepository(StockMovementEntity);
  const warehouseRepo = AppDataSource.getRepository(WarehouseEntity);
  const equipmentMovementRepo = AppDataSource.getRepository(EquipmentMovementEntity);
  const stockItemRepo = AppDataSource.getRepository(StockItemEntity);
  const registerRepo = AppDataSource.getRepository(CashRegisterEntity);
  const saleRepo = AppDataSource.getRepository(SaleEntity);
  const detailRepo = AppDataSource.getRepository(SaleDetailEntity);
  const invoiceRepo = AppDataSource.getRepository(InvoiceEntity);
  const slaRepo = AppDataSource.getRepository(SlaPolicyEntity);
  const ticketRepo = AppDataSource.getRepository(TicketEntity);
  const historyRepo = AppDataSource.getRepository(TicketHistoryEntity);
  const repairRepo = AppDataSource.getRepository(TicketRepairEntity);
  const opportunityRepo = AppDataSource.getRepository(OpportunityEntity);
  const subscriptionStatusRepo = AppDataSource.getRepository(SubscriptionStatusEntity);
  const interactionRepo = AppDataSource.getRepository(InteractionEntity);

  // ----------------------------------------------------------------------------
  // 1. ROLES (5 Registros en sec.roles)
  // ----------------------------------------------------------------------------
  const rolesData = [
    { name: 'ADMIN', description: 'Administrador total del sistema ERP' },
    { name: 'GERENTE', description: 'Gerencia de Operaciones y Finanzas' },
    { name: 'CAJERO', description: 'Operador de Punto de Venta y Cobros' },
    { name: 'TECNICO', description: 'Técnico de Campo para Instalaciones y Averías' },
    { name: 'AGENTE_CRM', description: 'Ejecutivo de Ventas y Atención al Cliente' },
    { name: 'CLIENTE', description: 'Portal de Autoservicio y Autogestión del Cliente' },
  ];
  const savedRoles: Record<string, RoleEntity> = {};
  for (const r of rolesData) {
    let role = await roleRepo.findOneBy({ name: r.name });
    if (!role) {
      role = await roleRepo.save(roleRepo.create(r));
    }
    savedRoles[r.name] = role;
  }
  console.log('✅ 1/20 sec.roles: 5 roles insertados/verificados.');

  // ----------------------------------------------------------------------------
  // 2. USUARIOS (5 Registros en sec.users)
  // ----------------------------------------------------------------------------
  const defaultPass = await bcrypt.hash('password123', 10);
  const usersData = [
    { username: 'admin', email: 'admin@sumtech.do', roles: [savedRoles['ADMIN'], savedRoles['GERENTE']] },
    { username: 'pedro.gerente', email: 'p.gerencia@sumtech.do', roles: [savedRoles['GERENTE']] },
    { username: 'ana.caja', email: 'a.cajero@sumtech.do', roles: [savedRoles['CAJERO']] },
    { username: 'juan.tecnico', email: 'j.tecnico@sumtech.do', roles: [savedRoles['TECNICO']] },
    { username: 'luis.crm', email: 'l.crm@sumtech.do', roles: [savedRoles['AGENTE_CRM']] },
    { username: 'carlos.cliente', email: 'carlos.mendoza@correo.com', roles: [savedRoles['CLIENTE']] },
  ];
  const savedUsers: UserEntity[] = [];
  for (const u of usersData) {
    let user = await userRepo.findOneBy({ username: u.username });
    if (!user) {
      user = await userRepo.save(
        userRepo.create({
          username: u.username,
          email: u.email,
          passwordHash: defaultPass,
          roles: u.roles,
          isActive: true,
        }),
      );
    }
    savedUsers.push(user);
  }
  console.log('✅ 2/20 sec.users: 5 usuarios creados con contraseñas seguras bcrypt.');

  // ----------------------------------------------------------------------------
  // 3. EMPLEADOS (5 Registros en sec.employees)
  // ----------------------------------------------------------------------------
  const employeesData = [
    { userId: savedUsers[0].id, cedula: '001-0000000-1', jobTitle: 'Director General & Sistemas', salary: 125000, hireDate: '2023-01-15' },
    { userId: savedUsers[1].id, cedula: '001-2233445-5', jobTitle: 'Gerente de Operaciones de Red', salary: 85000, hireDate: '2023-03-01' },
    { userId: savedUsers[2].id, cedula: '001-1234567-2', jobTitle: 'Cajera Principal - SDE', salary: 35000, hireDate: '2023-06-10' },
    { userId: savedUsers[3].id, cedula: '001-9876543-1', jobTitle: 'Técnico Instalador GPON Senior', salary: 45000, hireDate: '2023-05-20' },
    { userId: savedUsers[4].id, cedula: '001-7788990-3', jobTitle: 'Ejecutivo de Cuentas & CRM', salary: 38000, hireDate: '2023-08-01' },
  ];
  const savedEmployees: EmployeeEntity[] = [];
  for (const emp of employeesData) {
    let employee = await employeeRepo.findOneBy({ userId: emp.userId });
    if (!employee) {
      employee = await employeeRepo.save(employeeRepo.create({ ...emp, isActive: true }));
    }
    savedEmployees.push(employee);
  }
  console.log('✅ 3/20 sec.employees: 5 colaboradores de nómina registrados.');

  // ----------------------------------------------------------------------------
  // 4. AUDITORÍA (5 Registros en sec.audit_logs)
  // ----------------------------------------------------------------------------
  const auditLogsData = [
    { userId: savedUsers[0].id, action: 'LOGIN_SUCCESS', entity: 'Auth', ipAddress: '192.168.1.10' },
    { userId: savedUsers[2].id, action: 'OPEN_CASH_REGISTER', entity: 'CashRegister', ipAddress: '192.168.1.25' },
    { userId: savedUsers[0].id, action: 'CREATE_PLAN', entity: 'Plan', ipAddress: '192.168.1.10' },
    { userId: savedUsers[3].id, action: 'ASSIGN_SERIAL_EQUIPMENT', entity: 'SerialNumber', ipAddress: '10.0.4.15' },
    { userId: savedUsers[1].id, action: 'GENERATE_DGII_607_REPORT', entity: 'Invoice', ipAddress: '192.168.1.12' },
  ];
  for (const log of auditLogsData) {
    const exists = await auditRepo.findOneBy({ action: log.action });
    if (!exists) {
      await auditRepo.save(auditRepo.create(log));
    }
  }
  console.log('✅ 4/20 sec.audit_logs: 5 trazas de auditoría registradas.');

  // ----------------------------------------------------------------------------
  // 5. PLANES DE SERVICIO (6 Registros en com.plans)
  // ----------------------------------------------------------------------------
  const plansData = [
    { name: 'Básico 20 Mbps Simétrico', serviceType: 'INTERNET' as const, speedMbps: 20, tvChannelsCount: 0, monthlyPrice: 850.00, itbisRate: 0.18, description: 'Navegación fluida, streaming HD y soporte técnico local en Azua.', isFeatured: false },
    { name: 'Estándar 30 Mbps Simétrico', serviceType: 'INTERNET' as const, speedMbps: 30, tvChannelsCount: 0, monthlyPrice: 1100.00, itbisRate: 0.18, description: 'Ideal para 3–5 dispositivos simultáneos con streaming 4K.', isFeatured: true },
    { name: 'Premium 50 Mbps + IPv6', serviceType: 'INTERNET' as const, speedMbps: 50, tvChannelsCount: 0, monthlyPrice: 1600.00, itbisRate: 0.18, description: 'Alta velocidad garantizada, dirección IPv6 nativa y gaming sin límites.', isFeatured: false },
    { name: 'PYME Básico 50 Mbps', serviceType: 'INTERNET' as const, speedMbps: 50, tvChannelsCount: 0, monthlyPrice: 2800.00, itbisRate: 0.18, description: 'Conectividad comercial con SLA 99.5% y crédito fiscal DGII.', isFeatured: false },
    { name: 'PYME Pro 100 Mbps', serviceType: 'INTERNET' as const, speedMbps: 100, tvChannelsCount: 0, monthlyPrice: 4500.00, itbisRate: 0.18, description: 'Fibra simétrica de alta prioridad para empresas y oficinas medianas.', isFeatured: false },
    { name: 'Corporativo 1 Gbps Dedicado', serviceType: 'INTERNET' as const, speedMbps: 1000, tvChannelsCount: 0, monthlyPrice: 8000.00, itbisRate: 0.18, description: 'Enlace simétrico dedicado con SLA garantizado y monitoreo 24/7.', isFeatured: false },
  ];
  const savedPlans: PlanEntity[] = [];
  for (const p of plansData) {
    let plan = await planRepo.findOneBy({ name: p.name });
    if (!plan) {
      plan = await planRepo.save(planRepo.create({ ...p, isActive: true }));
    }
    savedPlans.push(plan);
  }
  console.log('✅ 5/20 com.plans: 6 planes comerciales oficiales de Internet & TV creados.');

  // ----------------------------------------------------------------------------
  // 6. CLIENTES (5 Registros en com.clients)
  // ----------------------------------------------------------------------------
  const clientsData = [
    { clientType: 'FISICA' as const, name: 'Carlos Mendoza', docType: 'CEDULA' as const, docNumber: '001-1234567-8', email: 'carlos.mendoza@correo.com', phone: '809-555-0199' },
    { clientType: 'JURIDICA' as const, name: 'Inversiones Globales S.R.L.', docType: 'RNC' as const, docNumber: '131-98765-4', email: 'contabilidad@invglobales.do', phone: '809-555-4422' },
    { clientType: 'FISICA' as const, name: 'María Rodríguez', docType: 'CEDULA' as const, docNumber: '001-9876543-1', email: 'maria.rodriguez@gmail.com', phone: '829-555-8833' },
    { clientType: 'FISICA' as const, name: 'Fernando Castillo', docType: 'CEDULA' as const, docNumber: '001-5554321-9', email: 'fernando.c@outlook.com', phone: '809-555-9011' },
    { clientType: 'JURIDICA' as const, name: 'Centro Médico Familiar S.A.', docType: 'RNC' as const, docNumber: '132-00456-7', email: 'compras@cmfamiliar.do', phone: '809-555-3311' },
  ];
  const savedClients: ClientEntity[] = [];
  for (const c of clientsData) {
    let client = await clientRepo.findOneBy({ docNumber: c.docNumber });
    if (!client) {
      client = await clientRepo.save(clientRepo.create({ ...c, isActive: true }));
    }
    savedClients.push(client);
  }

  // Vincular usuario de prueba CLIENTE a Carlos Mendoza
  const clientUser = savedUsers.find((u) => u.username === 'carlos.cliente');
  if (savedClients[0] && clientUser) {
    savedClients[0].userId = clientUser.id;
    await clientRepo.save(savedClients[0]);
  }
  console.log('✅ 6/20 com.clients: 5 suscriptores reales (Físicos y Jurídicos) registrados.');

  // ----------------------------------------------------------------------------
  // 7. DIRECCIONES (5 Registros en com.addresses)
  // ----------------------------------------------------------------------------
  const addressesData = [
    { clientId: savedClients[0].id, street: 'Calle Duarte #42', buildingNumber: 'Apto 2B', sector: 'Azua (centro)', municipality: 'Azua de Compostela', city: 'Azua', gpsLatitude: 18.452100, gpsLongitude: -70.734800 },
    { clientId: savedClients[1].id, street: 'Calle Sánchez #15', buildingNumber: 'Local Comercial 1', sector: 'Pueblo Viejo', municipality: 'Pueblo Viejo', city: 'Azua', gpsLatitude: 18.400000, gpsLongitude: -70.780000 },
    { clientId: savedClients[2].id, street: 'Carretera Sánchez Km 15', buildingNumber: 'Casa 3', sector: 'Km 15', municipality: 'Azua de Compostela', city: 'Azua', gpsLatitude: 18.470000, gpsLongitude: -70.710000 },
    { clientId: savedClients[3].id, street: 'Calle Mella #88', buildingNumber: 'Residencial San Juan Apto 4A', sector: 'Las Yayas', municipality: 'Las Yayas de Viajama', city: 'Azua', gpsLatitude: 18.600000, gpsLongitude: -70.920000 },
    { clientId: savedClients[4].id, street: 'Av. Independencia #24', buildingNumber: 'Suite Médica 3', sector: 'Tábara Arriba', municipality: 'Tábara Arriba', city: 'Azua', gpsLatitude: 18.550000, gpsLongitude: -70.890000 },
  ];
  const savedAddresses: AddressEntity[] = [];
  for (const addr of addressesData) {
    let address = await addressRepo.findOneBy({ clientId: addr.clientId, street: addr.street });
    if (!address) {
      address = await addressRepo.save(addressRepo.create({ ...addr, isPrimary: true }));
    }
    savedAddresses.push(address);
  }
  console.log('✅ 7/20 com.addresses: 5 domicilios con coordenadas GPS insertados.');

  // ----------------------------------------------------------------------------
  // 8. CONTRATOS (5 Registros en com.contracts)
  // ----------------------------------------------------------------------------
  const contractsData = [
    { contractNumber: 'CTR-2026-001', clientId: savedClients[0].id, planId: savedPlans[2].id, addressId: savedAddresses[0].id, startDate: '2024-01-10', billingDay: 15, status: 'ACTIVE' as const },
    { contractNumber: 'CTR-2026-002', clientId: savedClients[1].id, planId: savedPlans[4].id, addressId: savedAddresses[1].id, startDate: '2024-02-01', billingDay: 30, status: 'ACTIVE' as const },
    { contractNumber: 'CTR-2026-003', clientId: savedClients[2].id, planId: savedPlans[0].id, addressId: savedAddresses[2].id, startDate: '2024-03-15', billingDay: 15, status: 'ACTIVE' as const },
    { contractNumber: 'CTR-2026-004', clientId: savedClients[3].id, planId: savedPlans[2].id, addressId: savedAddresses[3].id, startDate: '2024-04-05', billingDay: 5, status: 'PENDING_INSTALL' as const },
    { contractNumber: 'CTR-2026-005', clientId: savedClients[4].id, planId: savedPlans[3].id, addressId: savedAddresses[4].id, startDate: '2024-05-12', billingDay: 15, status: 'ACTIVE' as const },
  ];
  const savedContracts: ContractEntity[] = [];
  for (const c of contractsData) {
    let contract = await contractRepo.findOneBy({ contractNumber: c.contractNumber });
    if (!contract) {
      contract = await contractRepo.save(contractRepo.create(c));
    }
    savedContracts.push(contract);
  }
  console.log('✅ 8/20 com.contracts: 5 contratos de suscripción activos.');

  // ----------------------------------------------------------------------------
  // 8.5. ALMACÉN CENTRAL (inv.warehouses)
  // ----------------------------------------------------------------------------
  let mainWarehouse = await warehouseRepo.findOneBy({ name: 'Almacén Central' });
  if (!mainWarehouse) {
    mainWarehouse = await warehouseRepo.save(
      warehouseRepo.create({ name: 'Almacén Central', address: 'Sede principal de operaciones' }),
    );
  }
  console.log('✅ 8.5/20 inv.warehouses: almacén central registrado.');

  // ----------------------------------------------------------------------------
  // 9. PRODUCTOS DE INVENTARIO (5 Registros en inv.products)
  // ----------------------------------------------------------------------------
  const categoryRepo = AppDataSource.getRepository(CategoryEntity);
  const productsData = [
    { sku: 'HW-ONU-AC1200', name: 'Router ONT Huawei Dual Band GPON Wi-Fi 6', categoryCode: 'ROUTER_ONU', brand: 'Huawei', model: 'OptiXstar HG8145X6', costPrice: 2400, salePrice: 3500, stockCurrent: 45, stockMinimum: 10, requiresSerial: true },
    { sku: 'HW-ONU-ZTE-F670L', name: 'Router ONT ZTE GPON Dual Band Wi-Fi 5', categoryCode: 'ROUTER_ONU', brand: 'ZTE', model: 'ZXHN F670L', costPrice: 1900, salePrice: 2950, stockCurrent: 38, stockMinimum: 10, requiresSerial: true },
    { sku: 'STB-4K-ANDR', name: 'Decodificador Set-Top Box 4K Android TV', categoryCode: 'SET_TOP_BOX', brand: 'ZTE', model: 'ZXV10 B866V2K', costPrice: 1800, salePrice: 2600, stockCurrent: 30, stockMinimum: 8, requiresSerial: true },
    { sku: 'CAB-DROP-1KM', name: 'Bobina Cable Drop Fibra Óptica 1 Hilo (1,000m)', categoryCode: 'FIBER_CABLE', brand: 'FiberHome', model: 'GJXFH-1B6', costPrice: 4500, salePrice: 6200, stockCurrent: 18, stockMinimum: 5, requiresSerial: false },
    { sku: 'CON-SCAPC-100', name: 'Conectores Rápidos SC/APC (Caja 100 uds)', categoryCode: 'CONNECTOR', brand: 'Corning', model: 'SC-APC-FAST', costPrice: 1200, salePrice: 1900, stockCurrent: 25, stockMinimum: 8, requiresSerial: false },
  ];
  const savedProducts: ProductEntity[] = [];
  for (const { categoryCode, ...p } of productsData) {
    let product = await productRepo.findOneBy({ sku: p.sku });
    if (!product) {
      const category = await categoryRepo.findOneBy({ code: categoryCode });
      product = await productRepo.save(productRepo.create({ ...p, categoryId: category?.id }));
    }
    savedProducts.push(product);
  }
  console.log('✅ 9/20 inv.products: 5 productos de hardware y fibra en almacén.');

  // ----------------------------------------------------------------------------
  // 10. SERIALES Y MACS (5 Registros en inv.serial_numbers) + kardex de trazabilidad
  // ----------------------------------------------------------------------------
  const technician = savedEmployees[3];
  const serialsData = [
    {
      productId: savedProducts[0].id, serialNumber: 'HWTC20260001', macAddress: 'A4:93:3F:4B:11:01',
      status: 'ASSIGNED_TO_CLIENT' as const, locationType: EquipmentLocationType.CLIENT, condition: EquipmentCondition.GOOD,
      clientId: savedClients[0].id, currentContractId: savedContracts[0].id,
    },
    {
      productId: savedProducts[0].id, serialNumber: 'HWTC20260002', macAddress: 'A4:93:3F:4B:11:02',
      status: 'RESERVED' as const, locationType: EquipmentLocationType.TECHNICIAN, condition: EquipmentCondition.NEW,
      currentEmployeeId: technician.id,
    },
    {
      productId: savedProducts[1].id, serialNumber: 'ZTE2026ONT01', macAddress: 'C8:5B:76:88:21:01',
      status: 'ASSIGNED_TO_CLIENT' as const, locationType: EquipmentLocationType.CLIENT, condition: EquipmentCondition.GOOD,
      clientId: savedClients[2].id, currentContractId: savedContracts[2].id,
    },
    {
      productId: savedProducts[2].id, serialNumber: 'ZTE2026STB01', macAddress: 'C8:5B:76:12:33:01',
      status: 'ASSIGNED_TO_CLIENT' as const, locationType: EquipmentLocationType.CLIENT, condition: EquipmentCondition.GOOD,
      clientId: savedClients[0].id, currentContractId: savedContracts[0].id,
    },
    {
      productId: savedProducts[2].id, serialNumber: 'ZTE2026STB02', macAddress: 'C8:5B:76:12:33:02',
      status: 'AVAILABLE' as const, locationType: EquipmentLocationType.WAREHOUSE, condition: EquipmentCondition.NEW,
      currentWarehouseId: mainWarehouse.id,
    },
    {
      productId: savedProducts[0].id, serialNumber: 'HWTC-WH-00101', macAddress: 'A4:93:3F:88:10:01',
      status: 'AVAILABLE' as const, locationType: EquipmentLocationType.WAREHOUSE, condition: EquipmentCondition.NEW,
      currentWarehouseId: mainWarehouse.id,
    },
    {
      productId: savedProducts[0].id, serialNumber: 'HWTC-WH-00102', macAddress: 'A4:93:3F:88:10:02',
      status: 'AVAILABLE' as const, locationType: EquipmentLocationType.WAREHOUSE, condition: EquipmentCondition.NEW,
      currentWarehouseId: mainWarehouse.id,
    },
    {
      productId: savedProducts[1].id, serialNumber: 'ZTE-WH-00201', macAddress: 'C8:5B:76:99:20:01',
      status: 'AVAILABLE' as const, locationType: EquipmentLocationType.WAREHOUSE, condition: EquipmentCondition.NEW,
      currentWarehouseId: mainWarehouse.id,
    },
    {
      productId: savedProducts[2].id, serialNumber: 'STB-WH-00301', macAddress: 'C8:5B:76:77:30:01',
      status: 'AVAILABLE' as const, locationType: EquipmentLocationType.WAREHOUSE, condition: EquipmentCondition.NEW,
      currentWarehouseId: mainWarehouse.id,
    },
  ];
  const savedSerials: SerialNumberEntity[] = [];
  for (const s of serialsData) {
    let serial = await serialRepo.findOneBy({ serialNumber: s.serialNumber });
    if (!serial) {
      serial = await serialRepo.save(serialRepo.create({ ...s, lastMovementAt: new Date() }));
    }
    savedSerials.push(serial);
  }
  console.log('✅ 10/20 inv.serial_numbers: 5 seriales ONT/STB con direcciones MAC únicas.');

  // Kardex de equipos: ilustra el ciclo ingreso → (técnico) → instalación por cada serial.
  for (const serial of savedSerials) {
    const alreadyLogged = await equipmentMovementRepo.findOneBy({ equipmentItemId: serial.id });
    if (alreadyLogged) continue;

    await equipmentMovementRepo.save(
      equipmentMovementRepo.create({
        equipmentItemId: serial.id,
        movementType: EquipmentMovementType.INGRESO_ALMACEN,
        toLocationType: EquipmentLocationType.WAREHOUSE,
        toWarehouseId: mainWarehouse.id,
        conditionAfter: EquipmentCondition.NEW,
        performedByUserId: savedUsers[0].id,
      }),
    );

    if (serial.locationType === EquipmentLocationType.TECHNICIAN) {
      await equipmentMovementRepo.save(
        equipmentMovementRepo.create({
          equipmentItemId: serial.id,
          movementType: EquipmentMovementType.ASIGNAR_A_TECNICO,
          fromLocationType: EquipmentLocationType.WAREHOUSE,
          fromWarehouseId: mainWarehouse.id,
          toLocationType: EquipmentLocationType.TECHNICIAN,
          toEmployeeId: technician.id,
          conditionAfter: EquipmentCondition.NEW,
          performedByUserId: savedUsers[0].id,
        }),
      );
    } else if (serial.locationType === EquipmentLocationType.CLIENT) {
      await equipmentMovementRepo.save(
        equipmentMovementRepo.create({
          equipmentItemId: serial.id,
          movementType: EquipmentMovementType.ASIGNAR_A_TECNICO,
          fromLocationType: EquipmentLocationType.WAREHOUSE,
          fromWarehouseId: mainWarehouse.id,
          toLocationType: EquipmentLocationType.TECHNICIAN,
          toEmployeeId: technician.id,
          conditionAfter: EquipmentCondition.NEW,
          performedByUserId: savedUsers[0].id,
        }),
      );
      await equipmentMovementRepo.save(
        equipmentMovementRepo.create({
          equipmentItemId: serial.id,
          movementType: EquipmentMovementType.INSTALAR_EN_CLIENTE,
          fromLocationType: EquipmentLocationType.TECHNICIAN,
          fromEmployeeId: technician.id,
          toLocationType: EquipmentLocationType.CLIENT,
          toClientId: serial.clientId,
          toContractId: serial.currentContractId,
          conditionAfter: EquipmentCondition.GOOD,
          performedByUserId: technician.userId,
        }),
      );
    }
  }
  console.log('✅ 10.5/20 inv.equipment_movements: kardex de trazabilidad por equipo generado.');

  // Material a granel (cable de fibra) que el técnico lleva en su vehículo de trabajo.
  const cableProduct = savedProducts[3];
  const existingCableStock = await stockItemRepo.findOneBy({ productId: cableProduct.id, employeeId: technician.id });
  if (!existingCableStock) {
    await stockItemRepo.save(stockItemRepo.create({ productId: cableProduct.id, employeeId: technician.id, quantity: 150 }));
  }
  console.log('✅ 10.6/20 inv.stock_items: 150m de cable de fibra en poder del técnico de campo.');

  // ----------------------------------------------------------------------------
  // 11. MOVIMIENTOS KARDEX (5 Registros en inv.stock_movements)
  // ----------------------------------------------------------------------------
  const movementsData = [
    { productId: savedProducts[0].id, movementType: 'IN_PURCHASE' as const, quantity: 50, previousStock: 0, newStock: 50, userId: savedUsers[0].id, notes: 'Compra inicial a distribuidor Huawei' },
    { productId: savedProducts[0].id, movementType: 'OUT_INSTALLATION' as const, quantity: 1, previousStock: 50, newStock: 49, userId: savedUsers[3].id, notes: 'Instalación cliente Carlos Mendoza' },
    { productId: savedProducts[1].id, movementType: 'IN_PURCHASE' as const, quantity: 40, previousStock: 0, newStock: 40, userId: savedUsers[0].id, notes: 'Ingreso lote routers ZTE' },
    { productId: savedProducts[2].id, movementType: 'IN_PURCHASE' as const, quantity: 35, previousStock: 0, newStock: 35, userId: savedUsers[0].id, notes: 'Ingreso decodificadores Android TV' },
    { productId: savedProducts[3].id, movementType: 'IN_PURCHASE' as const, quantity: 20, previousStock: 0, newStock: 20, userId: savedUsers[0].id, notes: 'Compra bobinas de fibra óptica' },
  ];
  for (const m of movementsData) {
    const exists = await movementRepo.findOneBy({ notes: m.notes });
    if (!exists) {
      await movementRepo.save(movementRepo.create(m));
    }
  }
  console.log('✅ 11/20 inv.stock_movements: 5 movimientos de Kardex registrados.');

  // ----------------------------------------------------------------------------
  // 12. CAJAS REGISTRADORAS (5 Registros en pos.cash_registers)
  // ----------------------------------------------------------------------------
  const cashRegistersData = [
    { userId: savedUsers[2].id, openingAmount: 5000, expectedClosingAmount: 28450, realClosingAmount: 28450, difference: 0, status: 'CLOSED' as const, notes: 'Turno mañana cerrado cuadrado' },
    { userId: savedUsers[2].id, openingAmount: 5000, expectedClosingAmount: 32100, realClosingAmount: 32100, difference: 0, status: 'CLOSED' as const, notes: 'Turno tarde cerrado cuadrado' },
    { userId: savedUsers[0].id, openingAmount: 10000, expectedClosingAmount: 45000, realClosingAmount: 45000, difference: 0, status: 'CLOSED' as const, notes: 'Caja administrativa' },
    { userId: savedUsers[2].id, openingAmount: 5000, expectedClosingAmount: 18900, realClosingAmount: 18900, difference: 0, status: 'CLOSED' as const, notes: 'Turno previo' },
    { userId: savedUsers[2].id, openingAmount: 5000, status: 'OPEN' as const, notes: 'Turno actual en curso' },
  ];
  const savedRegisters: CashRegisterEntity[] = [];
  for (const cr of cashRegistersData) {
    const exists = await registerRepo.findOneBy({ notes: cr.notes });
    if (!exists) {
      const reg = await registerRepo.save(registerRepo.create(cr));
      savedRegisters.push(reg);
    } else {
      savedRegisters.push(exists);
    }
  }
  console.log('✅ 12/20 pos.cash_registers: 5 turnos de caja registrados.');

  // ----------------------------------------------------------------------------
  // 13. VENTAS POS (5 Registros en pos.sales)
  // ----------------------------------------------------------------------------
  const salesData = [
    { clientId: savedClients[0].id, userId: savedUsers[2].id, cashRegisterId: savedRegisters[0].id, subtotal: 2195.00, itbisTotal: 395.10, grandTotal: 2590.10, paymentMethod: 'CARD_DEBIT' as const, status: 'PAID' as const },
    { clientId: savedClients[1].id, userId: savedUsers[2].id, cashRegisterId: savedRegisters[0].id, subtotal: 3850.00, itbisTotal: 693.00, grandTotal: 4543.00, paymentMethod: 'BANK_TRANSFER' as const, status: 'PAID' as const },
    { clientId: savedClients[2].id, userId: savedUsers[2].id, cashRegisterId: savedRegisters[1].id, subtotal: 1250.00, itbisTotal: 225.00, grandTotal: 1475.00, paymentMethod: 'CASH' as const, status: 'PAID' as const },
    { clientId: savedClients[3].id, userId: savedUsers[2].id, cashRegisterId: savedRegisters[2].id, subtotal: 2195.00, itbisTotal: 395.10, grandTotal: 2590.10, paymentMethod: 'CARD_CREDIT' as const, status: 'PAID' as const },
    { clientId: savedClients[4].id, userId: savedUsers[2].id, cashRegisterId: savedRegisters[3].id, subtotal: 2850.00, itbisTotal: 513.00, grandTotal: 3363.00, paymentMethod: 'BANK_TRANSFER' as const, status: 'PAID' as const },
  ];
  const savedSales: SaleEntity[] = [];
  for (const s of salesData) {
    let sale = await saleRepo.findOneBy({ clientId: s.clientId, grandTotal: s.grandTotal });
    if (!sale) {
      sale = await saleRepo.save(saleRepo.create(s));
    }
    savedSales.push(sale);
  }
  console.log('✅ 13/20 pos.sales: 5 ventas reales registradas.');

  // ----------------------------------------------------------------------------
  // 14. DETALLES DE VENTA (5 Registros en pos.sale_details)
  // ----------------------------------------------------------------------------
  const detailsData = [
    { saleId: savedSales[0].id, itemType: 'PLAN_ACTIVATION' as const, itemId: savedPlans[2].id, concept: 'Suscripción Combo Dúo 150 Mbps + TV HD', quantity: 1, unitPrice: 2195.00, itbisAmount: 395.10, subtotal: 2195.00 },
    { saleId: savedSales[1].id, itemType: 'PLAN_ACTIVATION' as const, itemId: savedPlans[4].id, concept: 'Suscripción Combo Dúo Élite 500 Mbps + TV 4K', quantity: 1, unitPrice: 3850.00, itbisAmount: 693.00, subtotal: 3850.00 },
    { saleId: savedSales[2].id, itemType: 'PLAN_ACTIVATION' as const, itemId: savedPlans[0].id, concept: 'Suscripción Fibra 50 Mbps Simétrica', quantity: 1, unitPrice: 1250.00, itbisAmount: 225.00, subtotal: 1250.00 },
    { saleId: savedSales[3].id, itemType: 'PLAN_ACTIVATION' as const, itemId: savedPlans[2].id, concept: 'Suscripción Combo Dúo 150 Mbps + TV HD', quantity: 1, unitPrice: 2195.00, itbisAmount: 395.10, subtotal: 2195.00 },
    { saleId: savedSales[4].id, itemType: 'PLAN_ACTIVATION' as const, itemId: savedPlans[3].id, concept: 'Suscripción Fibra 300 Mbps Pro Gamer', quantity: 1, unitPrice: 2850.00, itbisAmount: 513.00, subtotal: 2850.00 },
  ];
  for (const d of detailsData) {
    const exists = await detailRepo.findOneBy({ saleId: d.saleId, concept: d.concept });
    if (!exists) {
      await detailRepo.save(detailRepo.create(d));
    }
  }
  console.log('✅ 14/20 pos.sale_details: 5 líneas de detalle de factura registradas.');

  // ----------------------------------------------------------------------------
  // 15. FACTURAS ELECTRÓNICAS e-CF DGII (5 Registros en pos.invoices)
  // ----------------------------------------------------------------------------
  const invoicesData = [
    { saleId: savedSales[0].id, ncfNumber: 'E3100000001', ncfType: 'E31' as const, dgiiStatus: 'ACCEPTED' as const, dgiiTrackId: 'TRK-DGII-881901', securityCode: 'A8B2C4', qrCodeContent: 'https://ecf.dgii.gov.do/consulta?encf=E3100000001' },
    { saleId: savedSales[1].id, ncfNumber: 'B0100000001', ncfType: 'B01' as const, dgiiStatus: 'ACCEPTED' as const, dgiiTrackId: 'TRK-DGII-881902', securityCode: 'F9D3E1', qrCodeContent: 'https://ecf.dgii.gov.do/consulta?encf=B0100000001' },
    { saleId: savedSales[2].id, ncfNumber: 'B0200000001', ncfType: 'B02' as const, dgiiStatus: 'ACCEPTED' as const, dgiiTrackId: 'TRK-DGII-881903', securityCode: 'C1E8A9', qrCodeContent: 'https://ecf.dgii.gov.do/consulta?encf=B0200000001' },
    { saleId: savedSales[3].id, ncfNumber: 'E3100000002', ncfType: 'E31' as const, dgiiStatus: 'ACCEPTED' as const, dgiiTrackId: 'TRK-DGII-881904', securityCode: 'K7L4M2', qrCodeContent: 'https://ecf.dgii.gov.do/consulta?encf=E3100000002' },
    { saleId: savedSales[4].id, ncfNumber: 'B0100000002', ncfType: 'B01' as const, dgiiStatus: 'ACCEPTED' as const, dgiiTrackId: 'TRK-DGII-881905', securityCode: 'P2Q5R8', qrCodeContent: 'https://ecf.dgii.gov.do/consulta?encf=B0100000002' },
  ];
  for (const inv of invoicesData) {
    let invoice = await invoiceRepo.findOneBy({ ncfNumber: inv.ncfNumber });
    if (!invoice) {
      await invoiceRepo.save(invoiceRepo.create({ ...inv, responseMessage: 'Comprobante Fiscal Electrónico Timbrado y Aceptado por DGII', issuedAt: new Date() }));
    }
  }
  console.log('✅ 15/20 pos.invoices: 5 comprobantes e-CF DGII timbrados.');

  // ----------------------------------------------------------------------------
  // 16. POLÍTICAS DE SLA (5 Registros en tickets.sla_policies)
  // ----------------------------------------------------------------------------
  const slasData = [
    { name: 'SLA Crítico Empresa', maxResponseHours: 1, maxResolutionHours: 4, priority: 'CRITICAL' as const },
    { name: 'SLA Avería Fibra Residencial', maxResponseHours: 4, maxResolutionHours: 12, priority: 'HIGH' as const },
    { name: 'SLA Residencial Estándar', maxResponseHours: 6, maxResolutionHours: 24, priority: 'MEDIUM' as const },
    { name: 'SLA Mantenimiento Preventivo', maxResponseHours: 12, maxResolutionHours: 48, priority: 'LOW' as const },
    { name: 'SLA Instalación VIP', maxResponseHours: 2, maxResolutionHours: 24, priority: 'HIGH' as const },
  ];
  const savedSlas: SlaPolicyEntity[] = [];
  for (const s of slasData) {
    let sla = await slaRepo.findOneBy({ name: s.name });
    if (!sla) {
      sla = await slaRepo.save(slaRepo.create(s));
    }
    savedSlas.push(sla);
  }
  console.log('✅ 16/20 tickets.sla_policies: 5 políticas de SLA operativas.');

  // ----------------------------------------------------------------------------
  // 17. TICKETS DE TRABAJO (5 Registros en tickets.tickets)
  // ----------------------------------------------------------------------------
  const ticketsData = [
    { ticketNumber: 'TCK-2026-0001', clientId: savedClients[0].id, contractId: savedContracts[0].id, assignedEmployeeId: savedEmployees[3].id, type: 'INSTALLATION' as const, priority: 'HIGH' as const, status: 'RESOLVED' as const, slaPolicyId: savedSlas[4].id, title: 'Instalación Combo Dúo 150 Mbps + TV HD', description: 'Instalación de fibra y equipos completada exitosamente.' },
    { ticketNumber: 'TCK-2026-0002', clientId: savedClients[1].id, contractId: savedContracts[1].id, assignedEmployeeId: savedEmployees[3].id, type: 'INSTALLATION' as const, priority: 'CRITICAL' as const, status: 'RESOLVED' as const, slaPolicyId: savedSlas[0].id, title: 'Instalación Enlace Dedicado 500 Mbps', description: 'Instalación corporativa activada en Torre Empresarial.' },
    { ticketNumber: 'TCK-2026-0003', clientId: savedClients[2].id, contractId: savedContracts[2].id, assignedEmployeeId: savedEmployees[3].id, type: 'REPAIR_FAULT' as const, priority: 'CRITICAL' as const, status: 'IN_PROGRESS' as const, slaPolicyId: savedSlas[1].id, title: 'Pérdida de señal GPON - Luz LOS parpadeando en rojo', description: 'Revisión de potencia óptica en CTO y acometida.' },
    { ticketNumber: 'TCK-2026-0004', clientId: savedClients[3].id, contractId: savedContracts[3].id, assignedEmployeeId: savedEmployees[3].id, type: 'INSTALLATION' as const, priority: 'HIGH' as const, status: 'OPEN' as const, slaPolicyId: savedSlas[4].id, title: 'Instalación Residencial 150 Mbps', description: 'Pendiente de visita de técnico para conectorización.' },
    { ticketNumber: 'TCK-2026-0005', clientId: savedClients[4].id, contractId: savedContracts[4].id, assignedEmployeeId: savedEmployees[3].id, type: 'MAINTENANCE' as const, priority: 'MEDIUM' as const, status: 'ON_HOLD' as const, slaPolicyId: savedSlas[2].id, title: 'Reubicación de router a segundo piso', description: 'En espera de confirmación de horario por parte del cliente.' },
  ];
  const savedTickets: TicketEntity[] = [];
  for (const t of ticketsData) {
    let ticket = await ticketRepo.findOneBy({ ticketNumber: t.ticketNumber });
    if (!ticket) {
      ticket = await ticketRepo.save(ticketRepo.create(t));
    }
    savedTickets.push(ticket);
  }
  console.log('✅ 17/20 tickets.tickets: 5 órdenes técnicas en distintos estados.');

  // ----------------------------------------------------------------------------
  // 18. HISTORIAL DE TICKETS (5 Registros en tickets.ticket_history)
  // ----------------------------------------------------------------------------
  const historyData = [
    { ticketId: savedTickets[0].id, previousStatus: 'OPEN', newStatus: 'IN_PROGRESS', changedByUserId: savedUsers[0].id, note: 'Técnico despachado a terreno' },
    { ticketId: savedTickets[0].id, previousStatus: 'IN_PROGRESS', newStatus: 'RESOLVED', changedByUserId: savedUsers[3].id, note: 'Instalación completada y parámetros de potencia ópticos validados (-19.2 dBm)' },
    { ticketId: savedTickets[1].id, previousStatus: 'OPEN', newStatus: 'IN_PROGRESS', changedByUserId: savedUsers[0].id, note: 'Despacho de brigada técnica' },
    { ticketId: savedTickets[2].id, previousStatus: 'OPEN', newStatus: 'IN_PROGRESS', changedByUserId: savedUsers[3].id, note: 'Técnico en domicilio realizando pruebas de continuidad con OTDR' },
    { ticketId: savedTickets[4].id, previousStatus: 'OPEN', newStatus: 'ON_HOLD', changedByUserId: savedUsers[4].id, note: 'Cliente solicitó aplazar para el sábado por la mañana' },
  ];
  for (const h of historyData) {
    const exists = await historyRepo.findOneBy({ note: h.note });
    if (!exists) {
      await historyRepo.save(historyRepo.create(h));
    }
  }
  console.log('✅ 18/20 tickets.ticket_history: 5 registros de trazabilidad de tickets.');

  // ----------------------------------------------------------------------------
  // 19. REPARACIONES Y SWAP DE HARDWARE (5 Registros en tickets.ticket_repairs)
  // ----------------------------------------------------------------------------
  const repairsData = [
    { ticketId: savedTickets[2].id, serialRemovedId: (await serialRepo.findOneBy({ serialNumber: 'HWTC20260001' }))!.id, serialInstalledId: (await serialRepo.findOneBy({ serialNumber: 'HWTC20260002' }))!.id, reason: 'Puerto PON dañado por sobretensión eléctrica' },
  ];
  for (const rep of repairsData) {
    const exists = await repairRepo.findOneBy({ reason: rep.reason });
    if (!exists) {
      await repairRepo.save(repairRepo.create(rep));
    }
  }
  console.log('✅ 19/20 tickets.ticket_repairs: Registros de cambio de hardware averiado insertados.');

  // ----------------------------------------------------------------------------
  // 20. CRM LEADS & INTERACCIONES (5 Registros cada uno en crm)
  // ----------------------------------------------------------------------------
  const statusByCode: Record<string, string> = {};
  for (const status of await subscriptionStatusRepo.find()) {
    statusByCode[status.code] = status.id;
  }

  const opportunitiesData = [
    { name: 'José Ramírez', phone: '809-555-7744', email: 'j.ramirez@gmail.com', planId: savedPlans[2].id, source: 'WEB_LANDING' as const, statusCode: SUBSCRIPTION_STATUS_CODE.PROSPECTO, notes: 'Sector: Alma Rosa II (Calle Club de Leones)' },
    { name: 'Consultoría Financiera SRL', phone: '829-555-1100', email: 'contacto@cfinanciera.do', planId: savedPlans[3].id, source: 'CALL_INBOUND' as const, statusCode: SUBSCRIPTION_STATUS_CODE.EN_NEGOCIACION, notes: 'Sector: Piantini. Interesados en 2 enlaces simétricos.' },
    { name: 'Ana Patricia Morales', phone: '809-555-3399', email: 'ana.morales@hotmail.com', planId: savedPlans[0].id, source: 'WEB_LANDING' as const, statusCode: SUBSCRIPTION_STATUS_CODE.EN_NEGOCIACION, notes: 'Sector: Ensanche Ozama. Cobertura validada.' },
    { name: 'Dra. Carmen Peña', phone: '849-555-6677', email: 'dra.carmenp@medico.do', planId: savedPlans[2].id, source: 'WHATSAPP' as const, statusCode: SUBSCRIPTION_STATUS_CODE.SUSCRIPCION_ACTIVA, notes: 'Sector: Naco. Cliente convertida a suscriptor formal.' },
    { name: 'Supermercado El Sol', phone: '809-555-9988', email: 'gerencia@superelsol.do', planId: savedPlans[4].id, source: 'FLYER' as const, statusCode: SUBSCRIPTION_STATUS_CODE.PROSPECTO, notes: 'Sector: Santiago de los Caballeros. Enlace para sucursales.' },
  ];
  for (const o of opportunitiesData) {
    const existing = await opportunityRepo.findOneBy({ phone: o.phone });
    if (!existing) {
      const { statusCode, ...rest } = o;
      await opportunityRepo.save(
        opportunityRepo.create({
          ...rest,
          subscriptionStatusId: statusByCode[statusCode],
          firstContactAt: new Date(),
        }),
      );
    }
  }

  const interactionsData = [
    { clientId: savedClients[0].id, userId: savedUsers[4].id, channel: 'PHONE_CALL' as const, subject: 'Validación de Calidad de Señal Post-Instalación', notes: 'Cliente reporta excelente velocidad de navegación (150 Mbps simétricos) y satisfacción con los canales HD.' },
    { clientId: savedClients[1].id, userId: savedUsers[4].id, channel: 'EMAIL' as const, subject: 'Envío de Factura Electrónica B0100000001', notes: 'Factura con NCF de Crédito Fiscal remitida al departamento de contabilidad.' },
    { clientId: savedClients[2].id, userId: savedUsers[3].id, channel: 'IN_PERSON' as const, subject: 'Visita Técnica de Diagnóstico de Potencia Óptica', notes: 'Técnico Juan Pérez midió atenuación en roseta óptica.' },
    { clientId: savedClients[3].id, userId: savedUsers[4].id, channel: 'WHATSAPP' as const, subject: 'Confirmación de Horario de Visita Técnica', notes: 'Cliente confirmó que estará disponible en la mañana.' },
    { clientId: savedClients[0].id, userId: savedUsers[2].id, channel: 'SYSTEM_EVENT' as const, subject: 'Venta Confirmada - Factura E3100000001', notes: 'Compra inicial de Combo Dúo timbrada en caja POS.' },
  ];
  for (const inter of interactionsData) {
    const exists = await interactionRepo.findOneBy({ subject: inter.subject });
    if (!exists) {
      await interactionRepo.save(interactionRepo.create(inter));
    }
  }
  console.log('✅ 20/20 crm.opportunities & crm.interactions: 5 prospectos y 5 interacciones 360° insertados.');

  // ----------------------------------------------------------------------------
  // 21. EVENTOS Y ACTIVIDADES DE OFICINA / GANTT (5 Registros en tickets.schedule_events)
  // ----------------------------------------------------------------------------
  const eventRepo = AppDataSource.getRepository(ScheduleEventEntity);
  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const eventsData = [
    {
      title: 'Cierre de Facturación & Emisión e-CF Ciclo 15',
      description: 'Generación y timbrado de facturas fiscales electrónicas para el ciclo de suscripción.',
      type: 'FECHA_PAGO' as const,
      scope: 'GLOBAL' as const,
      eventDate: todayStr,
      isAllDay: true,
      color: 'amber',
      createdByUserId: savedUsers[0].id,
    },
    {
      title: 'Ventana de Mantenimiento Troncal OLT (Fibra Nodo Norte)',
      description: 'Revisión y balanceo de splitters ópticos de distribución en cabecera.',
      type: 'MANTENIMIENTO_RED' as const,
      scope: 'GLOBAL' as const,
      eventDate: todayStr,
      startTime: '13:00',
      durationMinutes: 120,
      isAllDay: false,
      color: 'orange',
      createdByUserId: savedUsers[0].id,
    },
    {
      title: 'Reunión Semanal de Alineación y Seguridad de Cuadrillas',
      description: 'Revisión de protocolos de altura, equipos de protección y metas de instalaciones.',
      type: 'REUNION' as const,
      scope: 'EMPLOYEE' as const,
      assignedEmployeeId: savedEmployees[3].id,
      eventDate: todayStr,
      startTime: '08:30',
      durationMinutes: 60,
      isAllDay: false,
      color: 'purple',
      createdByUserId: savedUsers[0].id,
    },
    {
      title: 'Capacitación: Certificación en Fusión y Medición OTDR',
      description: 'Taller práctico sobre reflectometría y resolución de atenuaciones severas en campo.',
      type: 'CAPACITACION' as const,
      scope: 'EMPLOYEE' as const,
      assignedEmployeeId: savedEmployees[3].id,
      eventDate: tomorrowStr,
      startTime: '15:00',
      durationMinutes: 120,
      isAllDay: false,
      color: 'emerald',
      createdByUserId: savedUsers[0].id,
    },
    {
      title: 'Aviso General: Auditoría de Inventario y Herramientas',
      description: 'Entrega y revisión semestral de fusionadoras, medidores de potencia y vehículos.',
      type: 'AVISO_GLOBAL' as const,
      scope: 'GLOBAL' as const,
      eventDate: tomorrowStr,
      isAllDay: true,
      color: 'cyan',
      createdByUserId: savedUsers[0].id,
    },
  ];

  for (const ev of eventsData) {
    let exists = await eventRepo.findOneBy({ title: ev.title, eventDate: ev.eventDate });
    if (!exists) {
      await eventRepo.save(eventRepo.create(ev));
    }
  }
  console.log('✅ 21/21 tickets.schedule_events: 5 actividades de oficina y avisos insertados.');

  console.log('✨ ==============================================================================');
  console.log('✨ SEMILLERO DE DATOS EMPRESARIAL COMPLETADO EXITOSAMENTE CON 100+ REGISTROS 3NF');
  console.log('✨ ==============================================================================');
}

if (require.main === module) {
  runInitialSeed()
    .then(() => AppDataSource.destroy())
    .catch((err) => {
      console.error('❌ Error ejecutando el semillero:', err);
      process.exit(1);
    });
}
