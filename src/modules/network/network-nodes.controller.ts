import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NetworkNodesService } from './network-nodes.service';
import { CreateNetworkNodeDto } from './dto/create-network-node.dto';
import { UpdateNetworkNodeDto } from './dto/update-network-node.dto';
import { ListNetworkNodesDto } from './dto/list-network-nodes.dto';
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
import { EnsureDhcpServerDto } from './dto/ensure-dhcp-server.dto';
import { CreateRouterOsProfileDto, UpdateRouterOsProfileDto } from './dto/routeros-profile.dto';
import { SyncCatalogProfilesDto } from './dto/sync-catalog-profiles.dto';

/** Protegido por SaasFeatureGuard: el tenant debe tener contratado el módulo MIKROTIK. */
@Controller('network/nodes')
@UseGuards(AuthGuard, RolesGuard, SaasFeatureGuard)
@RequireFeature('MIKROTIK')
export class NetworkNodesController {
  constructor(
    private readonly networkNodesService: NetworkNodesService,
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
