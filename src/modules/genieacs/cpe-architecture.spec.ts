import * as fs from 'fs';
import * as path from 'path';

describe('GenieACS Architecture Isolation Test (RF-ONU-001/004)', () => {
  it('CpeConfiguratorService y CpeParameterMapper no deben importar dependencias de olt ni de billing', () => {
    const configuratorPath = path.join(__dirname, 'services/cpe-configurator.service.ts');
    const mapperPath = path.join(__dirname, 'services/cpe-parameter-mapper.ts');

    const configuratorContent = fs.readFileSync(configuratorPath, 'utf8');
    const mapperContent = fs.readFileSync(mapperPath, 'utf8');

    const forbiddenImports = ['/olt', '/billing', 'olt.', 'billing.'];

    for (const forbidden of forbiddenImports) {
      expect(configuratorContent).not.toContain(forbidden);
      expect(mapperContent).not.toContain(forbidden);
    }
  });
});
