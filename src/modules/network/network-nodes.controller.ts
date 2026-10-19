import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { NetworkNodesService } from './network-nodes.service';
import { NetworkNodesExportService } from './services/network-nodes-export.service';
import { CreateNetworkNodeDto } from './dto/create-network-node.dto';
import { UpdateNetworkNodeDto } from './dto/update-network-node.dto';
import { ListNetworkNodesDto } from './dto/list-network-nodes.dto';
import { ExportNetworkNodesDto } from './dto/export-network-nodes.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SaasFeatureGuard } from '../../common/guards/saas-feature.guard';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PppManagementService } from './services/ppp-management.service';
import { NetworkNodeInfrastructureService } from './services/network-node-infrastructure.service';
import { SuspensionPortalManagerService } from './services/suspension-portal-manager.service';
import { SyncNodeVlanDto } from './dto/sync-node-vlan.dto';
import { ImportDiscoveredVlanDto } from './dto/import-discovered-vlan.dto';
import { EnsureDhcpServerDto } from './dto/ensure-dhcp-server.dto';
import { EnsurePppoeServerDto } from './dto/ensure-pppoe-server.dto';
import { EnsureAcsAutoProvisioningDto } from './dto/ensure-acs-auto-provisioning.dto';
import { CreateRouterOsProfileDto, UpdateRouterOsProfileDto } from './dto/routeros-profile.dto';
import { SyncCatalogProfilesDto } from './dto/sync-catalog-profiles.dto';

/** Protegido por SaasFeatureGuard: el tenant debe tener contratado el módulo MIKROTIK. */
@Controller('network/nodes')
@UseGuards(AuthGuard, RolesGuard, SaasFeatureGuard)
@RequireFeature('MIKROTIK')
export class NetworkNodesController {
  constructor(
    private readonly networkNodesService: NetworkNodesService,
    private readonly networkNodesExportService: NetworkNodesExportService,
    private readonly pppManagementService: PppManagementService,
    private readonly infrastructureService: NetworkNodeInfrastructureService,
    private readonly portalManagerService: SuspensionPortalManagerService,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.GERENTE)
  async findAll(@Query() listNetworkNodesDto: ListNetworkNodesDto) {
    const activeOnly =
      listNetworkNodesDto.activeOnly !== undefined
        ? listNetworkNodesDto.activeOnly
        : listNetworkNodesDto.isActive !== undefined
          ? listNetworkNodesDto.isActive
          : !listNetworkNodesDto.includeInactive;
    return this.networkNodesService.findAll(listNetworkNodesDto, activeOnly);
  }

  // Debe declararse antes de ':id' — mismo motivo que en ClientsController.
  @Get('export')
  @Roles(Role.ADMIN, Role.GERENTE)
  async exportNodes(@Query() dto: ExportNetworkNodesDto, @Res() res: Response) {
    const result = await this.networkNodesExportService.export(dto);
    res.set({
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Content-Length': result.buffer.length,
    });
    res.end(result.buffer);
  }

  @Post('test-connection')
  @Roles(Role.ADMIN, Role.GERENTE)
  async testConnection(@Body() options: any) {
    return this.networkNodesService.testConnection(options);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async findById(@Param('id') id: string) {
    return this.networkNodesService.findById(id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.GERENTE)
  async create(@Body() createNetworkNodeDto: CreateNetworkNodeDto) {
    return this.networkNodesService.create(createNetworkNodeDto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async update(@Param('id') id: string, @Body() updateNetworkNodeDto: UpdateNetworkNodeDto) {
    return this.networkNodesService.update(id, updateNetworkNodeDto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async delete(@Param('id') id: string) {
    return this.networkNodesService.delete(id);
  }

  @Post(':id/test-connection')
  @Roles(Role.ADMIN, Role.GERENTE)
  async testExistingNode(@Param('id') id: string) {
    return this.networkNodesService.testExistingNode(id);
  }

  @Post(':id/health-check')
  @Roles(Role.ADMIN, Role.GERENTE)
  async triggerHealthCheck(@Param('id') id: string, @CurrentUser('sub') userId?: string) {
    return this.networkNodesService.triggerHealthCheck(id, userId);
  }

  @Get(':id/wireguard-script')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getWireguardScript(@Param('id') id: string) {
    return this.networkNodesService.getWireguardScript(id);
  }

  @Post(':id/wireguard/verify')
  @Roles(Role.ADMIN, Role.GERENTE)
  async verifyWireguardPeer(@Param('id') id: string) {
    return this.networkNodesService.verifyWireguardPeer(id);
  }

  @Get(':id/logs')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getNodeLogs(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.networkNodesService.getNodeLogs(id, page, limit);
  }

  @Get(':id/ppp/active')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getNodeActiveSessions(@Param('id') id: string) {
    return this.pppManagementService.getNodeActiveSessions(id);
  }

  @Delete(':id/ppp/active/:username')
  @Roles(Role.ADMIN, Role.GERENTE)
  async disconnectNodeActiveSession(
    @Param('id') id: string,
    @Param('username') username: string,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.pppManagementService.disconnectNodeActiveSession(id, username, userId);
  }

  @Post(':id/ppp/sync-profiles')
  @Roles(Role.ADMIN, Role.GERENTE)
  async syncCatalogProfiles(
    @Param('id') id: string,
    @Body() dto?: SyncCatalogProfilesDto,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.pppManagementService.syncCatalogProfilesToNode(id, dto, userId);
  }

  @Get(':id/vlans')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getNodeVlans(@Param('id') id: string) {
    return this.infrastructureService.listVlans(id);
  }

  /** Descubrimiento brownfield: VLANs que YA existen en el router real, sincronizadas o no por Sumtech. Solo lectura. */
  @Get(':id/vlans/scan')
  @Roles(Role.ADMIN, Role.GERENTE)
  async scanNodeRealVlans(@Param('id') id: string) {
    return this.infrastructureService.scanRealVlans(id);
  }

  /** Da de alta en Sumtech una VLAN descubierta por /vlans/scan -- no escribe nada en RouterOS, ya existía. */
  @Post(':id/vlans/import')
  @Roles(Role.ADMIN, Role.GERENTE)
  async importNodeDiscoveredVlan(
    @Param('id') id: string,
    @Body() dto: ImportDiscoveredVlanDto,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.infrastructureService.importDiscoveredVlan(id, dto, userId);
  }

  /** Estado real de PPPoE/DHCP por VLAN ya registrada (solo lectura, ver Fase 2 del plan de descubrimiento). */
  @Get(':id/vlans/service-status')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getNodeVlanServiceStatuses(@Param('id') id: string) {
    return this.infrastructureService.getVlanServiceStatuses(id);
  }

  @Post(':id/vlans/:vlanId/sync')
  @Roles(Role.ADMIN, Role.GERENTE)
  async syncNodeVlan(
    @Param('id') id: string,
    @Param('vlanId') vlanId: string,
    @Body() dto: SyncNodeVlanDto,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.infrastructureService.syncVlan(id, vlanId, dto, userId);
  }

  @Delete(':id/vlans/:vlanId')
  @Roles(Role.ADMIN, Role.GERENTE)
  async desyncNodeVlan(
    @Param('id') id: string,
    @Param('vlanId') vlanId: string,
    @CurrentUser('sub') userId?: string,
  ) {
    await this.infrastructureService.desyncVlan(id, vlanId, userId);
    return { ok: true };
  }

  @Post(':id/wan/sync')
  @Roles(Role.ADMIN, Role.GERENTE)
  async syncNodeWan(@Param('id') id: string, @CurrentUser('sub') userId?: string) {
    return this.infrastructureService.ensureWan(id, userId);
  }

  @Post(':id/vlans/:vlanId/dhcp-server')
  @Roles(Role.ADMIN, Role.GERENTE)
  async ensureNodeVlanDhcpServer(
    @Param('id') id: string,
    @Param('vlanId') vlanId: string,
    @Body() dto: EnsureDhcpServerDto,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.infrastructureService.ensureDhcpServerForVlan(id, vlanId, dto, userId);
  }

  @Post(':id/vlans/:vlanId/pppoe-server')
  @Roles(Role.ADMIN, Role.GERENTE)
  async ensureNodeVlanPppoeServer(
    @Param('id') id: string,
    @Param('vlanId') vlanId: string,
    @Body() dto: EnsurePppoeServerDto,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.infrastructureService.ensurePppoeServerForVlan(id, vlanId, dto, userId);
  }

  @Post(':id/nat/ensure-masquerade')
  @Roles(Role.ADMIN, Role.GERENTE)
  async ensureNodeNatMasquerade(@Param('id') id: string, @CurrentUser('sub') userId?: string) {
    return this.infrastructureService.ensureNatMasquerade(id, userId);
  }

  @Post(':id/firewall/ensure-baseline')
  @Roles(Role.ADMIN, Role.GERENTE)
  async ensureNodeFirewallBaseline(@Param('id') id: string, @CurrentUser('sub') userId?: string) {
    return this.infrastructureService.ensureFirewallBaseline(id, userId);
  }

  /** Reglas NAT reales en el router (solo lectura, sin filtrar por el comentario de Sumtech -- Fase 3 del plan de descubrimiento). */
  @Get(':id/nat/real')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getNodeRealNatRules(@Param('id') id: string) {
    return this.infrastructureService.getRealNatRules(id);
  }

  /** Reglas de Filter reales en el router (solo lectura, mismo criterio que /nat/real). */
  @Get(':id/firewall/real')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getNodeRealFirewallRules(@Param('id') id: string) {
    return this.infrastructureService.getRealFirewallRules(id);
  }

  /** Reconciliación de solo lectura: confirma contra el router real si VLANs/NAT/Firewall siguen aplicados. */
  @Get(':id/infrastructure/reconcile')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getNodeReconciliationStatus(@Param('id') id: string) {
    return this.infrastructureService.getReconciliationStatus(id);
  }

  /** Diagnóstico de topología real: IPs configuradas en el router (ej. confirmar el gateway real de una LAN). */
  @Get(':id/ip-addresses')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getNodeIpAddresses(@Param('id') id: string) {
    return this.infrastructureService.getIpAddresses(id);
  }

  /** Auto-configuración TR-069 vía DHCP Option 43 (RF-OLT-013 / Broadband Forum Annex G). */
  @Post(':id/tr069/ensure-acs-auto-provisioning')
  @Roles(Role.ADMIN, Role.GERENTE)
  async ensureNodeAcsAutoProvisioning(
    @Param('id') id: string,
    @Body() dto: EnsureAcsAutoProvisioningDto,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.infrastructureService.ensureAcsAutoProvisioning(id, dto.acsUrl, userId);
  }

  @Get(':id/ppp/profiles')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getNodeProfiles(@Param('id') id: string) {
    return this.pppManagementService.getNodeProfiles(id);
  }

  @Get(':id/ppp/pools')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getNodeIpPools(@Param('id') id: string) {
    return this.pppManagementService.getNodeIpPools(id);
  }

  /** IPs libres del pool de este nodo (RF: sugerencia automática al configurar un secret PPPoE/DHCP). */
  @Get(':id/ppp/pools/available-ips')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getAvailableIps(@Param('id') id: string, @Query('pool') pool?: string) {
    return this.pppManagementService.getAvailableIps(id, { poolName: pool });
  }

  @Post(':id/ppp/profiles')
  @Roles(Role.ADMIN, Role.GERENTE)
  async createNodeProfile(
    @Param('id') id: string,
    @Body() dto: CreateRouterOsProfileDto,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.pppManagementService.createNodeProfile(id, dto, userId);
  }

  @Patch(':id/ppp/profiles/:profileId')
  @Roles(Role.ADMIN, Role.GERENTE)
  async updateNodeProfile(
    @Param('id') id: string,
    @Param('profileId') profileId: string,
    @Body() dto: UpdateRouterOsProfileDto,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.pppManagementService.updateNodeProfile(id, profileId, dto, userId);
  }

  @Delete(':id/ppp/profiles/:profileId')
  @Roles(Role.ADMIN, Role.GERENTE)
  async deleteNodeProfile(
    @Param('id') id: string,
    @Param('profileId') profileId: string,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.pppManagementService.deleteNodeProfile(id, profileId, userId);
  }

  @Post(':id/install-portal')
  @Roles(Role.ADMIN, Role.GERENTE)
  async installPortal(@Param('id') id: string, @CurrentUser('sub') userId?: string) {
    return this.portalManagerService.installPortalRules(id, userId);
  }

  @Get(':id/portal-status')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getPortalStatus(@Param('id') id: string) {
    return this.portalManagerService.getPortalStatus(id);
  }

  // --- FASE 2: RESPALDOS Y ACTUALIZACIONES ROUTEROS ---

  @Post(':id/backups/download')
  @Roles(Role.ADMIN, Role.GERENTE)
  async downloadBackup(
    @Param('id') id: string,
    @Body() options: { type: 'BINARY' | 'RSC'; password?: string },
    @Res() res: Response,
    @CurrentUser('sub') userId?: string,
  ) {
    const result = await this.infrastructureService.generateAndDownloadBackup(
      id,
      options || { type: 'RSC' },
      userId,
    );
    res.set({
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Content-Length': result.buffer.length,
    });
    res.end(result.buffer);
  }

  @Get(':id/routeros-updates')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getRouterOsUpdates(@Param('id') id: string) {
    return this.infrastructureService.getRouterOsUpdates(id);
  }

  // --- FASE 3: INTERFACES FÍSICAS, POOLS Y LEASES DHCP ---

  @Get(':id/interfaces')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getNodeInterfaces(@Param('id') id: string) {
    return this.infrastructureService.getInterfaces(id);
  }

  @Patch(':id/interfaces/:name')
  @Roles(Role.ADMIN, Role.GERENTE)
  async setNodeInterfaceDisabled(
    @Param('id') id: string,
    @Param('name') name: string,
    @Body() body: { disabled: boolean },
    @CurrentUser('sub') userId?: string,
  ) {
    return this.infrastructureService.setInterfaceDisabled(id, name, body.disabled, userId);
  }

  @Post(':id/ppp/pools')
  @Roles(Role.ADMIN, Role.GERENTE)
  async createNodeIpPool(
    @Param('id') id: string,
    @Body() body: { name: string; ranges: string },
    @CurrentUser('sub') userId?: string,
  ) {
    return this.pppManagementService.createNodeIpPool(id, body, userId);
  }

  @Patch(':id/ppp/pools/:poolId')
  @Roles(Role.ADMIN, Role.GERENTE)
  async updateNodeIpPool(
    @Param('id') id: string,
    @Param('poolId') poolId: string,
    @Body() body: { ranges: string },
    @CurrentUser('sub') userId?: string,
  ) {
    return this.pppManagementService.updateNodeIpPool(id, poolId, body, userId);
  }

  @Delete(':id/ppp/pools/:poolId')
  @Roles(Role.ADMIN, Role.GERENTE)
  async deleteNodeIpPool(
    @Param('id') id: string,
    @Param('poolId') poolId: string,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.pppManagementService.deleteNodeIpPool(id, poolId, userId);
  }

  @Get(':id/dhcp/leases')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getNodeDhcpLeases(@Param('id') id: string) {
    return this.infrastructureService.getDhcpLeases(id);
  }

  @Post(':id/dhcp/leases/:leaseId/make-static')
  @Roles(Role.ADMIN, Role.GERENTE)
  async makeNodeDhcpLeaseStatic(
    @Param('id') id: string,
    @Param('leaseId') leaseId: string,
    @Body() body?: { comment?: string },
    @CurrentUser('sub') userId?: string,
  ) {
    return this.infrastructureService.makeDhcpLeaseStatic(id, leaseId, body?.comment, userId);
  }

  @Delete(':id/dhcp/leases/:leaseId')
  @Roles(Role.ADMIN, Role.GERENTE)
  async deleteNodeDhcpLease(
    @Param('id') id: string,
    @Param('leaseId') leaseId: string,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.infrastructureService.deleteDhcpLease(id, leaseId, userId);
  }

  // --- FASE 4: ANCHO DE BANDA AVANZADO (SIMPLE QUEUES) ---

  @Get(':id/queues')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getNodeSimpleQueues(@Param('id') id: string) {
    return this.infrastructureService.getSimpleQueues(id);
  }

  // --- FASE 5: SEGURIDAD, PLANTILLAS FIREWALL Y LOGS EN VIVO ---

  @Post(':id/security/lockdown')
  @Roles(Role.ADMIN, Role.GERENTE)
  async applySecurityLockdown(
    @Param('id') id: string,
    @Body() body?: { allowedIps?: string[] },
    @CurrentUser('sub') userId?: string,
  ) {
    return this.infrastructureService.applySecurityLockdown(id, body?.allowedIps || [], userId);
  }

  @Delete(':id/security/lockdown')
  @Roles(Role.ADMIN, Role.GERENTE)
  async removeSecurityLockdown(
    @Param('id') id: string,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.infrastructureService.removeSecurityLockdown(id, userId);
  }

  @Post(':id/security/anti-abuse')
  @Roles(Role.ADMIN, Role.GERENTE)
  async applyAntiAbuseTemplate(
    @Param('id') id: string,
    @Body() body: { template: 'BLOCK_SMTP_PORT25' | 'CLIENT_ISOLATION'; enabled: boolean },
    @CurrentUser('sub') userId?: string,
  ) {
    return this.infrastructureService.applyAntiAbuseTemplate(id, body.template, body.enabled, userId);
  }

  @Get(':id/routeros-logs')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getNodeRouterOsLogs(
    @Param('id') id: string,
    @Query('topics') topics?: string,
  ) {
    return this.infrastructureService.getRouterOsLogs(id, topics);
  }

  @Patch(':id/deactivate')
  @Roles(Role.ADMIN, Role.GERENTE)
  async deactivate(@Param('id') id: string) {
    return this.networkNodesService.deactivate(id);
  }

  @Patch(':id/reactivate')
  @Roles(Role.ADMIN, Role.GERENTE)
  async reactivate(@Param('id') id: string) {
    return this.networkNodesService.reactivate(id);
  }
}
